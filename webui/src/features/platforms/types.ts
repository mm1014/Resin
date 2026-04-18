export type PlatformMissAction = "TREAT_AS_EMPTY" | "REJECT";
export type PlatformEmptyAccountBehavior = "RANDOM" | "FIXED_HEADER" | "ACCOUNT_HEADER_RULE";
export type PlatformAllocationPolicy = "BALANCED" | "PREFER_LOW_LATENCY" | "PREFER_IDLE_IP";
export type SortOrder = "asc" | "desc";
export type PlatformLeaseSortBy = "account" | "expiry" | "last_accessed";
export type PlatformIPLoadSortBy = "egress_ip" | "lease_count";

export type Platform = {
  id: string;
  name: string;
  sticky_ttl: string;
  regex_filters: string[];
  region_filters: string[];
  routable_node_count: number;
  reverse_proxy_miss_action: PlatformMissAction;
  reverse_proxy_empty_account_behavior: PlatformEmptyAccountBehavior;
  reverse_proxy_fixed_account_header: string;
  allocation_policy: PlatformAllocationPolicy;
  updated_at: string;
};

export type PlatformLease = {
  platform_id: string;
  account: string;
  node_hash: string;
  node_tag: string;
  egress_ip: string;
  expiry: string;
  last_accessed: string;
};

export type ListPlatformLeasesInput = {
  limit?: number;
  offset?: number;
  account?: string;
  fuzzy?: boolean;
  sort_by?: PlatformLeaseSortBy;
  sort_order?: SortOrder;
};

export type PlatformIPLoadEntry = {
  egress_ip: string;
  lease_count: number;
};

export type ListPlatformIPLoadInput = {
  limit?: number;
  offset?: number;
  sort_by?: PlatformIPLoadSortBy;
  sort_order?: SortOrder;
};

export type PageResponse<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type PlatformCreateInput = {
  name: string;
  sticky_ttl?: string;
  regex_filters?: string[];
  region_filters?: string[];
  reverse_proxy_miss_action?: PlatformMissAction;
  reverse_proxy_empty_account_behavior?: PlatformEmptyAccountBehavior;
  reverse_proxy_fixed_account_header?: string;
  allocation_policy?: PlatformAllocationPolicy;
};

export type PlatformUpdateInput = {
  name?: string;
  sticky_ttl?: string;
  regex_filters?: string[];
  region_filters?: string[];
  reverse_proxy_miss_action?: PlatformMissAction;
  reverse_proxy_empty_account_behavior?: PlatformEmptyAccountBehavior;
  reverse_proxy_fixed_account_header?: string;
  allocation_policy?: PlatformAllocationPolicy;
};
