package main

import (
	"log"
	"net/netip"
	"sync"
	"time"

	"github.com/Resinat/Resin/internal/node"
	"github.com/Resinat/Resin/internal/platform"
	"github.com/Resinat/Resin/internal/topology"
)

const (
	defaultRoutePoolRescueCooldown      = 30 * time.Second
	defaultRoutePoolRescueRetryInterval = 30 * time.Second
)

type routePoolProbeTrigger interface {
	TriggerImmediateEgressProbe(node.Hash)
	TriggerImmediateLatencyProbe(node.Hash)
}

type routePoolHighPriorityProbeTrigger interface {
	TriggerHighPriorityEgressProbe(node.Hash)
	TriggerHighPriorityLatencyProbe(node.Hash)
}

type routePoolSubscriptionRefresher interface {
	ForceRefreshAll()
}

type routePoolSelfHealerConfig struct {
	Pool                  *topology.GlobalNodePool
	ProbeTrigger          routePoolProbeTrigger
	SubscriptionRefresher routePoolSubscriptionRefresher
	GeoLookup             func(netip.Addr) string
	Cooldown              time.Duration
	RetryInterval         time.Duration
	MaxAttempts           int
	Now                   func() time.Time
}

type routePoolSelfHealer struct {
	pool                  *topology.GlobalNodePool
	probeTrigger          routePoolProbeTrigger
	subscriptionRefresher routePoolSubscriptionRefresher
	geoLookup             func(netip.Addr) string
	cooldown              time.Duration
	retryInterval         time.Duration
	maxAttempts           int
	now                   func() time.Time

	mu           sync.Mutex
	lastRescueAt map[string]time.Time
	active       map[string]struct{}
}

func newRoutePoolSelfHealer(cfg routePoolSelfHealerConfig) *routePoolSelfHealer {
	cooldown := cfg.Cooldown
	if cooldown <= 0 {
		cooldown = defaultRoutePoolRescueCooldown
	}
	retryInterval := cfg.RetryInterval
	if retryInterval <= 0 {
		retryInterval = defaultRoutePoolRescueRetryInterval
	}
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	return &routePoolSelfHealer{
		pool:                  cfg.Pool,
		probeTrigger:          cfg.ProbeTrigger,
		subscriptionRefresher: cfg.SubscriptionRefresher,
		geoLookup:             cfg.GeoLookup,
		cooldown:              cooldown,
		retryInterval:         retryInterval,
		maxAttempts:           cfg.MaxAttempts,
		now:                   now,
		lastRescueAt:          make(map[string]time.Time),
		active:                make(map[string]struct{}),
	}
}

func (h *routePoolSelfHealer) handleNoAvailableNodes(platformID string) {
	if h == nil || platformID == "" || !h.claimRescue(platformID) {
		return
	}
	go h.rescuePlatformUntilRoutable(platformID)
}

func (h *routePoolSelfHealer) claimRescue(platformID string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()

	now := h.now()
	if _, ok := h.active[platformID]; ok {
		return false
	}
	if last, ok := h.lastRescueAt[platformID]; ok && now.Sub(last) < h.cooldown {
		return false
	}
	h.lastRescueAt[platformID] = now
	h.active[platformID] = struct{}{}
	return true
}

func (h *routePoolSelfHealer) finishRescue(platformID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.active, platformID)
}

func (h *routePoolSelfHealer) rescuePlatformUntilRoutable(platformID string) {
	defer h.finishRescue(platformID)

	for attempt := 1; ; attempt++ {
		if h.rescuePlatform(platformID) {
			return
		}
		if h.maxAttempts > 0 && attempt >= h.maxAttempts {
			log.Printf("route pool self-heal: platform %s still empty after %d attempts", platformID, attempt)
			return
		}
		time.Sleep(h.retryInterval)
	}
}

func (h *routePoolSelfHealer) rescuePlatform(platformID string) bool {
	if h == nil || h.pool == nil || platformID == "" {
		return true
	}
	if h.subscriptionRefresher != nil {
		h.subscriptionRefresher.ForceRefreshAll()
	}

	plat, ok := h.pool.GetPlatform(platformID)
	if !ok {
		return true
	}

	h.pool.RebuildPlatform(plat)
	if plat.View().Size() > 0 {
		return true
	}

	candidates := h.collectProbeCandidates(plat)
	if len(candidates) == 0 {
		log.Printf("route pool self-heal: platform %s has no probe candidates", platformID)
		return false
	}
	if h.probeTrigger == nil {
		return false
	}
	for _, hash := range candidates {
		h.triggerProbe(hash)
	}
	log.Printf("route pool self-heal: platform %s empty, scheduled probes for %d candidate nodes", platformID, len(candidates))
	return false
}

func (h *routePoolSelfHealer) triggerProbe(hash node.Hash) {
	if highPriority, ok := h.probeTrigger.(routePoolHighPriorityProbeTrigger); ok {
		highPriority.TriggerHighPriorityEgressProbe(hash)
		highPriority.TriggerHighPriorityLatencyProbe(hash)
		return
	}
	h.probeTrigger.TriggerImmediateEgressProbe(hash)
	h.probeTrigger.TriggerImmediateLatencyProbe(hash)
}

func (h *routePoolSelfHealer) collectProbeCandidates(plat *platform.Platform) []node.Hash {
	if h == nil || h.pool == nil || plat == nil {
		return nil
	}

	subLookup := h.pool.MakeSubLookup()
	candidates := make([]node.Hash, 0)
	h.pool.RangeNodes(func(hash node.Hash, entry *node.NodeEntry) bool {
		if entry == nil {
			return true
		}
		if entry.IsDisabledBySubscriptions(subLookup) || !entry.HasOutbound() {
			return true
		}
		if !entry.MatchRegexs(plat.RegexFilters, subLookup) {
			return true
		}
		if !h.matchesRecoverableRegion(entry, plat.RegionFilters) {
			return true
		}
		candidates = append(candidates, hash)
		return true
	})
	return candidates
}

func (h *routePoolSelfHealer) matchesRecoverableRegion(entry *node.NodeEntry, filters []string) bool {
	if len(filters) == 0 {
		return true
	}
	region := entry.GetRegion(h.geoLookup)
	if region == "" {
		return true
	}
	return platform.MatchRegionFilter(region, filters)
}
