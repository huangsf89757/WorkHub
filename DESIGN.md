---
name: WorkHub
description: 程序员本地优先效率工作台，五区布局与可插拔主题风格
colors:
  ink: "#d4d4d4"
  ink-muted: "#9da0a6"
  ink-faint: "#7d8794"
  paper-deep: "#181818"
  paper-panel: "#1f1f1f"
  paper-inset: "#252526"
  rule: "rgba(255,255,255,0.085)"
  accent: "#569cd6"
  success: "#56d364"
  warning: "#e2b341"
  danger: "#f14c4c"
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', sans-serif"
    fontSize: "13px"
    fontWeight: 400
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', sans-serif"
    fontSize: "11px"
    fontWeight: 600
  data:
    fontFamily: "'SF Mono', ui-monospace, Menlo, Consolas, monospace"
    fontSize: "10.5px"
rounded:
  sm: "5px"
  md: "7px"
  lg: "10px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "26px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.paper-deep}"
    rounded: "{rounded.sm}"
    padding: "6px 13px"
  ledger-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "0px"
    padding: "0 14px"
  stamp:
    backgroundColor: "{colors.paper-panel}"
    textColor: "{colors.ink-muted}"
    rounded: "2px"
    padding: "2px 7px"
---

# Design System: WorkHub

## Overview

**Creative North Star: "索引工作台"**

WorkHub 的视觉系统服务于在 IDE、终端与浏览器之间频繁切换的开发者。它不追求品牌海报式的表达，而是把信息当作可检索的索引：固定栏位、稳定节奏、标准控件，用户不需要重新学习界面就能完成任务。

挂载点配置采用三级索引：分区 → 三段槽位 → 文件夹/扩展。中间区是内容区，不作为挂载点；左侧与右侧分为上/中/下，顶部与底部分为左/中/右。每一行把操作放在行尾，加号与删除常驻，扩展行提供启用/停用开关。四套主题色共用同一套语义 token，深色为默认，浅色与终端、OLED 是同一结构的不同纸面。

**Key Characteristics:**
- 高密度但可扫读，信息按结构分区而非按卡片分组
- 等宽字体只承载 ID、计数、路径等数据，不承担装饰
- 强调色只用于当前路由、主操作与状态印记
- 控件保持平台标准形态，不发明新交互符号

## Colors

调色是克制的单强调色体系，颜色负责状态与当前位置，不负责氛围装饰。四套主题色通过 `body[data-theme-color]` 切换同名 token。

### Primary
- **Accent Blue**（#569cd6）：主操作、当前标签、路由结点与绑定计数；浅色主题色为 #005fb8，终端为 #4af626，OLED 为 #4ec9b0。
- **Success Green**（#56d364）：当前使用状态与已完成语义，只作状态色出现。

### Neutrals
- **Ink**（#d4d4d4）：正文与主要数值。
- **Ink Muted**（#9da0a6）：次要标签、表头、说明文字。
- **Ink Faint**（#7d8794）：最低层级提示，不承载关键信息。
- **Paper Deep / Panel / Inset**（#181818 / #1f1f1f / #252526）：三层表面，用层级而非阴影区分容器与内容。
- **Rule**（rgba(255,255,255,0.085)）：分隔线，账册行与面板边界共用。

### Status
- **Warning Amber**（#e2b341）与 **Danger Red**（#f14c4c）只用于警告与错误状态。

## Typography

单一系统无衬线承担全部界面文字，固定字号阶梯，不做流体缩放。等宽字体严格限于代码、ID、计数与路径。

- **Body**：13px / 400，界面默认文字。
- **Label**：11px / 600，面板小标题与表头。
- **Data**：10.5px 等宽，计数、路径、徽标文本。
- **Page title**：19px / 650，页面主标题；标签页 13px。
- 中文标题使用 `text-wrap: balance` 避免末行孤字。

## Layout

- 页面内容最大宽度 920px，桌面主场景 ≥1080px。
- 挂载点配置为单栏三级树：分区行 → 三段槽位行 → 文件夹/扩展行；层级用缩进与正交支线表达。
- 每个分区默认展开三段槽位；删除与新增不改变层级，只作用于当前槽位或文件夹。
- 折叠宽度 ≤640px 时保留完整树，行尾操作压缩为图标按钮。
- 五区外壳（top / left / center / right / bottom）在桌面保持固定尺寸并可拖拽；系统页隐藏侧栏，内容区独占。

## Elevation & Depth

系统以平坦层叠为主：表面色差与细边框建立层级，弹层和浮层使用带偏移与柔和模糊的阴影。卡片不叠加宽阴影，避免“幽灵卡片”。

## Shapes

- 控件圆角：sm 5px、md 7px、lg 10px。
- 状态印记为 2px 小圆角矩形，带完整边框，不使用单侧色条。
- 路由结点环为 7px 圆点，强调色描边；支线为 1px 正交线。

## Components

- **主按钮**：`button-primary`，强调色实底，深色文字，6px 13px 内边距；悬停提亮。
- **次级按钮**：透明底、细边框，悬停时转为强调色描边。
- **分区行**：36px 高，根节点显示结点环；行尾常驻加号（添加文件夹/扩展）与删除（清空绑定），删除必须二次确认。
- **槽位行**：三段显示，左/右为「上/中/下」，顶部/底部为「左/中/右」；行尾同样提供加号与清空。
- **文件夹行**：行尾加号添加扩展到该文件夹，删除按钮二次确认后解除绑定并删除文件夹。
- **扩展行**：行尾为删除按钮与眼睛开关，分别解除挂载和切换启用状态。同一扩展可挂在多个位置，每行是一份独立挂载实例，启停互不影响。
- **状态印记**：完整边框的状态词，颜色由语义 token 决定，不用背景色块代替文字。
- **徽标**：计数与状态使用 20px 圆角胶囊，强调色只给绑定数量。
- **弹窗与浮层**：保留平台标准行为，焦点可见，键盘可操作。

## Do's and Don'ts

- 做：用结构分区表达层级，用表格行表达事实，用语义色表达状态。
- 做：四主题色共用 token；新增控件优先复用现有按钮、徽标、印记 vocabulary。
- 不做：紫色渐变、玻璃拟态、emoji 图标、同尺寸卡片墙。
- 不做：把树拍平成无层级列表，或把新增/删除/启停藏进二级菜单。
- 不做：把中间区当挂载点，或让预览与配置的三段槽位不一致。
- 不做：用等宽字体做“技术感”装饰，或用单侧色条强调容器。
