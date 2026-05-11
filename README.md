<p align="center">
  <img src="./assets/icon-neko-master.png" width="200" alt="Neko Master Logo" style="margin-bottom: 16px;">
  <br>
  <b style="font-size: 32px;">Neko Master</b>
</p>

<p align="center">
  <b>面向 Clash / Mihomo / Surge 的网络流量链路分析面板。</b><br>
  <span>实时采集 · 进程归因 · 规则链路 · 目标分析 · 多后端管理</span>
</p>

<p align="center">
  <b>中文</b> | <a href="./README.en.md">English</a> | <a href="https://github.com/foru17/neko-master">原项目</a>
</p>

<p align="center">
  <a href="https://github.com/WhiteBalance2800K/neko-master"><img src="https://img.shields.io/badge/GitHub-WhiteBalance2800K%2Fneko--master-181717?style=flat-square&logo=github" alt="GitHub"></a>
  <a href="https://hub.docker.com/r/whitebalance2026/neko-master"><img src="https://img.shields.io/badge/Docker-whitebalance2026%2Fneko--master-2496ED?style=flat-square&logo=docker" alt="Docker"></a>
  <img src="https://img.shields.io/badge/Node.js-22-339933?style=flat-square&logo=node.js" alt="Node.js 22">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License">
</p>

> [!IMPORTANT]
> 本项目是本地网关流量分析与可视化工具，不提供任何网络接入服务、代理订阅或跨网络连接能力。所有数据均来源于用户自有网络环境。请在合规范围内使用。

## 与原项目的不同

