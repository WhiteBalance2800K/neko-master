"use client";

import { Activity, Cpu, Link2, Network, ShieldCheck, Waypoints } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useGatewayConnections } from "@/hooks/api/use-gateway";
import { formatBytes } from "@/lib/utils";
import type { LiveConnection } from "@neko-master/shared";

interface LiveConnectionsPanelProps {
  activeBackendId?: number;
  enabled?: boolean;
}

function processLabel(item: LiveConnection) {
  return item.process || (item.processPath ? item.processPath.split(/[\\/]/).filter(Boolean).pop() : "") || "-";
}

function targetLabel(item: LiveConnection) {
  if (item.domain && item.ip) return `${item.domain} / ${item.ip}`;
  return item.domain || item.ip || item.remoteDestination || "-";
}

function portLabel(item: LiveConnection) {
  const protocol = item.network || item.type || "TCP";
  const port = item.destinationPort ? `:${item.destinationPort}` : "";
  return `${protocol}${port}`;
}

function rateLabel(item: LiveConnection) {
  const down = item.downloadSpeed ?? 0;
  const up = item.uploadSpeed ?? 0;
  if (down <= 0 && up <= 0) return "-";
  return `${formatBytes(down)}/s down / ${formatBytes(up)}/s up`;
}

export function LiveConnectionsPanel({
  activeBackendId,
  enabled = true,
}: LiveConnectionsPanelProps) {
  const t = useTranslations("connections");
  const { data, isLoading, isError } = useGatewayConnections({
    activeBackendId,
    limit: 60,
    enabled,
  });

  const connections = data?.connections ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            <Activity className="h-4 w-4" />
            {t("title")}
          </CardTitle>
          {data?._source && (
            <Badge variant="secondary" className="rounded-md uppercase tracking-wide">
              {data._source}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {!data?.supported && data ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t("unsupported")}
          </div>
        ) : isError ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t("unavailable")}
          </div>
        ) : isLoading && connections.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t("loading")}
          </div>
        ) : connections.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t("empty")}
          </div>
        ) : (
          <div className="divide-y divide-border/50 overflow-hidden">
            {connections.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-1 gap-3 px-4 py-3 lg:grid-cols-[minmax(150px,0.9fr)_minmax(180px,1.1fr)_minmax(160px,0.9fr)_minmax(160px,1fr)]"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Cpu className="h-3.5 w-3.5" />
                    {t("process")}
                  </div>
                  <div className="mt-1 truncate text-sm font-medium" title={item.processPath || item.process}>
                    {processLabel(item)}
                  </div>
                  {item.sourceIP && (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {item.sourceIP}
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Network className="h-3.5 w-3.5" />
                    {t("target")}
                  </div>
                  <div className="mt-1 truncate text-sm font-medium" title={targetLabel(item)}>
                    {targetLabel(item)}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {portLabel(item)}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {t("rule")}
                  </div>
                  <div className="mt-1 truncate text-sm font-medium" title={item.rule || item.rulePayload}>
                    {item.rule || "-"}
                  </div>
                  {item.rulePayload && (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {item.rulePayload}
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Waypoints className="h-3.5 w-3.5" />
                    {t("proxy")}
                  </div>
                  <div className="mt-1 truncate text-sm font-medium" title={item.chains.join(" > ")}>
                    {item.chains[0] || "DIRECT"}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Link2 className="h-3 w-3" />
                      {formatBytes(item.download + item.upload)}
                    </span>
                    <span>{rateLabel(item)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
