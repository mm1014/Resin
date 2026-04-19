import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { AlertTriangle, Sparkles } from "lucide-react";
import { DataTable } from "../../../components/ui/DataTable";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { useI18n } from "../../../i18n";
import { formatApiErrorMessage } from "../../../lib/error-message";
import { formatDateTime } from "../../../lib/time";
import { assignPlatformLeaseToEgressIP, clearAllPlatformLeases, listPlatformIPLoad, listPlatformLeases } from "../api";
import type { Platform, PlatformLease } from "../types";
import { PlatformLeaseEditModal } from "./PlatformLeaseEditModal";

type PlatformLeaseOpsPanelProps = {
  platform: Platform;
  onReset: () => Promise<unknown>;
  onDelete: () => Promise<unknown>;
  showToast: (tone: "success" | "error", text: string) => void;
  resetPending: boolean;
  deletePending: boolean;
  deleteDisabled: boolean;
};

const LEASE_FETCH_LIMIT = 1000;
const IP_LOAD_FETCH_LIMIT = 1000;
const NODE_TAG_TONES = [
  { color: "#1d4ed8", backgroundColor: "#dbeafe", borderColor: "#60a5fa" },
  { color: "#be123c", backgroundColor: "#ffe4e6", borderColor: "#fda4af" },
  { color: "#166534", backgroundColor: "#dcfce7", borderColor: "#86efac" },
  { color: "#6d28d9", backgroundColor: "#ede9fe", borderColor: "#c4b5fd" },
  { color: "#a16207", backgroundColor: "#fef3c7", borderColor: "#fcd34d" },
  { color: "#0f766e", backgroundColor: "#ccfbf1", borderColor: "#5eead4" },
  { color: "#c2410c", backgroundColor: "#ffedd5", borderColor: "#fdba74" },
  { color: "#4338ca", backgroundColor: "#e0e7ff", borderColor: "#a5b4fc" },
  { color: "#4d7c0f", backgroundColor: "#ecfccb", borderColor: "#bef264" },
  { color: "#a21caf", backgroundColor: "#fae8ff", borderColor: "#f0abfc" },
  { color: "#b91c1c", backgroundColor: "#fee2e2", borderColor: "#fca5a5" },
  { color: "#075985", backgroundColor: "#e0f2fe", borderColor: "#7dd3fc" },
] as const;

function shortNodeHash(nodeHash: string): string {
  return nodeHash ? nodeHash.slice(0, 12) : "-";
}

function hashColorSeed(seed: string): number {
  let value = 0;

  for (let index = 0; index < seed.length; index += 1) {
    value = (value * 31 + seed.charCodeAt(index)) >>> 0;
  }

  return value;
}

function nodeTagToneStyle(egressIP: string, nodeTag: string, nodeHash: string) {
  const colorSeed = egressIP.trim() || `${nodeTag}:${nodeHash}`;
  const seed = hashColorSeed(colorSeed);
  return NODE_TAG_TONES[seed % NODE_TAG_TONES.length];
}

