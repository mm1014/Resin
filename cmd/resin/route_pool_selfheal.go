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

const defaultRoutePoolRescueCooldown = 30 * time.Second

type routePoolProbeTrigger interface {
	TriggerImmediateEgressProbe(node.Hash)
	TriggerImmediateLatencyProbe(node.Hash)
}

type routePoolHighPriorityProbeTrigger interface {
	TriggerHighPriorityEgressProbe(node.Hash)
	TriggerHighPriorityLatencyProbe(node.Hash)
}

type routePoolSubscriptionRefresher interface {
	ForceRefreshAllAsync()
}

type routePoolSelfHealerConfig struct {
	Pool                  *topology.GlobalNodePool
	ProbeTrigger          routePoolProbeTrigger
	SubscriptionRefresher routePoolSubscriptionRefresher
	GeoLookup             func(netip.Addr) string
	Cooldown              time.Duration
	Now                   func() time.Time
}

type routePoolSelfHealer struct {
	pool                  *topology.GlobalNodePool
	probeTrigger          routePoolProbeTrigger
	subscriptionRefresher routePoolSubscriptionRefresher
	geoLookup             func(netip.Addr) string
	cooldown              time.Duration
	now                   func() time.Time

	mu           sync.Mutex
	lastRescueAt map[string]time.Time
}

func newRoutePoolSelfHealer(cfg routePoolSelfHealerConfig) *routePoolSelfHealer {
	cooldown := cfg.Cooldown
	if cooldown <= 0 {
		cooldown = defaultRoutePoolRescueCooldown
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
		now:                   now,
		lastRescueAt:          make(map[string]time.Time),
	}
}

func (h *routePoolSelfHealer) handleNoAvailableNodes(platformID string) {
	if h == nil || platformID == "" || !h.claimRescue(platformID) {
		return
	}
	go h.rescuePlatform(platformID)
}

func (h *routePoolSelfHealer) claimRescue(platformID string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()

	now := h.now()
	if last, ok := h.lastRescueAt[platformID]; ok && now.Sub(last) < h.cooldown {
		return false
	}
	h.lastRescueAt[platformID] = now
	return true
}

func (h *routePoolSelfHealer) rescuePlatform(platformID string) {
	if h == nil || h.pool == nil || platformID == "" {
		return
	}
	if h.subscriptionRefresher != nil {
		h.subscriptionRefresher.ForceRefreshAllAsync()
	}

	plat, ok := h.pool.GetPlatform(platformID)
	if !ok {
		return
	}

	h.pool.RebuildPlatform(plat)
	if plat.View().Size() > 0 {
		return
	}

	candidates := h.collectProbeCandidates(plat)
	if len(candidates) == 0 {
		log.Printf("route pool self-heal: platform %s has no probe candidates", platformID)
		return
	}
	if h.probeTrigger == nil {
		return
	}
	for _, hash := range candidates {
		h.triggerProbe(hash)
	}
	log.Printf("route pool self-heal: platform %s empty, scheduled probes for %d candidate nodes", platformID, len(candidates))
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
