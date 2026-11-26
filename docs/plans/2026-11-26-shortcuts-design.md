# 快捷键管理扩展设计（2026-11-26）

## 背景

- 用户安装了大量软件，系统全局热键（注册后在任何界面按下都触发的键）数量多，重复冲突频发，且难以记忆。
- `FEATURES.md` 原有一个 `shortcuts` 规划（P2「全局快捷键呼出软键盘，一键启动本机 App」），定位是启动器，依赖桌面壳，与本次诉求不同。
- 纯 Web 环境无法自动读取系统已注册的全局热键，冲突检测只能基于"人工录入 / 导入的热键清单"做比对；系统自动扫描需桌面壳，纯 Web 降级引导。

## 目标与非目标

**目标**

- 集中登记本机各软件的全局热键，自动查出重复冲突，给出速查表，解决"记不住"。
- 纯 Web 下手动录入 / 文件导入 / 速查 / 冲突高亮 / 豁免全程可用。

**非目标（本期不做）**

- 不做记忆卡片 / 随机测验类主动复习机制。
- 不做内置预设库（常见软件默认热键）。
- 不做"软键盘启动本机 App"的启动器能力（原规划被本扩展替换）。
- 不在纯 Web 下宣称能自动扫描系统热键。

## 关键决策

### 1. 定位与命名

沿用 id `shortcuts`，名称改为「快捷键管理」，替换 `FEATURES.md` / `features.js` 中原「软键盘启动 App」的规划描述，不新增冗余规划条目。

### 2. 数据模型（纯本地）

数据全部走本地 `store`，**不进 outbox、不随同步上传**，沿用原规划"绑定数据仅本地"的隐私约定。三块数据：

| Key | 结构 | 说明 |
|---|---|---|
| `shortcutsBindings` | `[{ id, combo, app, purpose, enabled, group }]` | 热键清单；`combo` 为规范化组合键，`app` 软件名，`purpose` 用途，`enabled` 是否参与冲突检测，`group` 分组 |
| `shortcutsExemptions` | `[combo]` | 被豁免的冲突组（按规范化 combo 标识），豁免后不再报警 |
| `shortcutsSettings` | `{ scanEnabled }` | 扫描偏好等 |

combo 语法沿用内核 `core.js` 约定（修饰键 `mod/meta/ctrl/alt/shift` + 主键，用 `+` 连接）。新增 `normalizeCombo()` 把录入 / 导入的多种写法（如 `⌘+⇧+A`、`cmd+shift+a`）统一成内核规范形式 `meta+shift+a`，作为精确匹配依据；组合键以字符串形式作为冲突组的稳定标识。

### 3. 冲突检测（精确匹配 + 豁免）

核心是一个纯函数 `detectConflicts(bindings, exemptions)`：

1. 只统计 `enabled === true` 的记录；
2. 按规范化 `combo` 分组；
3. 同组记录数 ≥ 2 判为冲突，输出冲突组 `{ combo, items, exempted }`（`items` 含涉及的软件与用途）；
4. `combo` 命中 `exemptions` 的组标记 `exempted: true`，界面降为"已豁免"、不报警；
5. 判定集中于此函数，便于单测覆盖。

不做范围展开（不像内核 `slotsOf` 的 `1-9` 展开），全局热键按完整组合键精确比对，避免误报。

### 4. 交互（三个有效钩子）

内核 `panel` / `status` 钩子已废弃，只实现 `badge` / `home` / `detail`：

- `home`：主界面。顶部工具条（新增、导入、导出、系统扫描入口）；中部冲突清单（红色未豁免 / 灰色已豁免，写明"哪两个软件在抢哪个键"）；下部速查表（按软件 / 分组展示，支持按键或关键词搜索）。
- `detail`：编辑单条热键字段，并对所在冲突组做豁免 / 取消豁免。
- `badge`：未豁免冲突组数量，为 0 时不显示。

页面结构使用内核通用扩展模板组件（`extHomePage` / `extToolbar` / `extToolButton` / `extTabs`），以兼容两种主题风格布局及"独立窗口"按钮注入规则。

### 5. 降级策略

- 系统扫描端口在纯 Web 下提示"需桌面壳"并禁用按钮，说明清楚，不报错；预留端口供桌面壳注入实现。
- 手动录入与文件导入 / 导出全程可用，是无桌面壳时的主路径。
- 导入解析失败逐条给出错误提示，不污染已有数据。

### 6. 与内核页面级快捷键的关系

内核 `core.js` 已有页面级快捷键（打开扩展 / 设置 / 返回）与 `conflictOf` / `setShortcut` 等设施，但那是 WorkHub 内部导航用途，冲突判定针对扩展与内置动作，与本扩展的"系统全局热键"语义不同。本扩展复用 combo 语法与 `formatShortcut` 做显示格式化，冲突检测独立实现，不修改内核快捷键逻辑。

## 数据流

```
录入 / 导入 / 系统扫描（预留） → normalizeCombo 规范化
        → store.set(shortcutsBindings) → bus.emit('shortcuts-bindings')
        → detectConflicts(bindings, exemptions) → home 冲突清单 + badge 计数
```

## 错误处理

- 无效 combo（空串、无法解析）：拒绝入库并提示。
- 导入文件格式错误 / 字段缺失：逐条报错，跳过坏行，保留有效行。
- 系统扫描不可用：降级引导，不影响其余功能。

## 测试计划

新增 `tests/shortcuts.test.js`（`node --test`，零依赖，沿用 `tests/helpers.js` 的 localStorage / browser stub）：

- `normalizeCombo`：修饰键顺序归一、不同写法等价、主键小写、无效输入。
- `detectConflicts`：无冲突、同键多软件冲突、已禁用记录不参与、豁免生效 / 取消。
- 导入解析：合法 JSON / CSV、坏行跳过、字段缺失。
- 黑盒验证 `home` / `detail` / `badge` 钩子按数据结构产出（最小 DOM stub）。

## 改动清单

新建：

- `js/ext-shortcuts.js`：扩展实现（自注册、三钩子、数据操作、冲突检测、导入导出、扫描端口）。
- `tests/shortcuts.test.js`：单元测试。
- `docs/extensions/shortcuts.md`：扩展文档（作为 `readme` / `docFile` 链接目标）。
- `docs/plans/2026-11-26-shortcuts-design.md`：本文档。

修改：

- `js/main.js`：顶部 `import './ext-shortcuts.js'` 完成组合根接入。
- `js/features.js`：`shortcuts` 条目标题改「快捷键管理」、描述改热键管理与冲突检测、`stage` 改 `published`。
- `FEATURES.md`：规划表移除 `shortcuts` 行、删除原「`shortcuts` 计划要点」段，"已实现扩展"表新增一行。

## 验证方式

- `node --check` 校验新增 / 修改的 JS 文件语法。
- `npm test` 全量通过。
- 浏览器手动验收：录入两条同键热键 → 冲突清单变红、badge 计数；豁免其一 → 转灰且 badge 归零；刷新页面数据仍在（本地存储持久化）；导入 / 导出、纯 Web 下扫描引导。
