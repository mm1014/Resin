package main

import (
	"encoding/json"
	"net/netip"
	"testing"
	"time"

	"github.com/Resinat/Resin/internal/config"
	"github.com/Resinat/Resin/internal/node"
	"github.com/Resinat/Resin/internal/platform"
	"github.com/Resinat/Resin/internal/subscription"
	"github.com/Resinat/Resin/internal/testutil"
)

type recordingProbeTrigger struct {
	egress    []node.Hash
	latency   []node.Hash
	onEgress  func(node.Hash)
	onLatency func(node.Hash)
}

func (r *recordingProbeTrigger) TriggerImmediateEgressProbe(hash node.Hash) {
	r.egress = append(r.egress, hash)
	if r.onEgress != nil {
		r.onEgress(hash)
	}
}

func (r *recordingProbeTrigger) TriggerImmediateLatencyProbe(hash node.Hash) {
	r.latency = append(r.latency, hash)
	if r.onLatency != nil {
		r.onLatency(hash)
	}
}

func (r *recordingProbeTrigger) TriggerHighPriorityEgressProbe(hash node.Hash) {
	r.TriggerImmediateEgressProbe(hash)
}

func (r *recordingProbeTrigger) TriggerHighPriorityLatencyProbe(hash node.Hash) {
	r.TriggerImmediateLatencyProbe(hash)
}

type recordingSubscriptionRefresher struct {
	calls int
}

func (r *recordingSubscriptionRefresher) ForceRefreshAll() {
	r.calls++
}

func TestRoutePoolSelfHealer_RebuildsStaleEmptyViewWithoutProbes(t *testing.T) {
	runtimeCfg := config.NewDefaultRuntimeConfig()
	subMgr, pool := newBootstrapTestRuntime(runtimeCfg)
	sub := subscription.NewSubscription("sub-1", "Provider", "url", true, false)
	subMgr.Register(sub)

	plat := platform.NewPlatform("plat-jp", "JP", nil, []string{"jp"})
	pool.RegisterPlatform(plat)
	hash := addSelfHealTestNode(t, pool, sub, `{"id":"jp-routable"}`, "203.0.113.10", "jp", true)
	entry, _ := pool.GetEntry(hash)
	entry.LatencyTable.Update("cloudflare.com", 50*time.Millisecond, 10*time.Minute)
	entry.CircuitOpenSince.Store(0)

	if plat.View().Size() != 0 {
		t.Fatalf("test setup expected stale empty view, got %d", plat.View().Size())
	}

	probes := &recordingProbeTrigger{}
	refresher := &recordingSubscriptionRefresher{}
	healer := newRoutePoolSelfHealer(routePoolSelfHealerConfig{
		Pool:                  pool,
		ProbeTrigger:          probes,
		SubscriptionRefresher: refresher,
		Cooldown:              time.Minute,
	})

	healer.rescuePlatform(plat.ID)

	if refresher.calls != 1 {
		t.Fatalf("subscription refresh calls = %d, want 1", refresher.calls)
	}
	if plat.View().Size() != 1 || !plat.View().Contains(hash) {
		t.Fatalf("expected rebuild to restore platform view for %s, size=%d", hash.Hex(), plat.View().Size())
	}
	if len(probes.egress) != 0 || len(probes.latency) != 0 {
		t.Fatalf("expected no probes after successful rebuild, got egress=%d latency=%d", len(probes.egress), len(probes.latency))
	}
}

func TestRoutePoolSelfHealer_ProbesFilteredCandidatesWhenStillEmpty(t *testing.T) {
	runtimeCfg := config.NewDefaultRuntimeConfig()
	subMgr, pool := newBootstrapTestRuntime(runtimeCfg)
	sub := subscription.NewSubscription("sub-1", "Provider", "url", true, false)
	subMgr.Register(sub)

	plat := platform.NewPlatform("plat-jp", "JP", nil, []string{"jp"})
	pool.RegisterPlatform(plat)
	jpHash := addSelfHealTestNode(t, pool, sub, `{"id":"jp-circuit"}`, "203.0.113.11", "jp", true)
	_ = addSelfHealTestNode(t, pool, sub, `{"id":"us-circuit"}`, "198.51.100.11", "us", true)
	_ = addSelfHealTestNode(t, pool, sub, `{"id":"jp-no-outbound"}`, "203.0.113.12", "jp", false)

	probes := &recordingProbeTrigger{}
	refresher := &recordingSubscriptionRefresher{}
	healer := newRoutePoolSelfHealer(routePoolSelfHealerConfig{
		Pool:                  pool,
		ProbeTrigger:          probes,
		SubscriptionRefresher: refresher,
		Cooldown:              time.Minute,
	})

	healer.rescuePlatform(plat.ID)

	if refresher.calls != 1 {
		t.Fatalf("subscription refresh calls = %d, want 1", refresher.calls)
	}
	if len(probes.egress) != 1 || probes.egress[0] != jpHash {
		t.Fatalf("egress probes = %v, want only %s", hashesHex(probes.egress), jpHash.Hex())
	}
	if len(probes.latency) != 1 || probes.latency[0] != jpHash {
		t.Fatalf("latency probes = %v, want only %s", hashesHex(probes.latency), jpHash.Hex())
	}
}

