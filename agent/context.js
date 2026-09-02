const TASK_KEYWORDS = {
  overview: ["abstract", "introduction", "overview", "summary", "paper", "propose"],
  problem: ["abstract", "introduction", "problem", "challenge", "limitation", "gap", "motivation"],
  method: ["method", "approach", "model", "architecture", "algorithm", "framework", "training", "objective", "taxonomy", "annotation", "protocol", "retrieval"],
  theory: ["formula", "equation", "theorem", "proof", "loss", "objective", "attention", "algorithm", "complexity", "iteration", "decision rule", "historical memory", "mechanism", "root cause"],
  experiments: ["experiment", "evaluation", "dataset", "baseline", "metric", "ablation", "implementation", "annotation", "research question", "pass@", "codereval"],
  results: ["result", "performance", "comparison", "analysis", "discussion", "accuracy", "score", "mitigation", "pass@", "gain", "improvement", "distribution", "percentage"],
  contribution: ["contribution", "novel", "innovation", "conclusion", "limitation", "future work"]
};

const HEADING_TERMS = /abstract|introduction|background|related work|method|methodology|approach|model|architecture|experiment|evaluation|result|discussion|conclusion|limitation|future work|appendix|references|bibliography|dataset|taxonomy|annotation|research question|hallucination statistics|mitigation|root causes?/i;

function buildPaperContext(text, options = {}) {
  const maxChars = positiveNumber(options.maxChars, 26000);
  const tasks = Array.isArray(options.tasks) && options.tasks.length
    ? options.tasks
    : Object.keys(TASK_KEYWORDS).map((id) => ({ id, label: id, goal: id }));
  const gathered = gatherPaper(text, options);
  const taskMaxChars = positiveNumber(options.taskMaxChars, Math.min(7000, Math.max(4200, Math.floor(maxChars / 4))));
  const taskContexts = {};
  const globalCandidates = new Map();

  for (const task of tasks) {
    const bundle = buildTaskContext(gathered, task, { maxChars: taskMaxChars });
    taskContexts[task.id] = bundle;
    for (const chunk of bundle.selected) {
      const existing = globalCandidates.get(chunk.id);
      if (!existing || chunk.score > existing.score) globalCandidates.set(chunk.id, chunk);
    }
  }

  const selected = [...globalCandidates.values()]
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const structured = structureChunks(selected, { id: "paper", label: "Verification context" }, maxChars);

  return {
    context: structured.context,
    sourceText: structured.sourceText,
    sections: gathered.sections.map((section) => section.heading),
    taskContexts,
    stats: {
      strategy: "GSSC",
      sourceChars: gathered.sourceChars,
      gatheredSections: gathered.sections.length,
      gatheredChunks: gathered.chunks.length,
      selectedChunks: selected.length,
      structuredTasks: Object.keys(taskContexts).length,
      contextChars: structured.context.length,
      retainedSourceChars: structured.sourceText.length,
      compressionRatio: ratio(structured.sourceText.length, selected.reduce((sum, chunk) => sum + chunk.text.length, 0)),
      stages: {
        gather: { sections: gathered.sections.length, chunks: gathered.chunks.length },
        select: { tasks: Object.keys(taskContexts).length, uniqueChunks: selected.length },
        structure: { packets: Object.keys(taskContexts).length + 1 },
        compress: { budgetChars: maxChars, outputChars: structured.context.length }
      }
    }
  };
}

function gatherPaper(text, options = {}) {
  const normalized = normalizePaperText(text);
  const sections = splitIntoSections(normalized);
  const chunkSize = positiveNumber(options.chunkSize, 2200);
  const chunks = sections.flatMap((section, sectionIndex) =>
    chunkSection(section, chunkSize).map((chunk) => ({
      ...chunk,
      id: `S${sectionIndex + 1}C${chunk.part}`,
      sectionIndex,
      index: 0
    }))
  );
  chunks.forEach((chunk, index) => { chunk.index = index; });
  return { normalized, sourceChars: normalized.length, sections, chunks };
}

function buildTaskContext(gathered, task, options = {}) {
  const maxChars = positiveNumber(options.maxChars, 6000);
  const selected = selectTaskChunks(gathered.chunks, task, options);
  const structured = structureChunks(selected, task, maxChars);
  return {
    taskId: task.id,
    context: structured.context,
    sourceText: structured.sourceText,
    selected: structured.chunks,
    candidates: structured.chunks.map((chunk) => ({
      contextId: chunk.id,
      location: chunk.heading,
      part: chunk.part,
      score: chunk.score,
      originalChars: chunk.originalChars,
      retainedChars: chunk.text.length,
      compressed: chunk.compressed
    })),
    stats: {
      strategy: "GSSC",
      searchedChunks: gathered.chunks.length,
      selectedChunks: structured.chunks.length,
      contextChars: structured.context.length,
      sourceChars: structured.sourceText.length,
      compressedChunks: structured.chunks.filter((chunk) => chunk.compressed).length
    }
  };
}

