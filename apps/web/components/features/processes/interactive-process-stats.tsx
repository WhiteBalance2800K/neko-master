"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, Binary, Cpu, Link2, Route, Waypoints } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DomainStatsTable, IPStatsTable } from "@/components/features/stats/table";
import { InsightThreePanelSkeleton } from "@/components/ui/insight-skeleton";
import { useStableTimeRange } from "@/lib/hooks/use-stable-time-range";
import { formatBytes, formatNumber } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { type TimeRange } from "@/lib/api";
import { type PageSize } from "@/lib/stats-utils";
import {
  useProcessDomains,
  useProcessIPs,
  useProcessProxies,
  useProcessRules,
  useProcesses,
} from "@/hooks/api/use-processes";
import type { ProcessStats, ProxyStats, RuleStats } from "@neko-master/shared";

interface InteractiveProcessStatsProps {
  data?: ProcessStats[];
  activeBackendId?: number;
  timeRange?: TimeRange;
  backendStatus?: "healthy" | "unhealthy" | "unknown";
}

type ProcessRow = ProcessStats & {
  key: string;
  total: number;
  rank: number;
};

function processKey(process: string, processPath?: string) {
  return `${process}\0${processPath || ""}`;
}

function compactPath(path?: string) {
  if (!path) return "";
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 3) return path;
  return `.../${parts.slice(-3).join("/")}`;
}

