const TOOL_CATALOG = {
  "pdf.parse": "Extract page-aware text from an uploaded PDF.",
  "arxiv.source": "Fetch and unpack the arXiv LaTeX source package.",
  "latex.formulas": "Extract exact formulas from LaTeX environments.",
  "latex.figures": "Resolve original figure files and captions from LaTeX.",
  "latex.tables": "Parse table structure and prepare original-PDF crops.",
  "pdf.table-crop": "Prepare or render table regions from the original PDF.",
  "text.formulas": "Detect explicit LaTeX formulas in extracted text.",
  "text.figures": "Detect figure and table references in extracted text.",
  "context.select": "Select task-relevant paper sections within the context budget.",
  "memory.recall": "Recall prior structured notes, annotations, and unresolved questions for one task.",
  "evidence.retrieve": "Retrieve source excerpts for one reading task.",
  "llm.analyze": "Produce evidence-grounded structured paper analysis.",
  "reflection.audit": "Check evidence, asset provenance, missing content, and argument support.",
  "llm.verify": "Verify grounding and selectively correct unsupported claims.",
  "poster.render": "Merge analysis with formulas, figures, and tables."
};

function buildToolPlan(profile = {}, options = {}) {
  const sourceType = ["arxiv", "pdf", "text"].includes(profile.sourceType) ? profile.sourceType : "text";
  const selected = [];
  const add = (name, reason, execution = "agent") => {
    if (!selected.some((item) => item.name === name)) {
      selected.push({ name, reason, execution, description: TOOL_CATALOG[name] || name });
    }
  };

  if (sourceType === "arxiv") {
    add("arxiv.source", "An arXiv identifier and source package are available.", "server");
    add("latex.formulas", "LaTeX is the most reliable formula source.", "server");
    add("latex.figures", "Original artwork can be resolved from the source archive.", "server");
    add("latex.tables", "LaTeX tables and the original PDF can preserve table layout.", "server");
    add("pdf.table-crop", "The original arXiv PDF is available for faithful table crops.", "server");
  } else if (sourceType === "pdf") {
    add("pdf.parse", "The input is an uploaded PDF.", "browser");
    add("text.formulas", "No LaTeX archive is available; inspect explicit formula markers.", "browser");
    add("text.figures", "Use extracted captions and references as PDF fallbacks.", "browser");
  } else {
    add("text.formulas", "The input is pasted text or Markdown.", "browser");
    add("text.figures", "Inspect explicit figure and table references.", "browser");
  }

  add("context.select", "Long papers require task-aware context selection.");
  if (options.hasMemory) add("memory.recall", "Prior structured notes are available for this paper.");
  add("evidence.retrieve", "Each reading task must gather source evidence before forming a conclusion.");
  add("llm.analyze", "Semantic paper reconstruction requires model reasoning.");
  if (options.verify !== false) {
    add("reflection.audit", "Deterministic checks should run before the single model reflection.");
    add("llm.verify", "A separate verification pass reduces unsupported claims.");
  }
  add("poster.render", "The final result combines semantic analysis and deterministic assets.", "browser");

  return {
    sourceType,
    selected,
    skipped: Object.entries(TOOL_CATALOG)
      .filter(([name]) => !selected.some((item) => item.name === name))
      .map(([name, description]) => ({ name, description, reason: skipReason(name, sourceType, options) }))
  };
}

function skipReason(name, sourceType, options) {
  if (name === "memory.recall" && !options.hasMemory) return "No prior memory exists for this paper yet.";
  if (name === "llm.verify" && options.verify === false) return "Verification is disabled by configuration.";
  if (name.startsWith("latex.") || name === "arxiv.source") return `The ${sourceType} input has no arXiv LaTeX package.`;
  if (name === "pdf.parse") return `The ${sourceType} input is already text-addressable.`;
  return "A higher-quality source-specific tool was selected.";
}

module.exports = { TOOL_CATALOG, buildToolPlan };
