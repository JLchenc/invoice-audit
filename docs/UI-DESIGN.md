# 发票智审 InvoiceAudit — UI 设计规范（AntD v5）

| 项目 | 内容 |
| --- | --- |
| 版本 | v1.0 |
| 日期 | 2026-10-24 |
| 设计基线 | Ant Design v5（组件库）+ ECharts（图表） |
| 配套文档 | docs/PRD.md |

---

## 1. 设计 Token

### 1.1 色彩

| 用途 | 色值 |
| --- | --- |
| 主色 primary | `#1677ff`（hover `#4096ff`） |
| 成功 success | `#52c41a` |
| 警告 warning | `#faad14` |
| 错误 error / 驳回 | `#ff4d4f` |
| 布局背景 | `#f5f5f5` |
| 容器背景 | `#ffffff` |
| 表头 / 次级背景 | `#fafafa` |
| Sider 深色底 | `#001529` |
| 文字主 / 次 / 弱 | `rgba(0,0,0,.88)` / `.65` / `.45` |
| 边框默认 / 分割线 | `#d9d9d9` / `#f0f0f0` |

Tag 色板（浅底 + 同色系深字 + 细边，圆角 4px）：

| 语义 | 背景 | 边框 | 文字 |
| --- | --- | --- | --- |
| 蓝 / 信息 | `#e6f4ff` | `#91caff` | `#0958d9` |
| 绿 / 通过 | `#f6ffed` | `#b7eb8f` | `#389e0d` |
| 橙 / 留意 | `#fff7e6` | `#ffd591` | `#d46b08` |
| 红 / 差异 | `#fff2f0` | `#ffccc7` | `#cf1322` |
| 灰 / 停用 | `#fafafa` | `#d9d9d9` | `rgba(0,0,0,.45)` |

### 1.2 字体与间距

- 字体栈：`-apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif`
- 正文字号 13px，表格 12px，标签/辅助 11-12px，指标数字 22-24px
- **金额、号码、单号、trace id 一律 `font-family: Consolas, monospace`（等宽）**——防看错，金融场景硬要求
- 圆角：卡片 8px，按钮/输入框/Tag 6px / 4px
- 卡片 padding 12-14px，页面 content padding 14px，卡片间距 12px

---

## 2. 布局结构（Layout）

```
┌──────┬────────────────────────────────────┐
│      │  Header 46px：面包屑 + 右侧操作区    │
│ Sider├────────────────────────────────────┤
│ 208px│  Content（#f5f5f5，padding 14px）    │
│ 收起 │  各页面 Card（白底、0.5px 边框）      │
│ 56px │                                    │
└──────┴────────────────────────────────────┘
```

- Sider 深色 `#001529`，Logo 区含产品名 + 工号（AP-001 · 应付核算）
- 菜单 7 项 = 控制面模块，与后端 `/api/admin/*`、`/api/biz/*` 路由一一对应
- 非核心页 Sider 收起为 56px 图标模式（`<Sider collapsible>`）
- 菜单选中态：背景 `#1677ff` + 白字

**导航项 → 路由映射**

| 菜单 | 路由 | 对应后端 |
| --- | --- | --- |
| 复核工作台 | `/review` | `/api/review-queue` |
| 仪表盘 | `/dashboard` | `/api/dashboard/summary` |
| 扫描件池 | `/documents` | `/api/documents` |
| 规则配置 | `/rules` | `/api/rules` |
| 评测中心 | `/evals` | `/api/evals` |
| Key 管理 | `/providers` | `/api/providers` |
| 运行台账 | `/traces` | `/api/traces` |

---

## 3. 六屏结构说明

### 3.1 复核工作台 `/review`（核心屏）

- **三栏**：待复核队列（216px）｜发票 + 抽取字段｜三单对照 + 决策栏
- 队列项：发票号 + 供应商 + 金额 + 优先级 Tag；选中项浅蓝底 + 左侧 3px 主色边
- 中栏：左发票原图占位（150×190 虚线框）+ 右字段表（字段/抽取值/置信度）；**低置信行整行 amber 高亮**
- 右栏：三单对照表，差异行整行红色高亮 + 差异 Tag；AI 归因建议用蓝色 info 框（只读呈现）
- 底部操作栏置底（`margin-top:auto`）：采纳（primary）/ 驳回（danger outline）/ 下一张（default）+ kbd 快捷键
- **快捷键：A 采纳、S 驳回、D 下一张**（`useEffect` 绑 keydown）

### 3.2 仪表盘 `/dashboard`

- 4 个 Statistic 卡：今日处理量 / 自动通过率（含目标对比）/ 待复核积压（含 P0·P1·P2 分布）/ 本月 LLM 成本
- 左：处理量趋势（ECharts 堆叠柱状图，14 天，三段：自动通过 #1677ff / 人工复核 #faad14 / 异常 #ff4d4f）
- 右：异常类型分布（ECharts 横向条形，按归因编码）+ 最近评测摘要
- 顶部右侧：时间范围 Select（近 7/14/30 天）+ 数据截止时间

### 3.3 规则配置 `/rules` + Key 管理 `/providers`

- 左卡（约 58%）：规则表单（InputNumber 金额/数量容差、日期窗口；3 个 Switch：低置信强制人工 / 容差内提示放行 / 税号不一致驳回）+ 版本历史 Table
- **顶部未发布修改用蓝色 alert 提示，含影响范围预览（影响 N 张在途单、M 张结果翻转）**
- 「保存并发布」primary 按钮 + 「预览影响」secondary；发布走二次确认 Modal
- 右卡：provider Table（Provider/模型/状态/tokens/成本/操作）+ 步骤路由策略列表
- Key 不明文返回、不明文展示，Fernet 加密说明用绿色 alert

