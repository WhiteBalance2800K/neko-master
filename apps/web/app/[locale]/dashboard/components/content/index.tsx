"use client";

import { useState, memo } from "react";
import { useTranslations } from "next-intl";
import {
  keepPreviousData,
  useQuery,
} from "@tanstack/react-query";
import { BarChart3, Link2, Settings } from "lucide-react";
import { StatsCards } from "@/components/features/stats";
import { OverviewTab } from "@/components/overview";
import { InteractiveProxyStats } from "@/components/features/proxies";
import { InteractiveDeviceStats } from "@/components/features/devices";
import { InteractiveProcessStats } from "@/components/features/processes";
import { InteractiveRuleStats } from "@/components/features/rules";
import { HealthContent } from "@/components/features/health";
import { WorldTrafficMap, CountryTrafficList } from "@/components/features/countries";
import { DomainsTable, IPsTable } from "@/components/features/stats/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InsightThreePanelSkeleton } from "@/components/ui/insight-skeleton";
import { api, type TimeRange } from "@/lib/api";
import { getDevicesQueryKey } from "@/lib/stats-query-keys";
import { useStableTimeRange } from "@/lib/hooks/use-stable-time-range";
import { cn, setPreferredTrafficUnitFromValues } from "@/lib/utils";
import type { BackendStatus, TabId, TimePreset } from "@/lib/types/dashboard";
import type {
  StatsSummary,
  CountryStats,
  DeviceStats,
  ProcessStats,
  ProxyStats,
} from "@neko-master/shared";
import type { PageSize } from "@/lib/stats-utils";

type TrafficTotalLike = {
  totalUpload?: number;
  totalDownload?: number;
};

function trafficTotal(item: TrafficTotalLike | null | undefined): number {
  return Number(item?.totalUpload || 0) + Number(item?.totalDownload || 0);
}

function collectTrafficUnitValues(
  data: StatsSummary | null,
  countryData: CountryStats[],
): number[] {
  return [
    ...(data?.topDomains || []).map(trafficTotal),
    ...(data?.topIPs || []).map(trafficTotal),
    ...(data?.proxyStats || []).map(trafficTotal),
    ...(data?.ruleStats || []).map(trafficTotal),
    ...(data?.deviceStats || []).map(trafficTotal),
    ...(data?.processStats || []).map(trafficTotal),
    ...countryData.map(trafficTotal),
  ];
}

interface ContentProps {
  activeTab: TabId;
  data: StatsSummary | null;
  countryData: CountryStats[];
  error: string | null;
  timeRange: TimeRange;
  timePreset: TimePreset;
  autoRefresh: boolean;
  activeBackendId?: number;
  backendStatus: BackendStatus;
  onNavigate?: (tab: string) => void;
  onOpenBackendDialog?: () => void;
  isLoading?: boolean;
}

// Overview Content Component
const OverviewContent = memo(function OverviewContent({
  data,
  error,
  timeRange,
  timePreset,
  autoRefresh,
  activeBackendId,
  onNavigate,
  backendStatus,
  isLoading,
}: {
  data: StatsSummary | null;
  error: string | null;
  timeRange: TimeRange;
  timePreset: TimePreset;
  autoRefresh: boolean;
  activeBackendId?: number;
  onNavigate?: (tab: string) => void;
  backendStatus: BackendStatus;
  isLoading?: boolean;
}) {
  return (
    <div className="space-y-6">
      <StatsCards 
        data={data} 
        error={error} 
        backendStatus={backendStatus} 
        isLoading={isLoading} 
      />
      <OverviewTab
        domains={data?.topDomains || []}
        proxies={data?.proxyStats || []}
        timeRange={timeRange}
        timePreset={timePreset}
        autoRefresh={autoRefresh}
        activeBackendId={activeBackendId}
        onNavigate={onNavigate}
        backendStatus={backendStatus}
        isLoading={isLoading}
      />
    </div>
  );
});

// Targets Content Component
const TargetsContent = memo(function TargetsContent({
  activeBackendId,
  timeRange,
  autoRefresh,
  countryData,
}: {
  activeBackendId?: number;
  timeRange: TimeRange;
  autoRefresh: boolean;
  countryData: CountryStats[];
}) {
  const t = useTranslations("domains");
  const countriesT = useTranslations("countries");
  const [sharedPageSize, setSharedPageSize] = useState<PageSize>(10);

  return (
    <div className="space-y-6">
      <Tabs defaultValue="domains" className="w-full">
        <TabsList className="glass">
          <TabsTrigger value="domains">{t("domainList")}</TabsTrigger>
          <TabsTrigger value="ips">{t("ipList")}</TabsTrigger>
          <TabsTrigger value="geo">{countriesT("title")}</TabsTrigger>
        </TabsList>
        <TabsContent value="domains" className="overflow-hidden">
          <DomainsTable
            activeBackendId={activeBackendId}
            timeRange={timeRange}
            autoRefresh={autoRefresh}
            pageSize={sharedPageSize}
            onPageSizeChange={setSharedPageSize}
          />
        </TabsContent>
        <TabsContent value="ips" className="overflow-hidden">
          <IPsTable
            activeBackendId={activeBackendId}
            timeRange={timeRange}
            autoRefresh={autoRefresh}
            pageSize={sharedPageSize}
            onPageSizeChange={setSharedPageSize}
          />
        </TabsContent>
        <TabsContent value="geo" className="overflow-hidden">
          <CountriesContent countryData={countryData} />
        </TabsContent>
      </Tabs>
    </div>
  );
});