function splitIntoSections(text) {
  const lines = String(text || "").split("\n");
  const sections = [];
  let current = { heading: "Paper overview", lines: [] };

  for (const line of lines) {
    const heading = detectHeading(line);
    if (heading) {
      if (current.lines.some((item) => item.trim())) sections.push(current);
      current = { heading, lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  if (current.lines.some((item) => item.trim())) sections.push(current);
  return sections.length ? sections : [{ heading: "Paper", lines }];
}

function detectHeading(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.length > 140) return "";
  const markdown = trimmed.match(/^#{1,6}\s+(.+)/);
  if (markdown) return markdown[1].trim();
  const canonical = trimmed.match(/^(?:\d+(?:\.\d+)*[.)]?\s+)?(abstract|introduction|background|related work|method(?:ology)?|approach|experiments?|evaluation|results?|discussion|conclusion|limitations?|future work|appendix|references|bibliography|datasets?|taxonomy|annotation(?: protocol)?|research questions?|hallucination statistics|mitigation(?: approach)?|rag-based mitigation|root causes?)\s*[:.]?$/i);
  if (canonical) return trimmed.replace(/[:.]$/, "");
  const numbered = trimmed.match(/^\d+(?:\.\d+)*[.)]?\s+(.+)$/);
  if (numbered && HEADING_TERMS.test(numbered[1])) return trimmed;
  return "";
}

function chunkSection(section, chunkSize = 2200) {
  const text = section.lines.join("\n").trim();
  if (!text) return [];
  const chunks = [];
  let remaining = text;
  let part = 1;
  while (remaining) {
    if (remaining.length <= chunkSize) {
      chunks.push({ heading: section.heading, text: remaining.trim(), part });
      break;
    }
    let cut = Math.max(300, remaining.lastIndexOf("\n\n", chunkSize));
    if (cut <= 300) cut = Math.max(300, remaining.lastIndexOf("\n", chunkSize));
    if (cut <= 300) cut = Math.max(300, remaining.lastIndexOf(". ", chunkSize) + 1);
    if (cut <= 300) cut = chunkSize;
    chunks.push({ heading: section.heading, text: remaining.slice(0, cut).trim(), part });
    remaining = remaining.slice(cut).trim();
    part += 1;
  }
  return chunks.filter((chunk) => chunk.text);
}

function selectTaskChunks(chunks, task, options = {}) {
  const expanded = Boolean(options.expanded);
  const limit = positiveNumber(options.limit, expanded ? 7 : 5);
  const ranked = chunks.map((chunk) => ({
    ...chunk,
    score: scoreChunkForTask(chunk, task)
  })).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = [];
  const ids = new Set();
  const add = (chunk) => {
    if (!chunk || ids.has(chunk.id) || /references|bibliography/i.test(chunk.heading)) return;
    selected.push(chunk);
    ids.add(chunk.id);
  };

  add(ranked[0]);
  if (task.id === "overview") add(ranked.find((chunk) => /abstract|introduction/i.test(chunk.heading)));
  if (task.id === "contribution") add(ranked.find((chunk) => /conclusion|discussion/i.test(chunk.heading)));
  for (const chunk of ranked) {
    if (selected.length >= limit) break;
    add(chunk);
  }
  return selected;
}

function scoreChunkForTask(chunk, task) {
  const heading = chunk.heading.toLowerCase();
  const text = chunk.text.toLowerCase();
  const keywords = taskKeywords(task);
  let score = chunk.index < 2 ? 3 - chunk.index : 0;
  for (const keyword of keywords) {
    if (heading.includes(keyword)) score += 10;
    if (text.includes(keyword)) score += 2;
  }
  if (task.id === "overview" && /abstract|introduction/.test(heading)) score += 20;
  if (task.id === "problem") {
    if (/abstract|introduction|motivation|problem statement/.test(heading)) score += 22;
    if (/related work|experiment|evaluation|result/.test(heading)) score -= 14;
  }
  if (task.id === "method") {
    if (/methodology|method|approach|proposed framework|system design|architecture/.test(heading)) score += 34;
    if (/abstract|introduction/.test(heading)) score += 4;
    if (/related work|experiment|evaluation|result|conclusion/.test(heading)) score -= 20;
  }
  if (task.id === "results") {
    if (/experiment|evaluation|result|ablation|analysis/.test(heading)) score += 30;
    if (/related work|introduction|methodology|method/.test(heading)) score -= 12;
  }
  if (task.id === "contribution" && /conclusion|discussion/.test(heading)) score += 20;
  if (/reliable formulas|figures extracted|tables extracted/.test(`${heading}\n${text}`)) score += 8;
  if (/references|bibliography/.test(heading)) score -= 40;
  return score;
}

function structureChunks(chunks, task, maxChars) {
  const ordered = [...chunks].sort((a, b) => a.index - b.index);
  const header = `[GSSC CONTEXT | task=${task.id} | goal=${task.goal || task.label || task.id}]`;
  let remaining = Math.max(0, maxChars - header.length - 2);
  const output = [];

  for (let index = 0; index < ordered.length; index += 1) {
    if (remaining < 220) break;
    const chunk = ordered[index];
    const label = `[SOURCE ${chunk.id} | ${chunk.heading} | part ${chunk.part}]`;
    const later = ordered.length - index - 1;
    const fairShare = Math.max(180, Math.floor((remaining - label.length - 2) / (later + 1)));
    const textBudget = Math.min(chunk.text.length, fairShare);
    const compressedText = compressText(chunk.text, task, textBudget);
    if (!compressedText) continue;
    const rendered = `${label}\n${compressedText}`;
    if (rendered.length > remaining) continue;
    output.push({
      ...chunk,
      originalChars: chunk.text.length,
      text: compressedText,
      compressed: compressedText.length < chunk.text.length
    });
    remaining -= rendered.length + 2;
  }

  const context = [header, ...output.map((chunk) =>
    `[SOURCE ${chunk.id} | ${chunk.heading} | part ${chunk.part}]\n${chunk.text}`
  )].join("\n\n");
  return {
    context,
    sourceText: output.map((chunk) => chunk.text).join("\n"),
    chunks: output
  };
}

function compressText(text, task, maxChars) {
  const source = String(text || "").trim();
  if (source.length <= maxChars) return source;
  const keywords = taskKeywords(task);
  const units = sentenceUnits(source).map((value, index) => ({
    value,
    index,
    score: scoreSentence(value, keywords, index)
  })).sort((a, b) => b.score - a.score || a.index - b.index);
  const chosen = [];
  let used = 0;
  for (const unit of units) {
    const cost = unit.value.length + (chosen.length ? 1 : 0);
    if (used + cost > maxChars) continue;
    chosen.push(unit);
    used += cost;
  }
  return chosen.sort((a, b) => a.index - b.index).map((unit) => unit.value).join("\n").trim();
}

function sentenceUnits(text) {
  const units = [];
  for (const line of String(text || "").split(/\n+/)) {
    const trimmed = line.trim()
      .replace(/(\d)\.(\d)/g, "$1\uE000$2")
      .replace(/\b(e)\.\s*(g)\./gi, "$1\uE001$2\uE001")
      .replace(/\b(i)\.\s*(e)\./gi, "$1\uE001$2\uE001")
      .replace(/\b(et)\s+(al)\./gi, "$1 $2\uE001");
    if (!trimmed) continue;
    const sentences = trimmed.match(/[^.!?。！？]+[.!?。！？]?/g) || [trimmed];
    for (const sentence of sentences) {
      const value = sentence.replace(/[\uE000\uE001]/g, ".").trim();
      if (value) units.push(value);
    }
  }
  return units;
}

function scoreSentence(sentence, keywords, index) {
  const lower = sentence.toLowerCase();
  let score = index === 0 ? 3 : 0;
  for (const keyword of keywords) if (lower.includes(keyword)) score += 4;
  if (/\d|=|\\begin|\\end|figure|table|dataset|baseline/i.test(sentence)) score += 2;
  return score;
}

function taskKeywords(task) {
  const canonical = TASK_KEYWORDS[task.id] || [];
  const taskWords = `${task.label || ""} ${task.goal || ""}`.toLowerCase().match(/[a-z][a-z-]{3,}/g) || [];
  return [...new Set([...canonical, ...taskWords])];
}

function normalizePaperText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function ratio(retained, original) {
  return original ? Number((retained / original).toFixed(3)) : 1;
}

module.exports = {
  TASK_KEYWORDS,
  buildPaperContext,
  buildTaskContext,
  gatherPaper,
  splitIntoSections,
  chunkSection,
  selectTaskChunks,
  scoreChunkForTask,
  structureChunks,
  compressText,
  taskKeywords
};
