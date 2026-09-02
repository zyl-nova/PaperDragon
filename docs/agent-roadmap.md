# PaperDragon Roadmap

The project is being upgraded in eight ordered phases. A phase is marked complete
only after implementation, automated tests, and local-page verification.

1. **Plan-and-Solve reading flow - complete**
   - Seven explicit reading tasks execute independently.
   - Each task owns a small output field set and supporting excerpts.
   - A failed task does not discard successful task results.
   - Task status, duration, and evidence counts are returned to the UI.
2. **Tool architecture - complete**
   - Core tools share one metadata and execution contract.
   - Browser and server registries select tools by source profile.
   - API transport adapters are separated from Agent tools.
   - The source Agent selects and executes the arXiv extraction pipeline.
3. **Evidence-driven ReAct loop - complete**
   - Every reading task retrieves its own source evidence before model reasoning.
   - Returned quotations are checked against retrieved source text.
   - Insufficient or ungrounded responses trigger one broader retrieval round.
   - ReAct thoughts, actions, observations, and conclusions are retained for audit.
4. **Reflection verifier - complete**
   - One deterministic audit checks evidence, assets, argument support, and omissions.
   - One model reflection reviews the audit and may propose selective corrections.
   - Corrections that introduce numbers absent from the paper are rejected.
   - Applied and rejected corrections remain visible in the Agent audit.
5. **GSSC context engineering - complete**
   - Gather identifies sections and creates stable, source-addressable chunks.
   - Select ranks different chunks for each of the seven reading tasks.
   - Structure creates task-specific evidence packets with section and chunk labels.
   - Compress retains relevant complete source sentences within explicit budgets.
   - ReAct uses prepared task context first and searches the full paper only for its one expanded retry.
6. **Memory and structured notes - complete**
   - Each paper has an isolated local record keyed by arXiv ID or content fingerprint.
   - Metadata, task summaries, evidence locations, analysis snapshots, annotations, and questions persist across reloads.
   - Reflection omissions become unresolved questions without overwriting user notes.
   - The `memory.recall` tool selects prior notes for each task while prompts forbid using memory as paper evidence.
7. **Observable task status - complete**
   - A live execution panel tracks every reading task, ReAct phase, retry, memory recall, and recent tool call.
   - Tool calls have stable IDs, duration, status, summaries, and optional structured metrics.
   - Model calls report provider token usage when available and deterministic estimates otherwise.
   - Final audit metrics include input/output tokens, retries, elapsed time, memory hits, and optional configured cost.
8. **Evaluation system - complete**
   - Fixed offline paper fixtures provide repeatable source text, reference outputs, and pass thresholds.
   - One evaluator measures content coverage, formula precision/recall/F1, figure and table recall, evidence consistency, numeric hallucination rate, duration, tokens, and optional cost.
   - The `evaluation.run` server tool, `npm run eval`, and the browser panel use the same evaluation core.
   - JSON reports are written to `outputs/evaluation-report.json`; offline reference runs never call the LLM API.

Current structure target: `Agent + Tools + Context + Verifier + Evaluation`.

## Domain Skills

The Agent now applies five project-local Skills before and during analysis:

1. `paper-type-classifier` identifies method, theory, empirical, survey, system, or dataset papers.
2. `reading-plan-builder` adapts task priorities and poster section order without dropping core coverage.
3. `section-writing` injects evidence and writing rules for every reading task.
4. `visual-evidence-planner` assigns formulas, original figures, and table crops an argumentative purpose.
5. `poster-composer` creates a type-aware section and visual-placement plan after verification.

Each Skill has a `SKILL.md`, `schema.json`, executable `index.js`, and an auditable registry record.
The visual planner also enforces paper-type-specific asset limits. Agent recommendations must use
exact source identifiers, and every selected formula, figure, or table is rendered with a concise
interpretation; extracted but nonessential assets stay out of the poster.
The browser applies the Poster Composer output as a responsive landscape grid with type-specific
section titles and emphasis. Detailed Agent execution remains available in a collapsed audit rather
than occupying the poster's visual hierarchy.
