const TYPE_SIGNALS = {
  method: [
    /\b(?:we\s+)?propos(?:e|ed)\b/gi,
    /(?:proposed|new|parallel) (?:method|model|approach|algorithm|architecture|framework|pipeline|system)/gi,
    /our (?:method|framework|pipeline|system|architecture)/gi,
    /\bwe (?:design|develop|introduce|present) (?:[\w-]+:\s*)?(?:a |an )?(?:novel )?(?:multi-agent |agentic |unified )?(?:prompting )?(?:method|model|approach|algorithm|architecture|framework|pipeline|system)/gi,
    /本文提出/g,
    /我们(?:设计|开发|提出).{0,8}(?:模型|算法|架构|框架|流程|系统)/g
  ],
  theory: [/theorem|lemma|proof|proposition|corollary/gi, /formal guarantee|upper bound|lower bound/gi, /定理|引理|证明|理论保证/g],
  empirical: [/empirical study|controlled experiment|we investigate|we observe|we evaluate/gi, /research questions?|manual(?:ly)? annotat|annotation protocol|pass@\d+|codereval|coder?eval/gi, /实证|对照实验|观察到|统计分析|研究问题|人工标注/g],
  survey: [/\b(?:survey|systematic review|meta-analysis)\b/gi, /\b(?:we|this (?:paper|work)) (?:review|survey|categorize|summarize)\b/gi, /\b(?:taxonomy of|research landscape)\b/gi, /综述|系统性回顾|分类体系|元分析/g],
  system: [/throughput|latency|deployment|distributed system|scalability/gi, /吞吐|延迟|部署|分布式系统|可扩展/g],
  dataset: [/new dataset|introduce (?:a )?(?:dataset|benchmark)|benchmark suite|annotation protocol|data collection/gi, /新数据集|提出.{0,6}基准|标注流程|数据采集/g],
  guideline: [/formatting instructions?|submission guidelines?|author guidelines?|camera-ready instructions?/gi, /must be prepared according to|strict upper limit of \d+ pages|page limits?|style requirements?/gi, /投稿指南|格式要求|作者须知|页数限制/g]
};

const PRIORITIES = {
  method: ["problem", "motivation", "method", "theory", "experiments", "ablation", "results"],
  theory: ["problem", "assumptions", "definitions", "theory", "proof", "implications"],
  empirical: ["research questions", "experimental design", "datasets", "metrics", "results", "validity"],
  survey: ["scope", "selection criteria", "taxonomy", "comparison", "gaps", "future work"],
  system: ["requirements", "architecture", "implementation", "performance", "scalability", "limitations"],
  dataset: ["task definition", "data collection", "annotation", "statistics", "benchmark", "ethics"],
  guideline: ["scope", "mandatory requirements", "formatting rules", "submission limits", "compliance checklist", "exceptions"]
};

