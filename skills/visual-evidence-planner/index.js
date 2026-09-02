const TYPE_VISUALS = {
  method: [["method-diagram", "Explain the architecture or pipeline"], ["key-formula", "Explain the central mechanism"], ["main-results", "Support the main performance claim"], ["ablation", "Isolate component contributions"]],
  theory: [["key-formula", "State the central definition or objective"], ["theorem", "Present the main formal result"], ["proof-map", "Explain proof dependencies"], ["example", "Show implications or boundary behavior"]],
  empirical: [["study-design", "Explain variables and controls"], ["main-results", "Support findings"], ["uncertainty", "Show variance or confidence"], ["subgroup", "Expose robustness and limitations"]],
  survey: [["taxonomy", "Explain the classification framework"], ["comparison-table", "Compare method families"], ["timeline", "Show development"], ["gap-map", "Show open research areas"]],
  system: [["system-architecture", "Explain components and data flow"], ["performance", "Support throughput or latency claims"], ["scaling", "Show scalability"], ["breakdown", "Locate bottlenecks"]],
  dataset: [["collection-pipeline", "Explain data provenance"], ["statistics", "Show composition and balance"], ["examples", "Make labels and tasks concrete"], ["benchmark", "Support dataset utility"]],
  guideline: [["compliance-flow", "Show the preparation and submission sequence"], ["rule-checklist", "Summarize mandatory constraints"], ["page-layout", "Clarify margins and typography"], ["exceptions", "Highlight permitted deviations"]]
};

const SELECTION_LIMITS = {
  method: { maxFormulas: 2, maxFigures: 2, maxTables: 1 },
  theory: { maxFormulas: 3, maxFigures: 1, maxTables: 1 },
  empirical: { maxFormulas: 1, maxFigures: 2, maxTables: 2 },
  survey: { maxFormulas: 0, maxFigures: 2, maxTables: 2 },
  system: { maxFormulas: 1, maxFigures: 2, maxTables: 2 },
  dataset: { maxFormulas: 1, maxFigures: 2, maxTables: 2 },
  guideline: { maxFormulas: 0, maxFigures: 1, maxTables: 1 }
};

function planVisualEvidence({ text = "", classification = {}, sourceProfile = {}, priorToolTrace = [] } = {}) {
  const paperType = classification.paperType || "method";
  const formulaSignals = Math.max(
    Number(sourceProfile.formulaCount || 0),
    Number(classification.characteristics?.formulaSignals || 0),
    count(text, /\$\$|\\begin\{(?:equation|align)/gi)
  );
  const figureSignals = Number(classification.characteristics?.figureSignals || count(text, /(?:figure|fig\.|图)\s*\d+/gi));
  const tableSignals = Number(classification.characteristics?.tableSignals || count(text, /(?:table|表)\s*\d+/gi));
  const mechanismFormulaRequired = formulaSignals > 0
    && ["method", "theory", "system"].includes(paperType)
    && /\b(?:objective|likelihood|probability|distribution|marginali[sz]|latent variable|loss|posterior|optimization|update rule|attention|projection|entropy)\b|目标函数|概率|分布|边缘化|隐变量|损失|后验|优化|更新规则|注意力|投影|熵/i.test(text);
  const slots = (TYPE_VISUALS[paperType] || TYPE_VISUALS.method).map(([kind, purpose], index) => ({
    kind,
    purpose,
    priority: index < 2 ? "high" : "supporting",
    sourcePreference: kind.includes("formula") || kind === "theorem" ? "exact-latex" : "original-paper-asset",
    operation: kind.includes("table") || kind.includes("results") || kind === "ablation" ? "crop-relevant-region-with-headers" : "preserve-original",
    available: inferAvailability(kind, { formulaSignals, figureSignals, tableSignals })
  }));
  return {
    paperType,
    availableSignals: { formulaSignals, figureSignals, tableSignals, sourceType: sourceProfile.sourceType || "text", extractedToolCalls: priorToolTrace.length },
    selectionPolicy: {
      ...(SELECTION_LIMITS[paperType] || SELECTION_LIMITS.method),
      reserveResultFigureWithoutTable: tableSignals === 0 && figureSignals > 0,
      requireInterpretation: true,
      preferAgentRecommendations: true,
      preserveProvenance: true,
      requireMechanismFormula: mechanismFormulaRequired
    },
    slots
  };
}

function inferAvailability(kind, signals) {
  if (kind.includes("formula") || kind === "theorem") return signals.formulaSignals > 0;
  if (kind.includes("table") || kind.includes("results") || kind === "ablation" || kind === "benchmark") return signals.tableSignals > 0 || signals.figureSignals > 0;
  return signals.figureSignals > 0;
}

function count(text, pattern) {
  return (String(text).match(pattern) || []).length;
}

function createVisualEvidencePlannerSkill() {
  return {
    name: "visual-evidence-planner",
    description: "Plan source-grounded formula, figure, and table evidence",
    stage: "reporting",
    run: planVisualEvidence,
    summarize: (result) => `Planned ${result.slots.length} visual roles; ${result.slots.filter((slot) => slot.available).length} have source signals.`
  };
}

module.exports = { planVisualEvidence, createVisualEvidencePlannerSkill };