// Countries Content Component
const CountriesContent = memo(function CountriesContent({
  countryData,
}: {
  countryData: CountryStats[];
}) {
  const t = useTranslations("countries");
  const [sortBy, setSortBy] = useState<"traffic" | "connections">("traffic");

  return (
    <div className="space-y-6">
      <WorldTrafficMap data={countryData} />
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-lg font-semibold">
              {t("details")}
            </CardTitle>
            <div className="flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-7 w-7 rounded-md transition-all",
                  sortBy === "traffic"
                    ? "bg-background shadow-sm text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setSortBy("traffic")}
                title={t("sortByTraffic")}
                aria-label={t("sortByTraffic")}
              >
                <BarChart3 className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-7 w-7 rounded-md transition-all",
                  sortBy === "connections"
                    ? "bg-background shadow-sm text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setSortBy("connections")}
                title={t("sortByConnections")}
                aria-label={t("sortByConnections")}
              >
                <Link2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <CountryTrafficList data={countryData} sortBy={sortBy} />
        </CardContent>
      </Card>
    </div>
  );
});

// Proxies Content Component
const ProxiesContent = memo(function ProxiesContent({
  data,
  activeBackendId,
  timeRange,
  backendStatus,
  autoRefresh,
}: {
  data?: ProxyStats[];
  activeBackendId?: number;
  timeRange: TimeRange;
  backendStatus: BackendStatus;
  autoRefresh: boolean;
}) {
  return (
    <div className="space-y-6">
      <InteractiveProxyStats
        data={data}
        activeBackendId={activeBackendId}
        timeRange={timeRange}
        backendStatus={backendStatus}
        autoRefresh={autoRefresh}
      />
    </div>
  );
});

// Rules Content Component
const RulesContent = memo(function RulesContent({
  activeBackendId,
  timeRange,
  backendStatus,
  autoRefresh,
}: {
  activeBackendId?: number;
  timeRange: TimeRange;
  backendStatus: BackendStatus;
  autoRefresh: boolean;
}) {
  return (
    <div className="space-y-6">
      <InteractiveRuleStats
        activeBackendId={activeBackendId}
        timeRange={timeRange}
        backendStatus={backendStatus}
        autoRefresh={autoRefresh}
      />
    </div>
  );
});