本仓库基于 [foru17/neko-master](https://github.com/foru17/neko-master) 修改，重点从“多个统计排行榜”调整为“链路分析仪”：让使用者优先看清楚谁发起连接、访问了哪里、命中什么规则、走哪个代理、是否存在异常。

主要差异：

| 方向 | 本仓库改动 |
| --- | --- |
| 信息架构 | 一级导航重组为「概览 / 链路 / 目标 / 来源 / 系统」，减少规则、域名、地区、代理之间的重复展示。 |
| 概览页 | 保留总流量、趋势、热门域名、热门代理，移除不够清晰的来源/进程/目标摘要和热门地区。 |
| 链路页 | 合并规则与代理视角，支持规则命中和代理出口切换；规则链路流向默认全景展示，并增强流动粒子效果。 |
| 目标页 | 将域名、IP、地理信息合并为统一目标浏览器，地区不再作为独立一级页面。 |
| 来源页 | 新增进程维度，并与设备来源整合；进程默认展示名称，完整路径用于详情信息。 |
| 进程归因 | Clash / Surge / Agent 采集链路增加 `process` / `processPath` 传递、聚合和展示能力。 |
| 数据聚合 | 增加进程统计表和进程维度查询 API，支持「进程 -> 域名 / IP / 规则 / 代理」钻取。 |
| ClickHouse | `traffic_detail` 兼容新增进程字段，旧数据默认空值，不破坏既有数据。 |
| 实时连接 | 新增 `/api/gateway/connections`，用于展示当前连接的设备、协议、端口、规则、代理链、目标和速率等实时信息；长期只保存聚合数据。 |
| 展示细节 | 全项目流量单位按 Top 流量自动统一到 MB / GB / TB；方形站点图标裁切更自然；自动刷新改为按钮旋转。 |
| 可靠性 | Clash WebSocket collector 增加心跳 watchdog，后端断链、关机或重启后会主动恢复采集，不再依赖重新添加后端。 |
| Docker | 本仓库后续镜像使用 `whitebalance2026/neko-master` 命名。 |

## 截图

<table>
  <tr>
    <td align="center" width="50%">
      <img src="./assets/neko-master-overview-light.png" alt="Neko Master Overview Light" />
    </td>
    <td align="center" width="50%">
      <img src="./assets/neko-master-regions-light.png" alt="Neko Master Targets Light" />
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="./assets/neko-master-rules-dark.png" alt="Neko Master Links Dark" />
    </td>
    <td align="center" width="50%">
      <img src="./assets/neko-master-domains-dark.png" alt="Neko Master Domains Dark" />
    </td>
  </tr>
</table>

## 快速开始

### Docker Compose

```yaml
services:
  neko-master:
    image: whitebalance2026/neko-master:v1.6
    container_name: neko-master
    restart: unless-stopped
    ports:
      - "3000:3000" # Web UI
      - "3001:3001" # API
      - "3002:3002" # WebSocket
    volumes:
      - ./data:/app/data
      - ./geoip:/app/data/geoip:ro
    environment:
      - NODE_ENV=production
      - DB_PATH=/app/data/stats.db
      - COOKIE_SECRET=${COOKIE_SECRET}
```

建议在同目录 `.env` 中配置固定密钥：

```bash
COOKIE_SECRET="$(openssl rand -hex 32)"
```

启动：

```bash
docker compose up -d
```

访问：

```text
http://localhost:3000
```

### Docker Run

```bash
export COOKIE_SECRET="$(openssl rand -hex 32)"

docker run -d \
  --name neko-master \
  -p 3000:3000 \
  -p 3001:3001 \
  -p 3002:3002 \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/geoip:/app/data/geoip:ro" \
  -e COOKIE_SECRET="$COOKIE_SECRET" \
  --restart unless-stopped \
  whitebalance2026/neko-master:v1.6
```

### 源码运行

```bash
git clone https://github.com/WhiteBalance2800K/neko-master.git
cd neko-master
pnpm install
cp apps/collector/.env.example apps/collector/.env
pnpm dev
```

开发模式默认端口：

| 服务 | 端口 |
| --- | --- |
| Web | `3000` |
| API | `3001` |
| WebSocket | `3002` |

## 后端接入

支持三类采集路径：

| 类型 | 说明 |
| --- | --- |
| Clash / Mihomo | 通过 `/connections` WebSocket 实时采集连接与流量。 |
| Surge | 通过 Surge HTTP API 轮询近期请求。 |
| Agent | 远端设备运行 agent，本地拉取网关数据后上报到面板，适合多设备或网关无法被面板直连的场景。 |

Agent 安装脚本位于：

```text
apps/agent/install.sh
```

## 数据与隐私策略

- 长期保存聚合统计：设备 IP、进程名/路径、规则/规则载荷、代理链、域名/IP、国家、ASN/组织、上传/下载、连接数、最后出现时间。
- 实时连接细节只用于当前连接面板，不作为长期逐连接明细保存。
- 旧数据与新增字段兼容，新增字段缺失时按空值处理。

## 常用环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `WEB_PORT` | `3000` | Web 服务端口 |
| `API_PORT` | `3001` | API 服务端口 |
| `COLLECTOR_WS_PORT` | `3002` | WebSocket 服务端口 |
| `DB_PATH` | `/app/data/stats.db` | SQLite 数据库路径 |
| `COOKIE_SECRET` | 空 | 登录会话密钥，生产部署建议固定配置 |
| `GEOIP_LOOKUP_PROVIDER` | 空 | IP 地理信息来源 |
| `CH_ENABLED` | `0` | 是否启用 ClickHouse |
| `STATS_QUERY_SOURCE` | `sqlite` | 统计查询数据源 |
| `GATEWAY_WS_HEARTBEAT_INTERVAL_MS` | `15000` | Clash WebSocket 心跳间隔 |
| `GATEWAY_WS_HEARTBEAT_TIMEOUT_MS` | `45000` | Clash WebSocket 心跳超时 |

## 项目结构

```text
apps/
  agent/       远端采集 agent
  collector/   后端 API、采集器、SQLite/ClickHouse 写入与查询
  web/         Next.js 前端面板
packages/
  shared/      前后端共享类型与工具
docs/          架构与部署文档
```

## 技术栈

- Web：Next.js、React、TypeScript、Tailwind CSS
- Collector：Fastify、WebSocket、better-sqlite3
- 数据：SQLite，ClickHouse 可选
- Agent：Go
- 构建：pnpm workspace、Turbo、Docker

## 许可证

MIT License。原项目版权与许可证声明请见 [LICENSE](./LICENSE)。
