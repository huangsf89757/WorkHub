/* features.js — 规划中扩展的机器可读清单（人类可读版见 FEATURES.md）
 * 只登记、不实现；扩展中心读取此表展示 roadmap。
 * 真正实现时新建 ext-<id>.js 并在 main.js 注册，同时把此项从本表移除。
 */
export default [
  { id: 'dashboard',  name: '概览',     group: 'Work',      desc: '跨扩展的今日视图：待办、进度、统计聚合',       priority: 'P1' },
  { id: 'projects',   name: '项目管理', group: 'Work',      desc: '项目 / 子任务 / 里程碑，支持状态与标签',       priority: 'P1' },
  { id: 'complaints', name: '客诉管理', group: 'Work',      desc: '工单状态流转 + 处理记录时间线',               priority: 'P2' },
  { id: 'notes',      name: '知识库',   group: 'Knowledge', desc: '多级目录笔记，属性面板 + 变更历史',           priority: 'P1' },
  { id: 'learning',   name: '学习计划', group: 'Knowledge', desc: '学习项进度追踪与优先级排序',                 priority: 'P2' },
  { id: 'blog',       name: '个人博客', group: 'Knowledge', desc: '草稿 / 发布状态的内容管理',                   priority: 'P2' },
  { id: 'tool-time',  name: '时间转换', group: 'Tools',     desc: 'Unix 时间戳与日期互转',                       priority: 'P2' },
  { id: 'tool-json',  name: 'JSON 工具', group: 'Tools',     desc: '格式化 / 压缩 / 校验',                         priority: 'P2' },
  { id: 'tool-regex', name: '正则工具', group: 'Tools',     desc: '实时匹配与高亮',                              priority: 'P2' },
  { id: 'tool-codec', name: '编解码',   group: 'Tools',     desc: 'Base64 与 URL 编解码',                         priority: 'P2' },
  { id: 'tool-crypto',name: '加解密',   group: 'Tools',     desc: 'RSA-OAEP / AES-GCM，WebCrypto 本地运算',       priority: 'P2' },
  { id: 'daily-hotspots', name: '每日热点', group: 'Info', desc: '多类别热点聚合：AI、文娱、科技、财经、体育等，可订阅类别与来源', priority: 'P2' },
  { id: 'clipboard', name: '剪贴板历史', group: 'Tools', desc: '系统级剪贴板历史：全局监听并留存复制记录，支持检索与快捷粘贴（类 PasteNow，依赖桌面壳）', priority: 'P2' },
  { id: 'shortcuts', name: '快捷键',   group: 'Tools', desc: '全局快捷键呼出软键盘，按键一键启动绑定的本机 App（依赖桌面壳）', priority: 'P2' },
];