export function PlatformLeaseOpsPanel({
  platform,
  onReset,
  onDelete,
  showToast,
  resetPending,
  deletePending,
  deleteDisabled,
}: PlatformLeaseOpsPanelProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [editingLease, setEditingLease] = useState<PlatformLease | null>(null);
  const [draftEgressIP, setDraftEgressIP] = useState("");

  const openEditModal = (lease: PlatformLease) => {
    setEditingLease(lease);
    setDraftEgressIP(lease.egress_ip ?? "");
  };

  const closeEditModal = () => {
    setEditingLease(null);
    setDraftEgressIP("");
  };

  const invalidateLeaseData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["platform-leases", platform.id] }),
      queryClient.invalidateQueries({ queryKey: ["platform-ip-load", platform.id] }),
    ]);
  };

  const invalidatePlatformMonitor = async () => {
    await queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey;
        return Array.isArray(key) && key[0] === "platform-monitor" && key.includes(platform.id);
      },
    });
  };

  const leasesQuery = useQuery({
    queryKey: ["platform-leases", platform.id, LEASE_FETCH_LIMIT],
    queryFn: () =>
      listPlatformLeases(platform.id, {
        limit: LEASE_FETCH_LIMIT,
        sort_by: "account",
        sort_order: "asc",
      }),
  });

  const ipLoadQuery = useQuery({
    queryKey: ["platform-ip-load", platform.id, IP_LOAD_FETCH_LIMIT],
    queryFn: () =>
      listPlatformIPLoad(platform.id, {
        limit: IP_LOAD_FETCH_LIMIT,
        sort_by: "lease_count",
        sort_order: "desc",
      }),
    enabled: editingLease !== null,
  });

  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!editingLease) {
        throw new Error(t("租约不存在"));
      }

      const nextIP = draftEgressIP.trim();
      if (!nextIP) {
        throw new Error(t("{{field}} 不能为空", { field: t("出口 IP") }));
      }

      return assignPlatformLeaseToEgressIP(platform.id, editingLease.account, nextIP);
    },
    onSuccess: async (lease) => {
      await invalidateLeaseData();
      closeEditModal();
      showToast("success", t("账号 {{account}} 已绑定到出口 IP {{ip}}", { account: lease.account, ip: lease.egress_ip }));
    },
    onError: (error) => {
      showToast("error", formatApiErrorMessage(error, t));
    },
  });

  const clearLeasesMutation = useMutation({
    mutationFn: async () => {
      const confirmed = window.confirm(t("确认清除平台 {{name}} 的所有租约？", { name: platform.name }));
      if (!confirmed) {
        return false;
      }

      await clearAllPlatformLeases(platform.id);
      return true;
    },
    onSuccess: async (didClear) => {
      if (!didClear) {
        return;
      }

      closeEditModal();
      await invalidateLeaseData();
      await invalidatePlatformMonitor();
      showToast("success", t("平台 {{name}} 的所有租约已清除", { name: platform.name }));
    },
    onError: (error) => {
      showToast("error", formatApiErrorMessage(error, t));
    },
  });

  const destructiveActionPending = resetPending || clearLeasesMutation.isPending || deletePending;
  const leases = leasesQuery.data?.items ?? [];
  const leaseTotal = leasesQuery.data?.total ?? leases.length;
  const leaseListTruncated = leaseTotal > leases.length;
  const candidateIPs = (ipLoadQuery.data?.items ?? []).map((entry) => entry.egress_ip);
  const egressIPToneMap = useMemo(() => {
    const uniqueIPs = Array.from(new Set(leases.map((lease) => lease.egress_ip?.trim()).filter(Boolean))).sort((left, right) =>
      left.localeCompare(right),
    );

    return new Map(uniqueIPs.map((ip, index) => [ip, NODE_TAG_TONES[index % NODE_TAG_TONES.length]]));
  }, [leases]);

  const toneStyleForLease = (lease: PlatformLease) => {
    const egressIP = lease.egress_ip?.trim() ?? "";

    if (egressIP) {
      return egressIPToneMap.get(egressIP) ?? nodeTagToneStyle(egressIP, lease.node_tag, lease.node_hash);
    }

    return nodeTagToneStyle("", lease.node_tag, lease.node_hash);
  };

  const col = useMemo(() => createColumnHelper<PlatformLease>(), []);
  const leaseColumns = useMemo(
    () => [
      col.accessor("account", {
        header: t("账号"),
        cell: (info) => info.getValue() || "-",
      }),
      col.accessor("egress_ip", {
        header: t("出口 IP"),
        cell: (info) => info.getValue() || "-",
      }),
      col.display({
        id: "node",
        header: t("节点"),
        cell: (info) => {
          const lease = info.row.original;
          return (
            <div className="platform-lease-cell">
              {lease.node_tag ? (
                <Badge
                  className="platform-node-pill"
                  style={toneStyleForLease(lease)}
                  title={`${lease.node_tag}${lease.egress_ip ? `\n出口 IP: ${lease.egress_ip}` : ""}`}
                >
                  {lease.node_tag}
                </Badge>
              ) : (
                <span className="platform-node-pill-empty">-</span>
              )}
              <small>{shortNodeHash(lease.node_hash)}</small>
            </div>
          );
        },
      }),
      col.accessor("last_accessed", {
        header: t("最近访问"),
        cell: (info) => formatDateTime(info.getValue()),
      }),
      col.accessor("expiry", {
        header: t("到期时间"),
        cell: (info) => formatDateTime(info.getValue()),
      }),
      col.display({
        id: "actions",
        header: t("操作"),
        cell: (info) => (
          <div className="subscriptions-row-actions platform-lease-actions">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={destructiveActionPending}
              onClick={() => openEditModal(info.row.original)}
            >
              {t("编辑")}
            </Button>
          </div>
        ),
      }),
    ],
    [col, destructiveActionPending, t, toneStyleForLease],
  );

  return (
    <>
      <div className="platform-lease-ops-layout">
        <section className="platform-drawer-section">
          <div className="platform-drawer-section-head">
            <h4>{t("当前平台租约")}</h4>
            <p>{t("按账号查看当前租约，并为已有租约调整出口 IP。")}</p>
          </div>

          {leasesQuery.isLoading ? <p className="muted">{t("加载租约中...")}</p> : null}

          {leasesQuery.isError ? (
            <div className="callout callout-error">
              <AlertTriangle size={14} />
              <span>{formatApiErrorMessage(leasesQuery.error, t)}</span>
            </div>
          ) : null}

          {leaseListTruncated ? (
            <div className="callout callout-warning">
              <span>{t("当前只展示前 {{count}} 条租约，请缩小范围后再操作。", { count: leases.length })}</span>
            </div>
          ) : null}

          {!leasesQuery.isLoading && !leasesQuery.isError && !leases.length ? (
            <div className="empty-box">
              <Sparkles size={16} />
              <p>{t("当前平台还没有活跃租约")}</p>
            </div>
          ) : null}

          {leases.length ? (
            <DataTable
              data={leases}
              columns={leaseColumns}
              selectedRowId={editingLease?.account}
              getRowId={(lease) => lease.account}
              className="platform-lease-table"
              wrapClassName="platform-lease-table-wrap"
            />
          ) : null}
        </section>

        <div className="platform-ops-list">
          <div className="platform-op-item">
            <div className="platform-op-copy">
              <h5>{t("重置为默认配置")}</h5>
              <p className="platform-op-hint">{t("恢复默认设置，并覆盖当前修改。")}</p>
            </div>
            <Button type="button" variant="secondary" onClick={() => void onReset()} disabled={destructiveActionPending}>
              {resetPending ? t("重置中...") : t("重置为默认配置")}
            </Button>
          </div>

          <div className="platform-op-item">
            <div className="platform-op-copy">
              <h5>{t("清除所有租约")}</h5>
              <p className="platform-op-hint">{t("立即清除当前平台的全部租约，下次请求将重新分配出口。")}</p>
            </div>
            <Button
              type="button"
              variant="danger"
              onClick={() => void clearLeasesMutation.mutateAsync()}
              disabled={destructiveActionPending}
            >
              {clearLeasesMutation.isPending ? t("清除中...") : t("清除所有租约")}
            </Button>
          </div>

          <div className="platform-op-item">
            <div className="platform-op-copy">
              <h5>{t("删除平台")}</h5>
              <p className="platform-op-hint">{t("永久删除当前平台及其配置，操作不可撤销。")}</p>
            </div>
            <Button type="button" variant="danger" onClick={() => void onDelete()} disabled={deleteDisabled || destructiveActionPending}>
              {deletePending ? t("删除中...") : t("删除平台")}
            </Button>
          </div>
        </div>
      </div>

      <PlatformLeaseEditModal
        open={editingLease !== null}
        account={editingLease?.account ?? ""}
        egressIP={draftEgressIP}
        currentEgressIP={editingLease?.egress_ip ?? null}
        candidateIPs={candidateIPs}
        isLeaseLoading={false}
        areCandidatesLoading={ipLoadQuery.isLoading}
        candidatesLoadFailed={ipLoadQuery.isError}
        isSaving={assignMutation.isPending || destructiveActionPending}
        onClose={() => {
          if (assignMutation.isPending || destructiveActionPending) {
            return;
          }

          closeEditModal();
        }}
        onEgressIPChange={setDraftEgressIP}
        onSubmit={() => void assignMutation.mutateAsync()}
      />
    </>
  );
}
