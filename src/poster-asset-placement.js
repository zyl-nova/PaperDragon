(function initPosterAssetPlacement(global, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (global) global.PosterAssetPlacement = api;
})(typeof window !== "undefined" ? window : globalThis, function createPosterAssetPlacement() {
  const METHOD_TERMS = [
    "method", "overview", "architecture", "framework", "pipeline", "workflow", "algorithm", "model", "mechanism",
    "design", "system", "component", "module", "training", "inference", "方法", "架构", "框架", "流程", "模型", "机制", "系统"
  ];
  const RESULT_TERMS = [
    "result", "experiment", "performance", "comparison", "ablation", "evaluation", "benchmark", "accuracy", "bleu",
    "latency", "throughput", "scaling", "analysis", "finding", "curve", "plot", "bitrate", "rate-distortion",
    "psnr", "ssim", "结果", "实验", "性能", "对比", "消融", "评估", "指标", "曲线"
  ];
  const THEORY_TERMS = [
    "key idea", "principle", "concept", "theory", "objective", "attention map", "feature alignment", "representation alignment",
    "latent space", "encoding principle", "核心思想", "原理", "理论", "目标函数", "特征对齐", "表征对齐"
  ];

  function classifyAssetPlacement(asset, type = "figure") {
    if (type === "table") return "results";
    const explicit = String(asset?._posterAnalysis?.placement || asset?._posterAnalysis?.section || "").toLowerCase();
    if (["method", "theory", "results"].includes(explicit)) return explicit;
    const text = normalize([
      asset?.name,
      asset?.caption,
      asset?.source,
      asset?._posterAnalysis?.purpose,
      asset?._posterAnalysis?.insight
    ].filter(Boolean).join(" "));
    const methodScore = keywordScore(text, METHOD_TERMS);
    const theoryScore = keywordScore(text, THEORY_TERMS);
    const resultScore = keywordScore(text, RESULT_TERMS);
    if (theoryScore > methodScore && theoryScore > resultScore) return "theory";
    return resultScore > methodScore ? "results" : "method";
  }

  function partitionPosterAssets({ figures = [], tables = [] } = {}) {
    const methodFigures = [];
    const theoryFigures = [];
    const resultFigures = [];
    for (const figure of Array.isArray(figures) ? figures : []) {
      const placement = classifyAssetPlacement(figure, "figure");
      if (placement === "results") resultFigures.push(figure);
      else if (placement === "theory") theoryFigures.push(figure);
      else methodFigures.push(figure);
    }
    return {
      methodFigures,
      theoryFigures,
      resultFigures,
      resultTables: Array.isArray(tables) ? [...tables] : []
    };
  }

  function keywordScore(text, terms) {
    return terms.reduce((score, term) => score + (text.includes(normalize(term)) ? 1 : 0), 0);
  }

  function normalize(value) {
    return String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
  }

  return { classifyAssetPlacement, partitionPosterAssets };
});
