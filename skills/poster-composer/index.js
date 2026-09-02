const SECTION_LABELS = {
  overview: "Overview",
  problem: "Problem and Motivation",
  method: "Method",
  theory: "Formula and Theory",
  experiments: "Experimental Design",
  results: "Results and Claim Support",
  contribution: "Contribution, Limitations, and Logic Review"
};

function composePoster({ classification = {}, readingPlan = {}, visualPlan = {}, analysis = {} } = {}) {
  const paperType = classification.paperType || readingPlan.paperType || "method";
  const order = readingPlan.sectionOrder || Object.keys(SECTION_LABELS);
  const taskMap = new Map((readingPlan.tasks || []).map((task) => [task.id, task]));
  const availableVisuals = (visualPlan.slots || []).filter((slot) => slot.available);
  return {
    paperType,
    density: availableVisuals.length >= 3 ? "visual" : paperType === "theory" ? "compact" : "balanced",
    headlineGuidance: analysis.summary ? "Use the verified summary as the supporting takeaway." : "State the paper objective without adding unsupported results.",
    sections: order.map((id, index) => ({
      id,
      label: SECTION_LABELS[id] || id,
      priority: taskMap.get(id)?.priority || "supporting",
      span: taskMap.get(id)?.priority === "high" || ["method", "theory", "results"].includes(id) ? "wide" : "standard",
      order: index + 1
    })),
    visualPlacements: availableVisuals.map((slot) => ({
      kind: slot.kind,
      purpose: slot.purpose,
      nearSection: chooseSection(slot.kind),
      operation: slot.operation,
      provenanceLabelRequired: true
    })),
    qualitySection: { required: true, showEvidenceGaps: true, showVerification: true, showLimitations: true }
  };
}

function chooseSection(kind) {
  if (kind.includes("formula") || kind === "theorem" || kind === "proof-map") return "theory";
  if (kind.includes("result") || kind === "performance" || kind === "scaling" || kind === "benchmark") return "results";
  if (kind === "ablation" || kind === "uncertainty" || kind === "subgroup") return "experiments";
  return "method";
}

function createPosterComposerSkill() {
  return {
    name: "poster-composer",
    description: "Compose a type-aware poster layout from verified analysis and visual evidence",
    stage: "reporting",
    run: composePoster,
    summarize: (result) => `Composed ${result.sections.length} sections with ${result.visualPlacements.length} grounded visual placement(s).`
  };
}

module.exports = { composePoster, createPosterComposerSkill };
