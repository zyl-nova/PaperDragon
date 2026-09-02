# PaperDragon

> 吞下论文，吐出海报。

PaperDragon 是一个带有桌面小恐龙宠物的智能论文阅读与学术海报生成助手。
将 PDF 拖到“小阅”嘴边后，它会自动规划阅读任务、提取原文证据、公式与图表，
生成可交互、可追溯并可独立导出的会议 Poster。

## Offline evaluation

The Evaluation panel and `npm.cmd run eval` use the same fixed benchmark and do
not call the LLM API. The report measures content coverage, formula F1, figure and
table recall, evidence consistency, numeric hallucination rate, time, and tokens.
The command-line report is saved to `outputs/evaluation-report.json`.

## Paper-reading Skills

Five project-local Skills classify the paper, adapt the reading plan, guide section writing,
plan visual evidence, and compose a type-aware poster. Skill instructions and schemas live
under `skills/`; executable implementations are selected through `agent/skill-registry.js`
and remain separate from extraction and LLM Tools.

Poster asset selection is intentionally selective: the Agent recommends exact source identifiers,
the browser ranks only provenance-backed matches, and type-specific limits keep a small set of key
formulas, figures, and tables. Every selected asset is rendered with its argumentative purpose and
a concise interpretation instead of displaying the complete extracted asset inventory.

The Poster Composer now controls the rendered layout rather than returning unused metadata. Method,
theory, and empirical/system/dataset papers use different landscape grids and section headings.
Primary method or evidence sections receive the largest regions, while the full Agent audit is
collapsed so operational details do not dominate the academic poster or exported HTML.

一个面向论文阅读考核任务的轻量智能体。它接收 arXiv 论文、PDF 或论文文本，生成包含问题、方法、实验、结果、贡献、公式、图表和批判性检查的可导出 Poster。

生成后的 Poster 支持证据回溯：点击有 `i` 标记的结论、图或表，可以查看对应论文页码、原文证据和高清原图。该交互会一并写入导出的独立 HTML，无需工作台即可使用。

## 智能体架构

当前分析流程不再是单次提示词调用，而是一个可观察、可降级的五阶段 Agent：

1. **Plan**：把阅读目标拆解为问题、方法、实验、结果和贡献五项任务。
2. **Context**：按章节切分论文，针对任务选择高相关片段并压缩上下文。
3. **Analyze**：让模型依据所选上下文生成结构化分析和证据引用。
4. **Verify**：第二次模型调用核查事实依据、方法与问题的匹配度、实验与主张的匹配度，并只修正有问题的字段。
5. **Report**：合并可靠的公式、原图和表格资源，渲染 Poster 与审计信息。

页面通过 NDJSON 事件流实时展示真实阶段，不再用前端计时器模拟进度。若复核调用失败，系统会保留初次分析并标记为未完成复核；若主要分析失败，才使用本地关键词分析兜底。

## 工具化架构

Agent 会先识别输入来源，再由确定性 Tool Planner 选择工具，不把所有能力固定串行执行：

- arXiv：`arxiv.source` -> `latex.formulas` -> `latex.figures` -> `latex.tables` -> `pdf.table-crop`
- PDF：`pdf.parse` -> `text.formulas` -> `text.figures`
- 文本：`text.formulas` -> `text.figures`
- 所有来源：`context.select` -> 可选 `memory.recall` -> `llm.analyze` -> 可选 `llm.verify` -> `poster.render`

每个工具都有统一的名称、说明、运行阶段、执行函数和输出摘要。Tool Registry 会记录状态、耗时和结果摘要，并将浏览器预处理工具与服务端推理工具合并进 Poster 的 Agent Audit。未选择的工具也会保留跳过原因，便于后续扩展 OCR、版面检测或其他模型工具。

## 输入与资源提取

- arXiv ID / URL：优先读取 LaTeX 源码，以获得更可靠的公式、原图和表格信息。
- PDF：在浏览器中抽取文字，并通过服务端页面裁剪补充表格图像。
- 文本或 Markdown：可直接粘贴摘要、正文、公式和图表说明。
- 公式由 MathJax 渲染，导出的独立 HTML 会携带公式渲染支持。

## 配置 DeepSeek

复制 `.env.example` 为 `.env`，然后填写自己的 Key：

```text
DEEPSEEK_API_KEY=你的_DeepSeek_API_Key
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-chat
```

智能体相关配置均为可选：

```text
AGENT_CONTEXT_CHARS=26000
AGENT_TASK_CONTEXT_CHARS=6500
LLM_INPUT_COST_PER_MILLION=0
LLM_OUTPUT_COST_PER_MILLION=0
AGENT_ANALYSIS_TOKENS=3200
AGENT_VERIFY_TOKENS=1400
AGENT_ANALYSIS_TIMEOUT_MS=70000
AGENT_VERIFY_TIMEOUT_MS=50000
AGENT_VERIFY=true
```

暂时不需要第二次模型复核时，可以设置 `AGENT_VERIFY=false`，以降低耗时和费用。

## 启动与测试

```powershell
npm.cmd start
```

打开 `http://localhost:5173`。

运行离线 Agent 测试：

```powershell
npm.cmd test
```

## 主要目录

- `agent/context.js`：GSSC 上下文工程，为每个阅读任务执行 Gather、Select、Structure、Compress。
- `src/memory/paper-memory.js`：按论文保存元信息、结构化摘要、证据位置、批注和未解决问题。
- `src/observability/agent-monitor.js`：实时呈现任务、ReAct 阶段、工具调用、重试、Token 和耗时。
- `agent/prompts.js`：分析与复核的结构化提示词。
- `agent/paper-agent.js`：Plan-Execute-Reflect 编排、事件、证据和降级策略。
- `agent/tool-registry.js`：统一工具协议、执行和轨迹记录。
- `agent/tool-planner.js`：根据 arXiv、PDF 或文本来源选择工具。
- `tools/server/arxiv-source.js`：arXiv LaTeX 源码工具。
- `tools/server/latex-formulas.js`：精确公式提取工具。
- `tools/server/latex-figures.js`：原图与图注解析工具。
- `tools/server/latex-tables.js`：LaTeX 表格结构工具。
- `tools/server/pdf-table-crop.js`：原 PDF 表格裁剪准备工具。
- `tools/server/context-select.js`：任务相关上下文选择工具。
- `tools/server/llm-analyze.js`：LLM 论文分析工具。
- `tools/server/llm-verify.js`：独立复核工具。
- `server.js`：API、模型适配、arXiv/PDF 资源处理与事件流。
- `tools/browser/tool-runtime.js`：浏览器工具注册和执行运行时。
- `tools/browser/pdf-parser.js`：浏览器 PDF 解析工具。
- `tools/browser/arxiv-source.js`：浏览器 arXiv 请求工具。
- `tools/browser/text-formulas.js`：文本公式提取工具。
- `tools/browser/text-figures.js`：图表引用提取工具。
- `tools/browser/pdf-table-crop.js`：浏览器 PDF 表格裁剪工具。
- `src/app.js`：前端交互、阶段展示、Poster 渲染与导出。
