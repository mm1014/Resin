import { apiRequest } from "../../lib/api-client";
import type {
  ListPlatformIPLoadInput,
  ListPlatformLeasesInput,
  PageResponse,
  Platform,
  PlatformCreateInput,
  PlatformIPLoadEntry,
  PlatformLease,
  PlatformUpdateInput,
} from "./types";

const basePath = "/api/v1/platforms";

type ApiPlatform = Omit<Platform, "regex_filters" | "region_filters"> & {
  regex_filters?: string[] | null;
  region_filters?: string[] | null;
  routable_node_count?: number | null;
  reverse_proxy_miss_action?: Platform["reverse_proxy_miss_action"] | null;
  reverse_proxy_empty_account_behavior?: Platform["reverse_proxy_empty_account_behavior"] | null;
  reverse_proxy_fixed_account_header?: string | null;
};

function parseMissAction(raw: ApiPlatform["reverse_proxy_miss_action"]): Platform["reverse_proxy_miss_action"] {
  if (raw === "TREAT_AS_EMPTY" || raw === "REJECT") {
    return raw;
  }
  throw new Error(`invalid reverse_proxy_miss_action: ${String(raw)}`);
}

function normalizePlatform(raw: ApiPlatform): Platform {
  return {
    ...raw,
    reverse_proxy_miss_action: parseMissAction(raw.reverse_proxy_miss_action),
    regex_filters: Array.isArray(raw.regex_filters) ? raw.regex_filters : [],
    region_filters: Array.isArray(raw.region_filters) ? raw.region_filters : [],
    routable_node_count: typeof raw.routable_node_count === "number" ? raw.routable_node_count : 0,
    reverse_proxy_empty_account_behavior:
      raw.reverse_proxy_empty_account_behavior === "RANDOM" ||
      raw.reverse_proxy_empty_account_behavior === "FIXED_HEADER" ||
      raw.reverse_proxy_empty_account_behavior === "ACCOUNT_HEADER_RULE"
        ? raw.reverse_proxy_empty_account_behavior
        : "RANDOM",
    reverse_proxy_fixed_account_header:
      typeof raw.reverse_proxy_fixed_account_header === "string" ? raw.reverse_proxy_fixed_account_header : "",
  };
}

function normalizePlatformPage(raw: PageResponse<ApiPlatform>): PageResponse<Platform> {
  return {
    ...raw,
    items: raw.items.map(normalizePlatform),
  };
}

function appendQueryValue(query: URLSearchParams, key: string, value: string | number | boolean | undefined) {
  if (value === undefined || value === "") {
    return;
  }
  query.set(key, String(value));
}

export type ListPlatformsPageInput = {
  limit?: number;
  offset?: number;
  keyword?: string;
};

export async function listPlatforms(input: ListPlatformsPageInput = {}): Promise<PageResponse<Platform>> {
  const query = new URLSearchParams({
    limit: String(input.limit ?? 50),
    offset: String(input.offset ?? 0),
    sort_by: "name",
    sort_order: "asc",
  });
  const keyword = input.keyword?.trim();
  if (keyword) {
    query.set("keyword", keyword);
  }

  const data = await apiRequest<PageResponse<ApiPlatform>>(`${basePath}?${query.toString()}`);
  return normalizePlatformPage(data);
}

export async function getPlatform(id: string): Promise<Platform> {
  const data = await apiRequest<ApiPlatform>(`${basePath}/${id}`);
  return normalizePlatform(data);
}

export async function createPlatform(input: PlatformCreateInput): Promise<Platform> {
  const data = await apiRequest<ApiPlatform>(basePath, {
    method: "POST",
    body: input,
  });
  return normalizePlatform(data);
}

export async function updatePlatform(id: string, input: PlatformUpdateInput): Promise<Platform> {
  const data = await apiRequest<ApiPlatform>(`${basePath}/${id}`, {
    method: "PATCH",
    body: input,
  });
  return normalizePlatform(data);
}

export async function deletePlatform(id: string): Promise<void> {
  await apiRequest<void>(`${basePath}/${id}`, {
    method: "DELETE",
  });
}

export async function resetPlatform(id: string): Promise<Platform> {
  const data = await apiRequest<ApiPlatform>(`${basePath}/${id}/actions/reset-to-default`, {
    method: "POST",
  });
  return normalizePlatform(data);
}

export async function rebuildPlatform(id: string): Promise<void> {
  await apiRequest<{ status: "ok" }>(`${basePath}/${id}/actions/rebuild-routable-view`, {
    method: "POST",
  });
}

export async function clearAllPlatformLeases(id: string): Promise<void> {
  await apiRequest<void>(`${basePath}/${id}/leases`, {
    method: "DELETE",
  });
}

export async function deletePlatformLease(id: string, account: string): Promise<void> {
  await apiRequest<void>(`${basePath}/${id}/leases/${encodeURIComponent(account)}`, {
    method: "DELETE",
  });
}

export async function listPlatformLeases(
  id: string,
  input: ListPlatformLeasesInput = {},
): Promise<PageResponse<PlatformLease>> {
  const query = new URLSearchParams({
    limit: String(input.limit ?? 1000),
    offset: String(input.offset ?? 0),
    sort_by: input.sort_by ?? "account",
    sort_order: input.sort_order ?? "asc",
  });

  appendQueryValue(query, "account", input.account?.trim());
  appendQueryValue(query, "fuzzy", input.fuzzy);

  return apiRequest<PageResponse<PlatformLease>>(`${basePath}/${id}/leases?${query.toString()}`);
}

export async function listPlatformIPLoad(
  id: string,
  input: ListPlatformIPLoadInput = {},
): Promise<PageResponse<PlatformIPLoadEntry>> {
  const query = new URLSearchParams({
    limit: String(input.limit ?? 1000),
    offset: String(input.offset ?? 0),
    sort_by: input.sort_by ?? "lease_count",
    sort_order: input.sort_order ?? "desc",
  });

  return apiRequest<PageResponse<PlatformIPLoadEntry>>(`${basePath}/${id}/ip-load?${query.toString()}`);
}

export async function assignPlatformLeaseToEgressIP(id: string, account: string, egressIP: string): Promise<PlatformLease> {
  return apiRequest<PlatformLease>(`${basePath}/${id}/leases/${encodeURIComponent(account)}/actions/assign`, {
    method: "POST",
    body: {
      egress_ip: egressIP,
    },
  });
}
