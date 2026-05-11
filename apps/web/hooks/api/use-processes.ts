import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, type TimeRange } from "@/lib/api";
import {
  getProcessesQueryKey,
  getProcessDomainsQueryKey,
  getProcessIPsQueryKey,
  getProcessProxiesQueryKey,
  getProcessRulesQueryKey,
} from "@/lib/stats-query-keys";
import { keepPreviousByIdentity } from "@/lib/query-placeholder";
import { QUERY_CONFIG } from "@/lib/query-config";

interface UseProcessesOptions {
  activeBackendId?: number;
  limit?: number;
  range?: TimeRange;
  enabled?: boolean;
}

export function useProcesses({
  activeBackendId,
  limit = QUERY_CONFIG.LIMIT.DEFAULT,
  range,
  enabled = true,
}: UseProcessesOptions) {
  return useQuery({
    queryKey: getProcessesQueryKey(activeBackendId, limit, range),
    queryFn: () => api.getProcesses(activeBackendId, limit, range),
    enabled: !!activeBackendId && enabled,
    placeholderData: keepPreviousData,
    staleTime: QUERY_CONFIG.STALE_TIME.REALTIME,
  });
}

interface UseProcessDetailOptions {
  process?: string;
  processPath?: string;
  activeBackendId?: number;
  range?: TimeRange;
  enabled?: boolean;
}

function processIdentity(process?: string, processPath?: string, activeBackendId?: number) {
  return {
    process: process ?? "",
    processPath: processPath ?? "",
    backendId: activeBackendId ?? null,
  };
}

export function useProcessDomains({
  process,
  processPath,
  activeBackendId,
  range,
  enabled = true,
}: UseProcessDetailOptions) {
  return useQuery({
    queryKey: getProcessDomainsQueryKey(process ?? null, processPath ?? null, activeBackendId, range),
    queryFn: () => {
      if (!process || !activeBackendId) throw new Error("Missing params");
      return api.getProcessDomains(process, processPath, activeBackendId, range);
    },
    enabled: !!activeBackendId && !!process && enabled,
    staleTime: QUERY_CONFIG.STALE_TIME.DETAIL,
    placeholderData: (previousData, previousQuery) =>
      keepPreviousByIdentity(previousData, previousQuery, processIdentity(process, processPath, activeBackendId)),
  });
}

export function useProcessIPs({
  process,
  processPath,
  activeBackendId,
  range,
  enabled = true,
}: UseProcessDetailOptions) {
  return useQuery({
    queryKey: getProcessIPsQueryKey(process ?? null, processPath ?? null, activeBackendId, range),
    queryFn: () => {
      if (!process || !activeBackendId) throw new Error("Missing params");
      return api.getProcessIPs(process, processPath, activeBackendId, range);
    },
    enabled: !!activeBackendId && !!process && enabled,
    staleTime: QUERY_CONFIG.STALE_TIME.DETAIL,
    placeholderData: (previousData, previousQuery) =>
      keepPreviousByIdentity(previousData, previousQuery, processIdentity(process, processPath, activeBackendId)),
  });
}

export function useProcessRules({
  process,
  processPath,
  activeBackendId,
  range,
  enabled = true,
}: UseProcessDetailOptions) {
  return useQuery({
    queryKey: getProcessRulesQueryKey(process ?? null, processPath ?? null, activeBackendId, range),
    queryFn: () => {
      if (!process || !activeBackendId) throw new Error("Missing params");
      return api.getProcessRules(process, processPath, activeBackendId, range);
    },
    enabled: !!activeBackendId && !!process && enabled,
    staleTime: QUERY_CONFIG.STALE_TIME.DETAIL,
    placeholderData: (previousData, previousQuery) =>
      keepPreviousByIdentity(previousData, previousQuery, processIdentity(process, processPath, activeBackendId)),
  });
}

export function useProcessProxies({
  process,
  processPath,
  activeBackendId,
  range,
  enabled = true,
}: UseProcessDetailOptions) {
  return useQuery({
    queryKey: getProcessProxiesQueryKey(process ?? null, processPath ?? null, activeBackendId, range),
    queryFn: () => {
      if (!process || !activeBackendId) throw new Error("Missing params");
      return api.getProcessProxies(process, processPath, activeBackendId, range);
    },
    enabled: !!activeBackendId && !!process && enabled,
    staleTime: QUERY_CONFIG.STALE_TIME.DETAIL,
    placeholderData: (previousData, previousQuery) =>
      keepPreviousByIdentity(previousData, previousQuery, processIdentity(process, processPath, activeBackendId)),
  });
}