func TestRoutePoolSelfHealer_LoopsUntilPlatformBecomesRoutable(t *testing.T) {
	runtimeCfg := config.NewDefaultRuntimeConfig()
	subMgr, pool := newBootstrapTestRuntime(runtimeCfg)
	sub := subscription.NewSubscription("sub-1", "Provider", "url", true, false)
	subMgr.Register(sub)

	plat := platform.NewPlatform("plat-jp", "JP", nil, []string{"jp"})
	pool.RegisterPlatform(plat)
	jpHash := addSelfHealTestNode(t, pool, sub, `{"id":"jp-recover"}`, "203.0.113.11", "jp", true)

	if plat.View().Size() != 0 {
		t.Fatalf("test setup expected empty view before recovery, got %d", plat.View().Size())
	}

	latencyProbeCalls := 0
	probes := &recordingProbeTrigger{
		onLatency: func(hash node.Hash) {
			if hash != jpHash {
				return
			}
			latencyProbeCalls++
			if latencyProbeCalls < 2 {
				return
			}
			latency := 80 * time.Millisecond
			pool.RecordResult(hash, true)
			pool.RecordLatency(hash, "cloudflare.com", &latency)
		},
	}
	refresher := &recordingSubscriptionRefresher{}
	healer := newRoutePoolSelfHealer(routePoolSelfHealerConfig{
		Pool:                  pool,
		ProbeTrigger:          probes,
		SubscriptionRefresher: refresher,
		Cooldown:              time.Minute,
		RetryInterval:         time.Millisecond,
		MaxAttempts:           4,
	})

	healer.rescuePlatformUntilRoutable(plat.ID)

	if refresher.calls < 3 {
		t.Fatalf("subscription refresh calls = %d, want at least 3 loop attempts", refresher.calls)
	}
	if latencyProbeCalls != 2 {
		t.Fatalf("latency probe calls = %d, want 2 before recovery", latencyProbeCalls)
	}
	if plat.View().Size() != 1 || !plat.View().Contains(jpHash) {
		t.Fatalf("expected self-heal loop to restore platform view for %s, size=%d", jpHash.Hex(), plat.View().Size())
	}
}

func TestRoutePoolSelfHealer_ClaimRescueCooldown(t *testing.T) {
	now := time.Unix(100, 0)
	healer := newRoutePoolSelfHealer(routePoolSelfHealerConfig{
		Cooldown: time.Minute,
		Now:      func() time.Time { return now },
	})

	if !healer.claimRescue("plat-1") {
		t.Fatal("first rescue should be allowed")
	}
	if healer.claimRescue("plat-1") {
		t.Fatal("second rescue while active should be blocked")
	}
	healer.finishRescue("plat-1")
	if healer.claimRescue("plat-1") {
		t.Fatal("second rescue inside cooldown should be blocked")
	}
	now = now.Add(time.Minute + time.Second)
	if !healer.claimRescue("plat-1") {
		t.Fatal("rescue after cooldown should be allowed")
	}
}

func addSelfHealTestNode(
	t *testing.T,
	pool interface {
		AddNodeFromSub(node.Hash, json.RawMessage, string)
		GetEntry(node.Hash) (*node.NodeEntry, bool)
	},
	sub *subscription.Subscription,
	raw string,
	ip string,
	region string,
	withOutbound bool,
) node.Hash {
	t.Helper()
	rawOpts := json.RawMessage(raw)
	hash := node.HashFromRawOptions(rawOpts)
	sub.ManagedNodes().StoreNode(hash, subscription.ManagedNode{Tags: []string{"tag"}})
	pool.AddNodeFromSub(hash, rawOpts, sub.ID)
	entry, ok := pool.GetEntry(hash)
	if !ok {
		t.Fatalf("node %s not found", hash.Hex())
	}
	entry.SetEgressIP(netip.MustParseAddr(ip))
	entry.SetEgressRegion(region)
	if withOutbound {
		outbound := testutil.NewNoopOutbound()
		entry.Outbound.Store(&outbound)
	}
	return hash
}

func hashesHex(hashes []node.Hash) []string {
	result := make([]string, 0, len(hashes))
	for _, hash := range hashes {
		result = append(result, hash.Hex())
	}
	return result
}
