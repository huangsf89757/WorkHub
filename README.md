# WorkHub

本地优先的个人工作台：数据先落本机 SQLite，联网后按 LWW 策略与 Supabase 云端多端合并。原生 ES Modules、零构建，浏览器/PWA 直接运行。

![version](https://img.shields.io/badge/version-2.3.1-blue)
![platform](https://img.shields.io/badge/platform-web%20%7C%20PWA-lightgrey)
![sync](https://img.shields.io/badge/sync-Supabase-3ECF8E?logo=supabase&logoColor=white)
![license](https://img.shields.io/badge/license-private-grey)

## 特性

- **本地优先**：所有写入先落本机，离线可用；联网后由同步引擎在后台合并
- **五区布局 + 双扩展维度**：业务扩展与主题风格各自独立注册
- **多端同步**：Supabase 云端直连（REST/Auth/RPC，零 SDK），`auth.uid()` RLS 用户隔离，记录级 LWW 冲突收敛
- **可扩展**：统一 `meta` / `outbox` 写路径，新增业务域无需改云端表

## 快速开始

1. 用任意静态服务器托管仓库根目录（零构建，需 HTTP 协议访问）：
   ```sh
   python3 -m http.server 8000
   ```
2. 浏览器打开 `http://localhost:8000`
3. 云端同步：设置 → 账户 → 云端同步（Supabase），Project URL 与 publishable key 已在设置页预填，点「保存配置」后用邮箱注册/登录即启用；若项目开启了 Confirm email，需先在 Supabase 控制台关闭（见 [接入指南](docs/supabase-setup.md)）。未配置时保持纯本地模式

> 自建后端见 [docs/supabase-setup.md](docs/supabase-setup.md)。

## 首次初始化

首次打开（本地未标记初始化完成）会进入分步引导：设置称呼、主题色与主题风格，选择要安装的扩展，确认后进入工作台。配置只在点「进入 WorkHub」时落盘，之后可在设置页随时修改；完成或跳过后不再重复引导。

## 默认安装扩展

全新工作台默认不安装任何业务扩展。编辑根目录 [`extensions.json`](extensions.json) 的 `defaultInstalled` 数组可指定初始化时预装的扩展 id（取值见 [`js/features.js`](js/features.js)）：

```json
{
  "defaultInstalled": ["todo"]
}
```

该配置仅对全新工作台生效（本地从未产生安装记录）；已有用户在扩展中心的安装/卸载选择不会被覆盖。

## 文档

- [产品定位](PRODUCT.md) · [扩展清单](FEATURES.md) · [实现排期](ROADMAP.md)
- [文档索引](docs/README.md)：架构、数据库设计、同步协议、Supabase 接入

## 项目结构

```
js/           核心与扩展（core/data/db/sync、cloud-*、ext-*、theme-style-*）
supabase/     云端迁移与 RLS 验证脚本
docs/         架构、设计、协议与接入指南
tests/        单元测试
```

当前版本见 [`version.json`](version.json)。