### 3.4 评测中心 `/evals`

- 运行信息条：评测编号 + prompt 版本 + 规则版本 + 样本数 + 耗时 + 状态 Tag
- 5 个指标卡：字段级准确率（含达标状态）/ 整单通过率 / 自动通过率 / 平均延迟 / 评测总成本
- 左：字段级准确率进度条列表（Progress 组件，未达标字段标 amber Tag）
- 右上：版本对比 Table（#N vs #N-1，Δ 列涨绿跌红）
- 右下：**发布门禁卡**——逐条列门禁指标与达标情况；有阻塞项时显示 amber 警示框 + 「重跑评测」/「仍要发布（二次确认）」

### 3.5 运行台账 `/traces`

- 左栏 250px：筛选（单据号/trace id 搜索 + 步骤/状态下拉）+ 记录列表（trace 短号 + 单据 + 步数 + 耗时 + 成本 + 状态 Tag）
- 右栏详情：头部汇总（单据号、trace id、触发方式、总耗时、总成本）+ 垂直 Steps 链路
- 步骤状态点：finished 绿勾 / warn 橙叹号 / process 蓝圈 / error 红叉
- L2 等 LLM 步骤展开 mono 字体的 input/output 摘要
- L6 人工步骤显示等待时长，超时升级规则文案

### 3.6 扫描件池 `/documents`（上传入口屏）

- **工具条**：文件名/关联单据/销方搜索 + 状态 Segmented（全部/已识别/识别中/识别失败）+ 来源 Select + 右侧「共 N 个文件」+ **「上传扫描件」primary 按钮** + 刷新按钮
- **上传 Modal**（点按钮打开）：`Upload.Dragger` 拖拽区（accept `.pdf,.jpg,.png`，multiple），文件列表显示名称/大小/校验结果；约束——PDF ≤ 20MB、≤ 50 页，超限行标红禁止提交；底部「开始上传」primary（禁用直至有合法文件），上传中显示进度条
- **提交行为**：`FormData` POST `/api/documents` → 成功后关闭 Modal + `message.success` + 列表刷新；新行进表格首行，`ocrStatus='processing'`，置信度显示「—」（处理中不可见）
- **拖放快捷路径**：表格 Card body 支持 `onDrop` 拖入文件，直接打开 Modal 并预填该文件
- **表格列**：文件（名称 mono + 页数）/ 来源（upload·scheduled）/ OCR 状态 Tag / 识别置信度 / 关联单据 / 销方 / 金额 / 上传时间 / 操作（预览·重新识别·链路）
- **行高亮**：识别失败整行红（`ia-row-diff`）；低置信整行 amber（`ia-row-low-conf`）
- **空态**：Empty + 引导文案「今晚 23:00 定时任务将自动拉取邮箱新附件并完成识别」+ 上传按钮引导
- **预览抽屉**：左票据影像占位（150×190 虚线框 + 页数 + dpi）+ 元信息；右 OCR 原文 mono 块；识别失败时顶部 error Alert 说明原因；底部「下载原件」「去复核」「查看完整处理链路」

---

## 4. 交互与状态细则

| 场景 | 规则 |
| --- | --- |
| AI 建议 | 只读呈现，不提供"一键执行 AI 结论"按钮——人做最终决策 |
| 低置信度字段 | 整行 amber 高亮 + Tag 提示，强制进人工队列 |
| 差异行 | 整行红色高亮 + 归因编码 Tag（QTY_MISMATCH 等） |
| 金额/号码 | 全部等宽字体；金额两位小数千分位 |
| 规则发布 | 未发布修改 → alert 提示 + 影响预览 → 二次确认 → 新版本号 |
| 评测门禁 | 阻塞项未达标禁止一键发布，「仍要发布」需二次确认 |
| 驳回操作 | 必须填写原因（Modal + Textarea，必填校验） |
| 空态 | AntD Empty 组件 + 引导文案（如"今晚 23:00 定时任务将自动处理"） |
| 上传 | 仅接受 pdf/jpg/png，PDF ≤ 20MB 且 ≤ 50 页；超限文件行标红且不可提交；上传成功后新行置顶、状态处理中 |

---

## 5. 实现建议

1. **组件映射**：Table（队列/版本历史/provider/字段表）、Form + InputNumber + Switch（规则）、Tag（状态/优先级/归因）、Card（各区块）、Steps direction="vertical"（trace）、Segmented（队列筛选）、Statistic 或自绘指标卡、Breadcrumb、Modal（二次确认）、message（操作反馈）
2. **图表**：ECharts——堆叠柱状图（趋势）、横向条形图（异常分布）；颜色按 §1.1
3. **开发顺序**：先接 mock fixture（每屏一个 JSON）并行开发，后端就绪后换真实 API；路由用 React Router，7 个页面对应 7 条路由
4. **等宽字体场景**：抽一个 `<Mono>` 包装组件，避免散落手写 fontFamily
5. **快捷键**：复核台封装 `useHotkeys(['a','s','d'])`，输入框聚焦时不触发

---

## 6. 设计决策备忘（面试可讲）

- **UI 即架构**：左侧导航 7 项 = 控制面模块，照着导航就能讲架构，不用另画图
- **人机边界在 UI 层可见**：AI 建议永远是 info 框，操作按钮永远在人这边
- **企业感三细节**：规则发布影响预览、评测门禁阻塞项、trace 成本归因到步骤——这三个做出来，玩具和产品的分界线就出来了
