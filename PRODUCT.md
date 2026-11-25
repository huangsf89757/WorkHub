# PRODUCT.md — WorkHub

## 产品
WorkHub 是一个**程序员个人效率工作台**（零构建，原生 HTML/CSS/JS + ES Modules）。目标形态为**全端**（mac / Windows / iPhone / iPad / Android）+ **本地优先的多端同步**；当前内核已就绪，业务功能以可插拔扩展形式逐步补齐。

## 用户
HSF：iOS 开发者，不限于此——Swift / TypeScript / Go。日常需要：项目管理、任务、代码片段、笔记（多级目录）、学习追踪、开发小工具、快捷链接。单人使用为主，数据本地优先、可离线。

## 访客场景
开发者一天中多次打开：写代码间隙查任务、记笔记、贴片段、转换时间戳。属于 **Operate** 模式——完成任务、快速扫读、键盘友好、信息密度适中。使用环境覆盖桌面浏览器与手机/平板，常伴 IDE 与终端。

## 必须证明的事（本表面）
打开即信：这是一个**给程序员做的工具**，不是通用后台模板。简洁大方、克制、有真实做工；同时支持主题色切换（程序员人设默认深色）。

## 功能事实
- 五区布局：top / left 为主菜单一级入口；center 为主内容；right / bottom 为当前扩展的功能菜单
- 双扩展维度：① 业务功能扩展（自注册 home / detail / panel / status / badge）；② 主题风格（分栏为默认，3D 工作室把扩展挂到场景实物上），全部清单见 FEATURES.md
- 扩展式架构：全部占位业务扩展已移除，清单见 FEATURES.md
- 本地优先数据层：每条记录带同步元数据，outbox 记录变更；存储经适配器抽象
- 同步引擎：LWW 冲突合并、HLC 单调时间戳、outbox 落库、墓碑安全清理与增量 pull；Supabase CloudAdapter 已落地并由 `cloud-sync.js` 自动注入（REST/Auth/RPC 直连，零 SDK），未配置时保持离线 no-op
- 平台适配层：Web / PWA / Electron / Tauri / Capacitor 统一探测
- 主题色切换：提供 4 套配色，偏好持久化

## 约束
- 中文 UI 文案
- 零构建：浏览器直接跑 ES Modules，不引入打包器
- 视图层不碰存储；扩展只通过 core.js 契约接入
- 桌面优先（≥1080px 主场景），窄屏降级可用

## 已否决的方向（anti-reference）
- 紫色渐变 + 玻璃拟态 + emoji 图标的"AI 味"仪表板（用户明确嫌弃）
- 浅色仿 macOS 原生应用（用户不满意）
