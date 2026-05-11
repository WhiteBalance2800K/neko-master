"use client";

import { Cpu, Globe2, MapPin, Route, Server, Smartphone } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { formatBytes, formatNumber } from "@/lib/utils";
import type {
  CountryStats,
  DeviceStats,
  DomainStats,
  ProcessStats,
  ProxyStats,
  RuleStats,
} from "@neko-master/shared";

interface KeyPathSummaryProps {
  devices?: DeviceStats[];
  processes?: ProcessStats[];
  domains?: DomainStats[];
  rules?: RuleStats[];
  proxies?: ProxyStats[];
  countries?: CountryStats[];
}

function trafficOf(item?: { totalUpload: number; totalDownload: number }) {
  if (!item) return 0;
  return item.totalUpload + item.totalDownload;
}

function SummaryCell({
  icon: Icon,
  label,
  value,
  meta,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  meta: string;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/35 px-3 py-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="truncate text-sm font-semibold" title={value}>
        {value || "-"}
      </div>
      <div className="mt-1 text-xs tabular-nums text-muted-foreground">
        {meta}
      </div>
    </div>
  );
}

export function KeyPathSummary({
  devices,
  processes,
  domains,
  rules,
  proxies,
  countries,
}: KeyPathSummaryProps) {
  const t = useTranslations("overviewPath");
  const topDevice = devices?.[0];
  const topProcess = processes?.[0];
  const topDomain = domains?.[0];
  const topRule = rules?.[0];
  const topProxy = proxies?.[0];
  const topCountry = countries?.[0];

  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <SummaryCell
            icon={Smartphone}
            label={t("source")}
            value={topDevice?.sourceIP || "-"}
            meta={`${formatBytes(trafficOf(topDevice))} / ${formatNumber(topDevice?.totalConnections || 0)}`}
          />
          <SummaryCell
            icon={Cpu}
            label={t("process")}
            value={topProcess?.process || "-"}
            meta={`${formatBytes(trafficOf(topProcess))} / ${formatNumber(topProcess?.totalConnections || 0)}`}
          />
          <SummaryCell
            icon={Globe2}
            label={t("target")}
            value={topDomain?.domain || "-"}
            meta={`${formatBytes(trafficOf(topDomain))} / ${formatNumber(topDomain?.totalConnections || 0)}`}
          />
          <SummaryCell
            icon={Route}
            label={t("rule")}
            value={topRule?.rule || "-"}
            meta={`${formatBytes(trafficOf(topRule))} / ${formatNumber(topRule?.totalConnections || 0)}`}
          />
          <SummaryCell
            icon={Server}
            label={t("proxy")}
            value={topProxy?.chain || "-"}
            meta={`${formatBytes(trafficOf(topProxy))} / ${formatNumber(topProxy?.totalConnections || 0)}`}
          />
          <SummaryCell
            icon={MapPin}
            label={t("region")}
            value={topCountry?.countryName || topCountry?.country || "-"}
            meta={`${formatBytes(trafficOf(topCountry))} / ${formatNumber(topCountry?.totalConnections || 0)}`}
          />
        </div>
      </CardContent>
    </Card>
  );
}
