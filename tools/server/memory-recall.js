const { taskKeywords } = require("../../agent/context");

function recallPaperMemory(memory, task) {
  const value = normalizeMemory(memory);
  if (!value) return { taskId: task.id, available: false, priorSection: null, annotations: [], unresolvedQuestions: [], stats: { recalledItems: 0 } };
  const priorSection = value.sectionSummaries?.[task.id]
    || (task.id === "overview" ? value.sectionSummaries?.overview : null)
    || null;
  const keywords = [...new Set([
    ...taskKeywords(task),
    ...textKeywords(priorSection?.summary),
    ...textKeywords(value.unresolvedQuestions.join(" "))
  ])];
  const annotations = rankTextItems(value.annotations, keywords, 5);
  const unresolvedQuestions = rankTextItems(value.unresolvedQuestions, keywords, 5);
  return {
    taskId: task.id,
    available: true,
    metadata: value.metadata,
    priorSection,
    annotations,
    unresolvedQuestions,
    stats: {
      recalledItems: annotations.length + unresolvedQuestions.length + (priorSection ? 1 : 0),
      annotations: annotations.length,
      unresolvedQuestions: unresolvedQuestions.length
    }
  };
}

function normalizeMemory(memory) {
  if (!memory || typeof memory !== "object") return null;
  return {
    paperId: clean(memory.paperId, 120),
    metadata: memory.metadata && typeof memory.metadata === "object" ? {
      title: clean(memory.metadata.title, 240),
      sourceType: clean(memory.metadata.sourceType, 30),
      arxivId: clean(memory.metadata.arxivId, 80),
      fileName: clean(memory.metadata.fileName, 240)
    } : {},
    sectionSummaries: normalizeSections(memory.sectionSummaries),
    annotations: normalizeStrings(memory.annotations, 20, 2000),
    unresolvedQuestions: normalizeStrings(memory.unresolvedQuestions, 20, 1000),
    priorAnalysis: memory.priorAnalysis && typeof memory.priorAnalysis === "object"
      ? Object.fromEntries(Object.entries(memory.priorAnalysis).slice(0, 20).map(([key, value]) => [clean(key, 80), clean(value, 1600)]))
      : {}
  };
}

function normalizeSections(value) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).slice(0, 12).map(([key, section]) => [clean(key, 80), {
    summary: clean(section?.summary, 1800),
    evidenceLocations: normalizeStrings(section?.evidenceLocations, 12, 160)
  }]));
}

function rankTextItems(items, keywords, limit) {
  return items.map((text, index) => ({
    text,
    index,
    score: keywords.reduce((score, keyword) => score + (text.toLowerCase().includes(keyword) ? 2 : 0), 0)
  })).sort((a, b) => b.score - a.score || b.index - a.index).slice(0, limit).map((item) => item.text);
}

function textKeywords(value) {
  return String(value || "").toLowerCase().match(/[a-z][a-z-]{4,}/g) || [];
}

function normalizeStrings(value, limit, maxLength) {
  return Array.isArray(value) ? value.slice(-limit).map((item) => clean(item, maxLength)).filter(Boolean) : [];
}

function clean(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function createMemoryRecallTool() {
  return {
    name: "memory.recall",
    description: "Recalling prior structured notes for one reading task",
    stage: "context",
    runtime: "server",
    run: ({ memory, task }) => recallPaperMemory(memory, task),
    summarize: (bundle) => `${bundle.stats.recalledItems} prior notes recalled for ${bundle.taskId}.`
  };
}

module.exports = { createMemoryRecallTool, recallPaperMemory, normalizeMemory };
