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

本仓库基于 [foru17/neko-master](https://github.com/foru17/neko-master) 修改，核心方向是从「统计排行榜」改成「链路分析仪」。

| 删除了什么 | 增加了什么 | 修改了什么 |
| --- | --- | --- |
| 空的「网络」页 | 「概览 / 链路 / 目标 / 来源 / 系统」导航 | 规则 + 代理 → 合并为「链路」 |
| 独立「地区」页 | 进程视图和进程归因 | 域名 + IP + 地区 → 合并为「目标」 |
| 重复的规则 / 域名 / 地区 / 代理排行榜 | 进程统计 API 和聚合表 | 设备 + 进程 → 合并为「来源」 |
| 概览页的混合摘要行 | 实时连接 API | 健康 / 后端 / 设置 / Bark → 归入「系统」 |
| 概览页热门地区 | Bark 流量提醒 | 概览页只保留总量、趋势、热门域名、热门代理 |
| 链路页实时进程板块 | 背景、上传、下载颜色设置 | 链路流向默认全景展示，粒子效果增强 |
| 自动刷新绿色进度条 | 黑、白、灰等基础颜色 | 流量单位按 Top 流量统一为 MB / GB / TB |
| 圆形 favicon 强制展示效果 | Docker 镜像 `whitebalance2026/neko-master` | 方形 favicon 裁切优化 |
| 后端断链后依赖手动重连 | `latest` 和版本镜像标签 | 后端断链 / 重启后自动恢复采集 |
| 背景色切换后的分区缝线 | ClickHouse 进程字段兼容 | 自定义背景改为整体连续背景 |

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
    image: whitebalance2026/neko-master:v1.9.0
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
  whitebalance2026/neko-master:v1.9.0
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
