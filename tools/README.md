# Tool Implementations

This directory contains the actual implementation of every Agent tool. The files in
`agent/` select, execute, and trace tools; `server.js` and `src/app.js` only connect
the tools to HTTP routes and the user interface.

Every tool follows the same contract: `name`, `description`, `stage`, `runtime`,
`inputTypes`, `run`, and `summarize`. An empty `inputTypes` list means the tool can
serve every paper source. Registries select compatible tools before execution.

## Server tools

- `server/arxiv-source.js`: downloads and unpacks arXiv source archives, selects the
  main TeX file, and expands included TeX files.
- `server/latex-formulas.js`: extracts LaTeX equation environments and expands paper
  macros.
- `server/latex-figures.js`: parses figure blocks, resolves original archive assets,
  and serves cached assets safely.
- `server/latex-tables.js`: parses LaTeX table environments into structured rows.
- `server/pdf-table-crop.js`: downloads the original PDF and renders high-resolution
  table crops, with LaTeX rendering as the preferred path.
- `server/llm-client.js`: performs OpenAI-compatible LLM requests, timeout handling,
  response parsing, and API error reporting.
- `server/context-select.js`: selects task-relevant paper context.
- `server/memory-recall.js`: recalls task-relevant structured notes and unresolved
  questions without promoting them to source evidence.
- `server/evidence-retrieve.js`: retrieves task-specific excerpts and source locations
  for the evidence-driven ReAct loop.
- `server/llm-analyze.js`: runs structured paper analysis.
- `server/llm-verify.js`: independently verifies and corrects the analysis.
- `server/reflection-audit.js`: performs deterministic provenance, completeness,
  evidence, and argument-support checks before the single model reflection.
- `server/evaluation-run.js`: loads fixed benchmark fixtures and runs the shared
  offline evaluator without making an LLM request.
- `server/poster-vision-review.js`: sends the rendered poster to a vision model,
  normalizes visual scores, and limits repair instructions to safe layout and
  typography adjustments.
- `server/asset-crop-vision.js`: checks a PDF asset inside a larger page-context
  image and returns a confidence-gated visual bounding box before final cropping.
- `server/poster-content-refine.js`: rewrites only reviewer-requested poster fields
  against the verified paper analysis and evidence, rejecting unsupported numbers
  and overlong replacements.
- `server/extraction-tools.js` and `server/reasoning-tools.js`: compose the individual
  implementations into tool manifests for the Agent registry.

## Browser tools

- `browser/pdf-parser.js`: extracts PDF text and candidate asset regions with PDF.js,
  then applies visual crop refinement when a vision model is configured.
- `browser/text-formulas.js`: extracts formulas from pasted or PDF-derived text.
- `browser/text-figures.js`: extracts Markdown and plain-text figure references.
- `browser/pdf-table-crop.js`: locates and crops a table from the original PDF page.
- `browser/poster-interactions.js`: binds claims, formulas, figures, and tables to
  exact source excerpts, page locations, and high-resolution artwork in exported posters.
- `browser/tool-runtime.js`: registers tools and records execution traces.
- `browser/paper-tools.js`: assembles the browser tool set.

`src/poster-vision-review.js` is the browser-side visual review adapter. It renders
the final 1600px poster with `html2canvas`, collects overflow and panel measurements,
and applies the reviewer's bounded repair hints through the existing layout planner.
`agent/poster-review-agent.js` owns the two-pass multimodal critic and evidence-grounded
content refinement workflow exposed by
`POST /api/review-poster`.

`src/poster-asset-placement.js` maps each selected source asset into its argumentative
home: architecture, pipeline, and mechanism figures are rendered inside Method;
performance, comparison, ablation figures, and all tables are rendered inside Results.
The standalone Visual Evidence panel is removed when the assets have contextual homes.

Browser API adapters are not Agent tools. For example, `src/api/arxiv-client.js`
only transports an arXiv request to the server; the actual source tool remains
`server/arxiv-source.js` and is selected by `agent/source-agent.js`.

Run `npm.cmd test` to verify the tool implementations and Agent orchestration.
Run `npm.cmd run eval` to generate `outputs/evaluation-report.json`.