// Links Content Component
const LinksContent = memo(function LinksContent({
  data,
  activeBackendId,
  timeRange,
  backendStatus,
  autoRefresh,
}: {
  data: StatsSummary | null;
  activeBackendId?: number;
  timeRange: TimeRange;
  backendStatus: BackendStatus;
  autoRefresh: boolean;
}) {
  const rulesT = useTranslations("rules");
  const proxiesT = useTranslations("proxies");

  return (
    <div className="space-y-6">
      <Tabs defaultValue="rules" className="w-full">
        <TabsList className="glass">
          <TabsTrigger value="rules">{rulesT("title")}</TabsTrigger>
          <TabsTrigger value="proxies">{proxiesT("title")}</TabsTrigger>
        </TabsList>
        <TabsContent value="rules" className="mt-4">
          <RulesContent
            activeBackendId={activeBackendId}
            timeRange={timeRange}
            backendStatus={backendStatus}
            autoRefresh={autoRefresh}
          />
        </TabsContent>
        <TabsContent value="proxies" className="mt-4">
          <ProxiesContent
            data={data?.proxyStats}
            activeBackendId={activeBackendId}
            timeRange={timeRange}
            backendStatus={backendStatus}
            autoRefresh={autoRefresh}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
});

// Devices Content Component
const DevicesContent = memo(function DevicesContent({
  data,
  activeBackendId,
  timeRange,
  backendStatus,
  autoRefresh,
}: {
  data?: DeviceStats[];
  activeBackendId?: number;
  timeRange: TimeRange;
  backendStatus: BackendStatus;
  autoRefresh: boolean;
}) {
  const stableTimeRange = useStableTimeRange(timeRange, { roundToMinute: true });

  const devicesQuery = useQuery({
    queryKey: getDevicesQueryKey(activeBackendId, 50, stableTimeRange),
    queryFn: () => api.getDevices(activeBackendId, 50, stableTimeRange),
    enabled: !data && !!activeBackendId,
    placeholderData: keepPreviousData,
  });

  const deviceStats: DeviceStats[] = data ?? devicesQuery.data ?? [];
  const loading = !data && devicesQuery.isLoading && !devicesQuery.data;

  if (loading) {
    return (
      <Card>
        <CardContent className="p-5 sm:p-6">
          <InsightThreePanelSkeleton />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <InteractiveDeviceStats
        data={deviceStats}
        activeBackendId={activeBackendId}
        timeRange={timeRange}
        backendStatus={backendStatus}
        autoRefresh={autoRefresh}
      />
    </div>
  );
});

const ProcessesContent = memo(function ProcessesContent({
  data,
  activeBackendId,
  timeRange,
  backendStatus,
}: {
  data?: ProcessStats[];
  activeBackendId?: number;
  timeRange: TimeRange;
  backendStatus: BackendStatus;
}) {
  return (
    <InteractiveProcessStats
      data={data}
      activeBackendId={activeBackendId}
      timeRange={timeRange}
      backendStatus={backendStatus}
    />
  );
});

const SourcesContent = memo(function SourcesContent({
  data,
  activeBackendId,
  timeRange,
  backendStatus,
  autoRefresh,
}: {
  data: StatsSummary | null;
  activeBackendId?: number;
  timeRange: TimeRange;
  backendStatus: BackendStatus;
  autoRefresh: boolean;
}) {
  const devicesT = useTranslations("devices");
  const processesT = useTranslations("processes");

  return (
    <div className="space-y-6">
      <Tabs defaultValue="devices" className="w-full">
        <TabsList className="glass">
          <TabsTrigger value="devices">{devicesT("title")}</TabsTrigger>
          <TabsTrigger value="processes">{processesT("title")}</TabsTrigger>
        </TabsList>
        <TabsContent value="devices" className="mt-4">
          <DevicesContent
            data={data?.deviceStats}
            activeBackendId={activeBackendId}
            timeRange={timeRange}
            backendStatus={backendStatus}
            autoRefresh={autoRefresh}
          />
        </TabsContent>
        <TabsContent value="processes" className="mt-4">
          <ProcessesContent
            data={data?.processStats}
            activeBackendId={activeBackendId}
            timeRange={timeRange}
            backendStatus={backendStatus}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
});

const SystemContent = memo(function SystemContent({
  timeRange,
  onOpenBackendDialog,
}: {
  timeRange: TimeRange;
  onOpenBackendDialog?: () => void;
}) {
  const healthT = useTranslations("health");
  const backendT = useTranslations("backend");
  const systemT = useTranslations("system");

  return (
    <Tabs defaultValue="health" className="w-full">
      <TabsList className="glass">
        <TabsTrigger value="health">{healthT("title")}</TabsTrigger>
        <TabsTrigger value="backend">{backendT("title")}</TabsTrigger>
      </TabsList>
      <TabsContent value="health" className="mt-4">
        <HealthContent timeRange={timeRange} />
      </TabsContent>
      <TabsContent value="backend" className="mt-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <Settings className="h-4 w-4" />
              {backendT("title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button onClick={onOpenBackendDialog}>{systemT("openBackendSettings")}</Button>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
});

export function Content({
  activeTab,
  data,
  countryData,
  error,
  timeRange,
  timePreset,
  autoRefresh,
  activeBackendId,
  backendStatus,
  onNavigate,
  onOpenBackendDialog,
}: ContentProps) {
  setPreferredTrafficUnitFromValues(collectTrafficUnitValues(data, countryData));

  const renderContent = () => {
    switch (activeTab) {
      case "overview":
        return (
          <OverviewContent
            data={data}
            error={error}
            timeRange={timeRange}
            timePreset={timePreset}
            autoRefresh={autoRefresh}
            activeBackendId={activeBackendId}
            onNavigate={onNavigate}
            backendStatus={backendStatus}
          />
        );
      case "links":
        return (
          <LinksContent
            data={data}
            activeBackendId={activeBackendId}
            timeRange={timeRange}
            backendStatus={backendStatus}
            autoRefresh={autoRefresh}
          />
        );
      case "targets":
        return (
          <TargetsContent
            activeBackendId={activeBackendId}
            timeRange={timeRange}
            autoRefresh={autoRefresh}
            countryData={countryData}
          />
        );
      case "sources":
        return (
          <SourcesContent
            data={data}
            activeBackendId={activeBackendId}
            timeRange={timeRange}
            backendStatus={backendStatus}
            autoRefresh={autoRefresh}
          />
        );
      case "system":
        return <SystemContent timeRange={timeRange} onOpenBackendDialog={onOpenBackendDialog} />;
      default:
        return (
          <OverviewContent
            data={data}
            error={error}
            timeRange={timeRange}
            timePreset={timePreset}
            autoRefresh={autoRefresh}
            activeBackendId={activeBackendId}
            onNavigate={onNavigate}
            backendStatus={backendStatus}
          />
        );
    }
  };

  return (
    <div>
      {renderContent()}
    </div>
  );
}