function classifyPaper({ text = "", sourceProfile = {} } = {}) {
  const source = classificationBody(String(text));
  const scores = Object.fromEntries(Object.entries(TYPE_SIGNALS).map(([type, patterns]) => [
    type,
    patterns.reduce((sum, pattern) => sum + Math.min(5, (source.match(pattern) || []).length), 0)
  ]));
  if (/\\begin\{(?:equation|align|theorem|proof)/i.test(source)) scores.theory += 2;
  if (/\\begin\{algorithm|algorithm\s*\d+/i.test(source)) scores.method += 2;
  if (/table\s*\d+|表\s*\d+/i.test(source)) scores.empirical += 1;
  const titleRegion = source.slice(0, 1200);
  const openingRegion = source.slice(0, 7000);
  const explicitSurvey = /^(?:#\s*)?.{0,180}\b(?:survey|systematic review|meta-analysis)\b/im.test(titleRegion)
    || /\b(?:we|this (?:paper|work)) (?:review|survey)\b/i.test(openingRegion);
  const explicitMethodClaim = /\b(?:we|this (?:paper|work))\s+(?:introduce|propose|present|develop|design)\b.{0,180}\b(?:framework|pipeline|system|method|model|architecture|algorithm|approach|solution)\b/i.test(openingRegion)
    || /\bto address\b.{0,180}\bwe propose\b/i.test(openingRegion);
  const methodSection = /(?:^|\n)\s*(?:#{1,4}\s*)?(?:\d+(?:\.\d+)*\s+)?(?:methodology|method|proposed approach|our approach|framework|architecture)\s*(?:\n|$)/im.test(source);
  const contributionClaim = /\bour main contributions? are as follows\b|\bwe make the following contributions?\b/i.test(openingRegion);
  if (/^(?:#\s*)?.{0,180}\b(?:survey|review|meta-analysis)\b/im.test(titleRegion)) scores.survey += 14;
  if (/^(?:#\s*)?.{0,120}(?:综述|系统性回顾|分类体系|元分析)/m.test(titleRegion)) scores.survey += 14;
  if (/\bwe conduct an empirical study\b|\bempirical (?:study|analysis)\b/i.test(titleRegion)) scores.empirical += 8;
  if (/\b(?:we|this (?:paper|work)) (?:introduce|propose|present|develop|design) (?:[\w-]+:\s*)?(?:a |an )?(?:novel )?(?:multi-agent |agentic |unified )?(?:prompting )?(?:framework|pipeline|system|method|model|architecture|algorithm|approach)\b/i.test(titleRegion)) {
    scores.method += 8;
  }
  if (explicitMethodClaim) scores.method += 12;
  if (methodSection) scores.method += 5;
  if (contributionClaim && explicitMethodClaim) scores.method += 4;
  // Related-work prose appears in almost every research paper. Without an
  // explicit review claim it must never accumulate into a survey decision.
  if (!explicitSurvey) scores.survey = Math.min(scores.survey, 2);
  if (explicitMethodClaim && !explicitSurvey) scores.method = Math.max(scores.method, scores.survey + 8);
  if (sourceProfile.sourceType === "arxiv") scores.method += 0.25;
  const ranked = Object.entries(scores).sort((left, right) => right[1] - left[1]);
  const paperType = ranked[0][1] > 0 ? ranked[0][0] : "method";
  const margin = Math.max(0, ranked[0][1] - ranked[1][1]);
  const confidence = Number(Math.min(0.96, ranked[0][1] ? 0.5 + margin * 0.06 + ranked[0][1] * 0.02 : 0.35).toFixed(2));
  return {
    paperType,
    confidence,
    characteristics: {
      scores,
      formulaSignals: countMatches(source, /\$\$|\\begin\{(?:equation|align|theorem)/gi),
      figureSignals: countMatches(source, /(?:figure|fig\.|图)\s*\d+/gi),
      tableSignals: countMatches(source, /(?:table|表)\s*\d+/gi),
      sourceType: sourceProfile.sourceType || "text",
      explicitSurvey,
      explicitMethodClaim,
      methodSection
    },
    priorities: [...PRIORITIES[paperType]],
    alternatives: ranked.slice(1, 3).map(([type, score]) => ({ type, score }))
  };
}

function classificationBody(text) {
  const source = String(text || "");
  const references = source.search(/(?:^|\n)\s*(?:#{1,4}\s*)?(?:references|bibliography)\s*(?:\n|$)/i);
  return references >= 0 ? source.slice(0, references) : source;
}

function countMatches(text, pattern) {
  return (text.match(pattern) || []).length;
}

function createPaperTypeClassifierSkill() {
  return {
    name: "paper-type-classifier",
    description: "Classify the paper and identify type-specific reading priorities",
    stage: "planning",
    run: classifyPaper,
    summarize: (result) => `Classified as ${result.paperType} (${Math.round(result.confidence * 100)}% confidence).`
  };
}

module.exports = { classifyPaper, createPaperTypeClassifierSkill };
