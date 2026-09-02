const { buildToolPlan } = require("./tool-planner");

async function runSourceExtractionAgent({ sourceProfile, input, tools }) {
  const profile = sourceProfile && typeof sourceProfile === "object" ? sourceProfile : { sourceType: "text" };
  const plan = buildToolPlan(profile, { verify: false });
  const plannedNames = plan.selected.map((item) => item.name);
  const selectedTools = tools.select(profile, { names: plannedNames });
  const state = { bundle: null, formulas: [], figures: [], tables: [] };

  for (const tool of selectedTools) {
    if (tool.name === "arxiv.source") {
      state.bundle = await tools.execute(tool.name, { arxivId: input.arxivId });
      continue;
    }
    if (!state.bundle) throw new Error(`${tool.name} requires arxiv.source to complete first.`);
    if (tool.name === "latex.formulas") {
      state.formulas = await tools.execute(tool.name, { latex: state.bundle.combinedTex });
    } else if (tool.name === "latex.figures") {
      state.figures = await tools.execute(tool.name, {
        latex: state.bundle.combinedTex,
        files: state.bundle.files,
        arxivId: input.arxivId
      });
    } else if (tool.name === "latex.tables") {
      state.tables = await tools.execute(tool.name, { latex: state.bundle.combinedTex });
    } else if (tool.name === "pdf.table-crop") {
      state.tables = await tools.execute(tool.name, { tables: state.tables, arxivId: input.arxivId });
    }
  }

  if (profile.sourceType === "arxiv" && !state.bundle) {
    throw new Error("No arXiv source tool was selected for the arXiv input.");
  }

  return {
    ...state,
    toolPlan: {
      sourceType: plan.sourceType,
      selected: selectedTools.map((tool) => ({
        ...tool,
        reason: plan.selected.find((item) => item.name === tool.name)?.reason || "Selected by source profile."
      }))
    }
  };
}

module.exports = { runSourceExtractionAgent };