function DetailMetricList({
  title,
  icon: Icon,
  data,
  kind,
}: {
  title: string;
  icon: typeof Route;
  data: RuleStats[] | ProxyStats[];
  kind: "rules" | "proxies";
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          <Icon className="h-4 w-4" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border/50">
          {data.map((item) => {
            const name = kind === "rules" ? (item as RuleStats).rule : (item as ProxyStats).chain;
            const total = item.totalDownload + item.totalUpload;
            return (
              <div key={name} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium" title={name}>
                    {name || "DIRECT"}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="traffic-download-text">
                      DL {formatBytes(item.totalDownload)}
                    </span>
                    <span className="traffic-upload-text">
                      UL {formatBytes(item.totalUpload)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Link2 className="h-3 w-3" />
                      {formatNumber(item.totalConnections)}
                    </span>
                  </div>
                </div>
                <div className="text-right text-sm font-semibold tabular-nums">
                  {formatBytes(total)}
                </div>
              </div>
            );
          })}
          {data.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              -
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function InteractiveProcessStats({
  data,
  activeBackendId,
  timeRange,
  backendStatus,
}: InteractiveProcessStatsProps) {
  const t = useTranslations("processes");
  const domainsT = useTranslations("domains");
  const ipsT = useTranslations("ips");
  const rulesT = useTranslations("rules");
  const proxiesT = useTranslations("proxies");
  const dashboardT = useTranslations("dashboard");
  const stableTimeRange = useStableTimeRange(timeRange, { roundToMinute: true });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("domains");
  const [detailPageSize, setDetailPageSize] = useState<PageSize>(10);

  const { data: listData, isLoading: listLoading } = useProcesses({
    activeBackendId,
    limit: 50,
    range: stableTimeRange,
    enabled: !data && !!activeBackendId,
  });

  const processData = data ?? listData ?? [];
  const rows = useMemo<ProcessRow[]>(
    () =>
      processData.map((item, index) => ({
        ...item,
        key: processKey(item.process, item.processPath),
        total: item.totalDownload + item.totalUpload,
        rank: index,
      })),
    [processData],
  );
  const totalTraffic = useMemo(() => rows.reduce((sum, item) => sum + item.total, 0), [rows]);
  const maxTraffic = useMemo(() => (rows.length ? Math.max(...rows.map((item) => item.total)) : 1), [rows]);

  useEffect(() => {
    if (rows.length === 0) {
      setSelectedKey(null);
      return;
    }
    if (!selectedKey || !rows.some((item) => item.key === selectedKey)) {
      setSelectedKey(rows[0].key);
    }
  }, [rows, selectedKey]);

  const selected = useMemo(
    () => rows.find((item) => item.key === selectedKey) ?? null,
    [rows, selectedKey],
  );

  const detailParams = {
    process: selected?.process,
    processPath: selected?.processPath,
    activeBackendId,
    range: stableTimeRange,
    enabled: !!selected,
  };

  const { data: domains = [], isLoading: domainsLoading } = useProcessDomains(detailParams);
  const { data: ips = [], isLoading: ipsLoading } = useProcessIPs(detailParams);
  const { data: rules = [], isLoading: rulesLoading } = useProcessRules(detailParams);
  const { data: proxies = [], isLoading: proxiesLoading } = useProcessProxies(detailParams);
  const detailLoading =
    !!selected &&
    (domainsLoading || ipsLoading || rulesLoading || proxiesLoading) &&
    domains.length === 0 &&
    ips.length === 0 &&
    rules.length === 0 &&
    proxies.length === 0;

  const topTargets = domains.slice(0, 5);

  if (!data && listLoading && !listData) {
    return (
      <Card>
        <CardContent className="p-5 sm:p-6">
          <InsightThreePanelSkeleton />
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    const emptyHint =
      backendStatus === "unhealthy"
        ? dashboardT("backendUnavailableHint")
        : t("noDataHint");
    return (
      <Card>
        <CardContent className="p-5 sm:p-6">
          <div className="min-h-[220px] rounded-xl border border-dashed border-border/60 bg-card/30 px-4 py-6 flex flex-col items-center justify-center text-center">
            <Cpu className="h-8 w-8 text-muted-foreground/70 mb-2" />
            <p className="text-sm font-medium text-muted-foreground">{t("noData")}</p>
            <p className="text-xs text-muted-foreground/80 mt-1 max-w-xs">{emptyHint}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <Card className="xl:col-span-5 min-w-0">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <Cpu className="h-4 w-4" />
              {t("title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <ScrollArea className="h-[330px] pr-3">
              <div className="space-y-2">
                {rows.map((item) => {
                  const isSelected = item.key === selectedKey;
                  const percentage = totalTraffic > 0 ? (item.total / totalTraffic) * 100 : 0;
                  const width = maxTraffic > 0 ? (item.total / maxTraffic) * 100 : 0;
                  return (
                    <button
                      key={item.key}
                      onClick={() => setSelectedKey(item.key)}
                      className={cn(
                        "w-full rounded-xl border p-3 text-left transition-[background-color,border-color,transform] active:scale-[0.99]",
                        isSelected
                          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                          : "border-border/50 bg-card/50 hover:bg-card hover:border-primary/30",
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-semibold tabular-nums">
                          {item.rank + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold" title={item.processPath || item.process}>
                            {item.process || t("unknown")}
                          </div>
                          {item.processPath && (
                            <div className="truncate text-[11px] text-muted-foreground" title={item.processPath}>
                              {compactPath(item.processPath)}
                            </div>
                          )}
                        </div>
                        <div className="text-right text-sm font-bold tabular-nums">
                          {formatBytes(item.total)}
                        </div>
                      </div>
                      <div className="mt-2 pl-8">
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${width}%` }} />
                        </div>
                        <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span>{percentage.toFixed(1)}%</span>
                          <span className="inline-flex items-center gap-1">
                            <Link2 className="h-3 w-3" />
                            {formatNumber(item.totalConnections)}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="xl:col-span-7 min-w-0">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <Activity className="h-4 w-4" />
              {domainsT("title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {detailLoading ? (
              <InsightThreePanelSkeleton />
            ) : (
              <div className="space-y-3">
                {topTargets.map((domain) => {
                  const total = domain.totalDownload + domain.totalUpload;
                  return (
                    <div key={domain.domain} className="grid grid-cols-[1fr_auto] gap-3 rounded-lg bg-muted/35 px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{domain.domain}</div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>{domain.ips.length} IP</span>
                          <span>{formatNumber(domain.totalConnections)} {domainsT("connections")}</span>
                        </div>
                      </div>
                      <div className="text-sm font-semibold tabular-nums">{formatBytes(total)}</div>
                    </div>
                  );
                })}
                {topTargets.length === 0 && (
                  <div className="min-h-[220px] rounded-xl border border-dashed border-border/60 bg-card/30 px-4 py-6 flex items-center justify-center text-sm text-muted-foreground">
                    {domainsT("noData")}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {selected && (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="glass">
            <TabsTrigger value="domains">{domainsT("domainList")}</TabsTrigger>
            <TabsTrigger value="ips">{ipsT("title")}</TabsTrigger>
            <TabsTrigger value="rules">{rulesT("title")}</TabsTrigger>
            <TabsTrigger value="proxies">{proxiesT("title")}</TabsTrigger>
          </TabsList>
          <TabsContent value="domains" className="mt-4">
            <DomainStatsTable
              domains={domains}
              loading={detailLoading}
              pageSize={detailPageSize}
              onPageSizeChange={setDetailPageSize}
              activeBackendId={activeBackendId}
              timeRange={timeRange}
              richExpand
            />
          </TabsContent>
          <TabsContent value="ips" className="mt-4">
            <IPStatsTable
              ips={ips}
              loading={detailLoading}
              pageSize={detailPageSize}
              onPageSizeChange={setDetailPageSize}
              activeBackendId={activeBackendId}
              timeRange={timeRange}
              richExpand
            />
          </TabsContent>
          <TabsContent value="rules" className="mt-4">
            <DetailMetricList title={rulesT("ruleList")} icon={Route} data={rules} kind="rules" />
          </TabsContent>
          <TabsContent value="proxies" className="mt-4">
            <DetailMetricList title={proxiesT("proxyNodes")} icon={Waypoints} data={proxies} kind="proxies" />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
