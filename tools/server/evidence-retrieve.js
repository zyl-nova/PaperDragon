const { splitIntoSections, chunkSection, taskKeywords } = require("../../agent/context");

function retrieveTaskEvidence(paperText, task, options = {}) {
  const expanded = Boolean(options.expanded);
  const round = Math.max(1, Number(options.round || (expanded ? 2 : 1)));
  const prepared = options.preparedContext;
  if (!expanded && prepared?.taskId === task.id && prepared.context && prepared.sourceText) {
    return {
      taskId: task.id,
      expanded: false,
      strategy: "gssc-prepared",
      context: prepared.context,
      sourceText: prepared.sourceText,
      candidates: Array.isArray(prepared.candidates) ? prepared.candidates.map((item, index) => ({
        evidenceId: `E${index + 1}`,
        location: item.location,
        part: item.part,
        score: item.score,
        chars: item.retainedChars,
        contextId: item.contextId,
        compressed: Boolean(item.compressed)
      })) : [],
      stats: {
        searchedChunks: Number(prepared.stats?.searchedChunks || 0),
        selectedChunks: Number(prepared.stats?.selectedChunks || 0),
        evidenceChars: prepared.context.length,
        compressedChunks: Number(prepared.stats?.compressedChunks || 0)
      }
    };
  }
  const maxChars = Number(options.maxChars || (expanded ? 10000 : 6000));
  const maxChunks = Math.max(1, Number(options.maxChunks || (expanded ? 6 : 4)));
  const sections = splitIntoSections(String(paperText || ""));
  const chunks = sections.flatMap((section) => chunkSection(section, expanded ? 2600 : 1800));
  const keywords = taskKeywords(task);
  const ranked = chunks.map((chunk, index) => ({
    ...chunk,
    index,
    score: scoreEvidenceChunk(chunk, keywords, task.id)
  })).sort((a, b) => b.score - a.score || a.index - b.index);

  const selected = [];
  let usedChars = 0;
  for (const chunk of ranked) {
    if (usedChars >= maxChars || selected.length >= maxChunks) break;
    const remaining = maxChars - usedChars;
    if (remaining < 200) break;
    const text = chunk.text.slice(0, remaining);
    selected.push({ ...chunk, text });
    usedChars += text.length + chunk.heading.length + 40;
  }

  const context = selected.map((chunk, index) =>
    `[EVIDENCE ${index + 1} | ${chunk.heading} | part ${chunk.part}]\n${chunk.text}`
  ).join("\n\n");

  return {
    taskId: task.id,
    expanded,
    strategy: expanded ? `full-paper-expanded-r${round}` : "direct-retrieval",
    context,
    sourceText: selected.map((chunk) => chunk.text).join("\n"),
    candidates: selected.map((chunk, index) => ({
      evidenceId: `E${index + 1}`,
      location: chunk.heading,
      part: chunk.part,
      score: chunk.score,
      chars: chunk.text.length
    })),
    stats: {
      searchedChunks: chunks.length,
      selectedChunks: selected.length,
      evidenceChars: context.length
    }
  };
}

function scoreEvidenceChunk(chunk, keywords, taskId) {
  const heading = chunk.heading.toLowerCase();
  const text = chunk.text.toLowerCase();
  let score = chunk.index < 2 ? 2 : 0;
  for (const keyword of keywords) {
    if (heading.includes(keyword)) score += 8;
    if (text.includes(keyword)) score += 2;
  }
  if (taskId === "overview" && /abstract|introduction/.test(heading)) score += 16;
  if (taskId === "contribution" && /conclusion|discussion/.test(heading)) score += 16;
  if (taskId === "method") {
    if (/methodology|(?:^|\s)method(?:\s|$)|proposed approach|our approach|framework|architecture/.test(heading)) score += 24;
    if (/related work|background|literature review/.test(heading)) score -= 14;
  }
  if (taskId === "experiments" || taskId === "results") {
    if (/experiment|evaluation|results?|ablation|research question/.test(heading)) score += 18;
    if (/related work|background/.test(heading)) score -= 10;
  }
  if (/references|bibliography/.test(heading)) score -= 20;
  return score;
}

function createEvidenceRetrieveTool() {
  return {
    name: "evidence.retrieve",
    description: "Retrieving task-specific source evidence",
    stage: "analysis",
    runtime: "server",
    inputTypes: [],
    run: ({ paperText, task, preparedContext, expanded, round, maxChars, maxChunks }) => retrieveTaskEvidence(paperText, task, {
      preparedContext,
      expanded,
      round,
      maxChars,
      maxChunks
    }),
    summarize: (bundle) => `${bundle.strategy}: ${bundle.stats.selectedChunks}/${bundle.stats.searchedChunks} evidence chunks, ${bundle.stats.evidenceChars} chars.`
  };
}

module.exports = { createEvidenceRetrieveTool, retrieveTaskEvidence, taskKeywords, scoreEvidenceChunk };
