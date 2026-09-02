const { ANALYSIS_FIELDS } = require("./prompts");
const { READING_PLAN, createTaskState } = require("./reading-plan");
const { buildToolPlan } = require("./tool-planner");
const { buildSkillPlan } = require("./skill-planner");
const { createReasoningTools } = require("../tools/server/reasoning-tools");
const { createPaperSkills } = require("../skills");

const DEFAULT_PLAN = READING_PLAN;

async function runPaperAgent({ text, callModel, onEvent = () => {}, options = {}, sourceProfile = {}, priorToolTrace = [], memory = null }) {
  const startedAt = Date.now();
  const stages = [];
  const dispatch = (event) => {
    const timedEvent = { ...event, atMs: Date.now() - startedAt };
    stages.push(timedEvent);
    onEvent(timedEvent);
  };
  const emit = (stage, message, extra = {}) => dispatch({ stage, message, ...extra });

  const toolTrace = normalizePriorToolTrace(priorToolTrace);
  const skillTrace = [];
  const tools = createReasoningTools({ trace: toolTrace, onEvent: dispatch, callModel, options });
  const skills = createPaperSkills({ trace: skillTrace });
  const toolPlan = buildToolPlan(sourceProfile, { verify: options.verify, hasMemory: Boolean(memory) });
  const skillPlan = buildSkillPlan();
  const classification = await skills.execute("paper-type-classifier", { text, sourceProfile });
  const adaptiveReadingPlan = await skills.execute("reading-plan-builder", { classification, basePlan: READING_PLAN });
  const writingGuide = await skills.execute("section-writing", { plan: adaptiveReadingPlan, classification });
  const readingPlan = adaptiveReadingPlan.tasks.map((task) => ({ ...task, skillGuidance: writingGuide.sections[task.id] || null }));
  const visualPlan = await skills.execute("visual-evidence-planner", { text, classification, sourceProfile, priorToolTrace: toolTrace });
  const readingTasks = readingPlan.map(createTaskState).map((state, index) => ({ ...state, priority: readingPlan[index].priority }));

  emit("planning", `Classified a ${classification.paperType} paper, selected ${skillPlan.selected.length} skills, and created ${readingTasks.length} reading tasks.`, {
    plan: readingTasks.map(publicTaskState),
    toolPlan: toolPlan.selected,
    skillPlan: skillPlan.selected,
    paperType: classification.paperType
  });

  const contextBundle = await tools.execute("context.select", {
    paperText: text,
    tasks: readingPlan,
    maxChars: options.maxContextChars || 26000,
    taskMaxChars: options.taskContextChars || 6500
  });
  emit("context", `GSSC prepared ${contextBundle.stats.structuredTasks} task contexts from ${contextBundle.stats.gatheredChunks} chunks.`, {
    contextStats: contextBundle.stats
  });

  const analysis = { evidence: {}, assetRecommendations: [] };
  const maxTaskRounds = boundedInteger(options.maxTaskRounds, 6, 2, 8);
  let modelCalls = 0;
  let completedTasks = 0;
  let respondedTasks = 0;
  for (let index = 0; index < readingPlan.length; index += 1) {
    const task = readingPlan[index];
    const state = readingTasks[index];
    const taskStartedAt = Date.now();
    state.status = "running";
    emit("analysis", `Analyzing ${task.label} (${index + 1}/${readingPlan.length}).`, {
      task: publicTaskState(state),
      taskIndex: index + 1,
      taskTotal: readingPlan.length
    });

    try {
      let acceptedResult = null;
      let acceptedEvidence = [];
      let lastEvidenceBundle = null;
      let previousIssue = "";
      let memoryFocus = null;
      if (memory) {
        memoryFocus = await tools.execute("memory.recall", { memory, task });
        state.memoryHits = Number(memoryFocus.stats?.recalledItems || 0);
        if (state.memoryHits) {
          emit("analysis", `${task.label}: recalled ${state.memoryHits} prior note(s).`, {
            memory: { taskId: task.id, recalledItems: state.memoryHits }
          });
        }
      }
      for (let round = 1; round <= maxTaskRounds; round += 1) {
        state.attempts = round;
        const thought = `Find source evidence needed to ${task.goal.charAt(0).toLowerCase()}${task.goal.slice(1)}`;
        emit("analysis", `${task.label}: retrieving evidence (round ${round}).`, {
          react: { taskId: task.id, round, phase: "thought", detail: thought }
        });
        const evidenceBundle = await tools.execute("evidence.retrieve", {
          paperText: text,
          task,
          preparedContext: contextBundle.taskContexts?.[task.id],
          expanded: round > 1,
          round,
          maxChars: evidenceBudgetForRound(round, options),
          maxChunks: evidenceChunksForRound(round, options)
        });
        lastEvidenceBundle = evidenceBundle;
        state.evidenceToolCalls += 1;
        const observation = `${evidenceBundle.stats.selectedChunks} chunks and ${evidenceBundle.stats.evidenceChars} evidence chars retrieved.`;
        emit("analysis", `${task.label}: ${observation}`, {
          react: { taskId: task.id, round, phase: "observation", detail: observation }
        });

        modelCalls += 1;
        const response = await tools.execute("llm.analyze", {
          task,
          context: evidenceBundle.context,
          observation: { round, previousIssue },
          memory: memoryFocus
        });
        const taskResult = parseJsonObject(response.content, `${task.id} task`);
        const groundedEvidence = validateTaskEvidence(taskResult, evidenceBundle.sourceText);
        const fieldIssues = validateTaskFields(task, taskResult);
        const insufficient = taskResult?.status === "insufficient_evidence" || groundedEvidence.length === 0 || fieldIssues.length > 0;
        state.reactSteps.push({
          round,
          thought,
          action: "evidence.retrieve",
          observation,
          conclusion: insufficient ? "insufficient evidence" : "grounded conclusion",
          groundedEvidence: groundedEvidence.length
        });
        acceptedResult = taskResult;
        acceptedEvidence = groundedEvidence;
        if (!insufficient) break;
        previousIssue = fieldIssues.length
          ? `The previous response was not poster-ready: ${fieldIssues.join("; ")}. Return complete synthesized sentences, never captions or source fragments.`
          : groundedEvidence.length
          ? "The previous response reported insufficient evidence. Search broader sections."
          : "No returned evidence quote matched the retrieved source text. Use exact source wording.";
        if (round < maxTaskRounds) {
          emit("analysis", `${task.label}: evidence was insufficient; expanding retrieval for repair round ${round + 1}/${maxTaskRounds}.`, {
            react: { taskId: task.id, round, phase: "reflection", detail: previousIssue },
            warning: true
          });
        }
      }

      respondedTasks += 1;
      if (!acceptedEvidence.length || acceptedResult?.status === "insufficient_evidence") {
        const fallback = buildExtractiveTaskFallback(task, lastEvidenceBundle?.sourceText || "");
        if (fallback) {
          state.evidenceCount = mergeTaskResult(analysis, task, fallback.result, fallback.evidence, text);
          state.status = "completed";
          state.fallbackUsed = true;
          completedTasks += 1;
          emit("analysis", `${task.label}: model repair rounds were exhausted; a grounded extractive fallback completed the task.`, {
            react: { taskId: task.id, round: state.attempts, phase: "fallback", detail: "Used exact task-relevant source sentences without adding unsupported claims." },
            warning: true
          });
        } else {
          fillMissingTaskFields(analysis, task);
          analysis.evidence[task.evidenceKey] = [];
          state.status = "insufficient";
          state.evidenceCount = 0;
        }
      } else {
        state.evidenceCount = mergeTaskResult(analysis, task, acceptedResult, acceptedEvidence, text);
        state.status = "completed";
        completedTasks += 1;
      }
      state.durationMs = Date.now() - taskStartedAt;
      emit("analysis", `${task.label} ${state.status} with ${state.evidenceCount} grounded evidence excerpt(s).`, {
        task: publicTaskState(state),
        taskIndex: index + 1,
        taskTotal: readingPlan.length
      });
    } catch (error) {
      state.status = "failed";
      state.error = safeErrorMessage(error);
      fillMissingTaskFields(analysis, task);
      state.durationMs = Date.now() - taskStartedAt;
      emit("analysis", `${task.label} could not be completed; continuing with the remaining tasks.`, {
        task: publicTaskState(state),
        taskIndex: index + 1,
        taskTotal: readingPlan.length,
        warning: true
      });
    } finally {
      state.durationMs = Date.now() - taskStartedAt;
    }
  }

  if (!respondedTasks) {
    throw new Error(summarizeReadingTaskFailures(readingTasks));
  }
  fillMissingAnalysisFields(analysis);
  const groundedEvidence = normalizeEvidence(analysis.evidence);

  let verification = {
    verdict: "skipped",
    summary: "Verification was disabled.",
    confidence: 0,
    checks: [],
    corrections: {},
    preflight: null,
    appliedCorrections: {},
    rejectedCorrections: {}
  };
  if (options.verify !== false) {
    let preflight = null;
    try {
      preflight = await tools.execute("reflection.audit", {
        analysis,
        evidence: groundedEvidence,
        readingTasks,
        sourceProfile,
        toolTrace
      });
      emit("verification", `Deterministic reflection audit scored ${preflight.score}%.`, { preflight });
      modelCalls += 1;
      const checked = await tools.execute("llm.verify", {
        analysis,
        context: contextBundle.context,
        audit: preflight,
        evidence: groundedEvidence,
        sourceProfile
      });
      verification = normalizeVerification(parseJsonObject(checked.content, "verification"));
      verification.preflight = preflight;
      const correctionReport = applyCorrections(analysis, verification.corrections, contextBundle.sourceText);
      verification.appliedCorrections = correctionReport.applied;
      verification.rejectedCorrections = correctionReport.rejected;
    } catch (error) {
      verification = {
        verdict: "unavailable",
        summary: `The task results were preserved, but verification could not finish: ${safeErrorMessage(error)}`,
        confidence: 0,
        checks: [],
        corrections: {},
        preflight,
        appliedCorrections: {},
        rejectedCorrections: {}
      };
      emit("verification", "Verification was unavailable; preserving the completed task results.", { warning: true });
    }
  }

  analysis.source = "agent";
  analysis.formulas = [];
  analysis.figures = [];
  const posterComposition = await skills.execute("poster-composer", {
    classification,
    readingPlan: adaptiveReadingPlan,
    visualPlan,
    analysis
  });
  emit("reporting", "Assembling the verified poster data.");
  const evidence = groundedEvidence;
  const evidenceGroups = Object.values(evidence).filter((items) => items.length).length;
  const evidenceItems = Object.values(evidence).reduce((total, items) => total + items.length, 0);
  const completedReadingTasks = readingTasks.filter((task) => task.status === "completed").length;
  const insufficientReadingTasks = readingTasks.filter((task) => task.status === "insufficient").length;
  const modelToolRecords = toolTrace.filter((tool) => tool.name === "llm.analyze" || tool.name === "llm.verify");
  const inputTokens = sumToolMetric(modelToolRecords, "inputTokens");
  const outputTokens = sumToolMetric(modelToolRecords, "outputTokens");
  const inputRate = Math.max(0, Number(options.inputCostPerMillion || 0));
  const outputRate = Math.max(0, Number(options.outputCostPerMillion || 0));

  return {
    analysis,
    agent: {
      mode: "evidence-driven-react-agent",
      plan: readingTasks.map(publicTaskState),
      toolPlan,
      tools: toolTrace,
      toolManifest: tools.manifest(),
      skills: {
        plan: skillPlan,
        trace: skillTrace,
        manifest: skills.manifest(),
        classification,
        readingPlan: { paperType: adaptiveReadingPlan.paperType, sectionOrder: adaptiveReadingPlan.sectionOrder },
        writingGuide,
        visualPlan,
        posterComposition
      },
      evidence,
      verification,
      memory: {
        paperId: String(memory?.paperId || ""),
        used: Boolean(memory),
        recalledItems: readingTasks.reduce((sum, task) => sum + Number(task.memoryHits || 0), 0)
      },
      context: contextBundle.stats,
      stages,
      metrics: {
        durationMs: Date.now() - startedAt,
        modelCalls,
        modelInputChars: sumToolMetric(modelToolRecords, "inputChars"),
        inputTokens,
        outputTokens,
        totalTokens: sumToolMetric(modelToolRecords, "totalTokens"),
        tokenEstimate: modelToolRecords.some((tool) => Boolean(tool.metrics?.tokenEstimate)),
        estimatedCostUsd: inputRate || outputRate ? Number(((inputTokens * inputRate + outputTokens * outputRate) / 1000000).toFixed(6)) : null,
        toolCalls: toolTrace.length,
        completedTools: toolTrace.filter((item) => item.status === "completed").length,
        readingTasks: readingTasks.length,
        completedReadingTasks,
        insufficientReadingTasks,
        failedReadingTasks: readingTasks.filter((task) => task.status === "failed").length,
        taskCompletion: Math.round((completedReadingTasks / readingTasks.length) * 100),
        taskFinished: Math.round(((completedReadingTasks + insufficientReadingTasks) / readingTasks.length) * 100),
        evidenceGroups,
        evidenceItems,
        evidenceCoverage: Math.round((evidenceGroups / readingPlan.length) * 100),
        retries: readingTasks.reduce((sum, task) => sum + Math.max(0, Number(task.attempts || 0) - 1), 0)
      }
    }
  };
}

function mergeTaskResult(analysis, task, result, evidenceOverride, paperText = "") {
  const fields = result?.fields && typeof result.fields === "object" ? result.fields : result;
  for (const field of task.fields) {
    const value = fields?.[field];
    if (typeof value === "string" && value.trim()) analysis[field] = value.trim();
  }
  fillMissingTaskFields(analysis, task);

  const rawEvidence = Array.isArray(evidenceOverride) ? evidenceOverride : Array.isArray(result?.evidence)
    ? result.evidence
    : Array.isArray(result?.evidence?.[task.evidenceKey])
      ? result.evidence[task.evidenceKey]
      : [];
  analysis.evidence[task.evidenceKey] = normalizeEvidenceItems(rawEvidence, paperText);
  mergeAssetRecommendations(analysis, result?.assetRecommendations, paperText);
  return analysis.evidence[task.evidenceKey].length;
}

function mergeAssetRecommendations(analysis, recommendations, paperText) {
  if (!Array.isArray(recommendations)) return;
  const source = normalizeForEvidenceMatch(paperText);
  const existing = new Set((analysis.assetRecommendations || []).map((item) => `${item.type}|${item.reference}`.toLowerCase()));
  for (const item of recommendations.slice(0, 3)) {
    const type = String(item?.type || "").toLowerCase();
    const reference = String(item?.reference || "").trim().slice(0, 80);
    const key = `${type}|${reference}`.toLowerCase();
    if (!["formula", "figure", "table"].includes(type) || !reference || existing.has(key)) continue;
    if (!source.includes(normalizeForEvidenceMatch(reference))) continue;
    analysis.assetRecommendations.push({
      type,
      reference,
      section: ["method", "theory", "results"].includes(String(item?.section || "").toLowerCase())
        ? String(item.section).toLowerCase()
        : type === "table" ? "results" : type === "formula" ? "theory" : "method",
      purpose: String(item?.purpose || "Key paper evidence").trim().slice(0, 180),
      insight: String(item?.insight || "").trim().slice(0, 320)
    });
    existing.add(key);
    if (analysis.assetRecommendations.length >= 6) break;
  }
}

function validateTaskEvidence(result, sourceText) {
  const rawEvidence = Array.isArray(result?.evidence)
    ? result.evidence
    : result?.evidence && typeof result.evidence === "object"
      ? Object.values(result.evidence).flatMap((items) => Array.isArray(items) ? items : [])
      : [];
  const normalizedSources = evidenceMatchVariants(sourceText);
  return normalizeEvidenceItems(rawEvidence).filter((item) => {
    const quotes = evidenceMatchVariants(item.quote).filter((quote) => quote.length >= 4);
    return quotes.some((quote) => normalizedSources.some((source) => source.includes(quote)));
  });
}

function validateTaskFields(task, result) {
  const fields = result?.fields && typeof result.fields === "object" ? result.fields : result;
  const issues = [];
  for (const field of task.fields || []) {
    if (field === "title") continue;
    const value = String(fields?.[field] || "").replace(/\s+/g, " ").trim();
    if (!value || /^(?:not found|no (?:clear |reliable )?)/i.test(value)) {
      issues.push(`${field} is missing`);
      continue;
    }
    const minimumLength = ["problem", "motivation", "contributions", "innovation", "logicReview"].includes(field) ? 32 : 18;
    if (value.length < minimumLength) issues.push(`${field} is too short`);
    if (/^(?:figure|fig\.|table)\s*\d+/i.test(value)) issues.push(`${field} is a caption, not a conclusion`);
    if (/\b(?:e\.\s*g|i\.\s*e|et\s+al)\.$/i.test(value)) issues.push(`${field} ends at an abbreviation`);
    if (/\.{3,}$|…$|[,;:]$|\b(?:and|or|to|of|with|by|for|from|that|which)$/i.test(value)) issues.push(`${field} trails off`);
    if (!/[.!?。！？)\]]$/.test(value) && /\b(?:a|an|the|this|these|those|using|including|their|our|its|is|are|was|were|thei)$/i.test(value)) {
      issues.push(`${field} ends with an incomplete source fragment`);
    }
    if (/\bcompared(?:\s+(?:with|to))?[.!?]$/i.test(value)) issues.push(`${field} omits the comparison target`);
    if (/[,;]\s*(?:and|or|but)\s+(?:for|with|in|on|of|to|by)\s+(?:the|a|an)?\s*[\w-]+(?:\s+[\w-]+){0,4}[.!?]$/i.test(value)) {
      issues.push(`${field} ends with a dangling clause`);
    }
    if (/\bif accepted[.!?]$/i.test(value)) issues.push(`${field} ends with an incomplete acceptance condition`);
    if (/^[a-z]{2,}\s/.test(value) && !/^(?:iPhone|eBay)\b/.test(value)) issues.push(`${field} starts mid-sentence`);
    if (field === "contributions") {
      const semanticIssue = contributionSemanticIssue(value);
      if (semanticIssue) issues.push(semanticIssue);
    }
  }
  return [...new Set(issues)];
}

function contributionSemanticIssue(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "contributions is missing";
  const noveltySignal = /\b(?:propos(?:e|es|ed|ing)|introduc(?:e|es|ed|ing)|present(?:s|ed|ing)?|develop(?:s|ed|ing)?|design(?:s|ed|ing)?|new|novel|first|framework|architecture|method|approach|objective|mechanism|formulation|training scheme|based entirely|unified)\b/i;
  const resultSignal = /\b(?:achiev(?:e|es|ed|ing)|outperform(?:s|ed|ing)?|improv(?:e|es|ed|ing)|accuracy|score|bleu|state-of-the-art|twice|higher|lower|increase|decrease|drop|gain)\b|\b\d+(?:\.\d+)?%?/i;
  if (!noveltySignal.test(text) && resultSignal.test(text)) {
    return "contributions reports an experimental result instead of the paper's novelty";
  }
  if (!noveltySignal.test(text)) return "contributions does not state what the paper introduces";
  return "";
}

function normalizeForEvidenceMatch(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function evidenceMatchVariants(value) {
  const source = String(value || "").normalize("NFKC");
  return [...new Set([
    normalizeForEvidenceMatch(source),
    normalizeForEvidenceMatch(source.replace(/([\p{L}\p{N}])-\s+([\p{Ll}\p{N}])/gu, "$1$2"))
  ].filter(Boolean))];
}

function evidenceBudgetForRound(round, options) {
  const base = boundedInteger(options.taskEvidenceChars, 6500, 3000, 12000);
  return Math.min(30000, base + Math.max(0, round - 1) * 4500);
}

function evidenceChunksForRound(round, options) {
  const base = boundedInteger(options.taskEvidenceChunks, 5, 3, 8);
  return Math.min(18, base + Math.max(0, round - 1) * 3);
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? Math.floor(number) : fallback));
}

function buildExtractiveTaskFallback(task, sourceText) {
  const candidates = selectExtractiveEvidence(sourceText, task, Math.max(6, task.fields.length * 3));
  if (!candidates.length) return null;
  const fields = {};
  for (let index = 0; index < task.fields.length; index += 1) {
    const field = task.fields[index];
    if (field === "title") {
      fields[field] = extractSourceTitle(sourceText) || candidates[0];
      continue;
    }
    fields[field] = selectCandidateForField(candidates, field) || candidates[Math.min(index, candidates.length - 1)];
  }
  return {
    result: { status: "complete", fields, assetRecommendations: [] },
    evidence: candidates.slice(0, Math.min(3, candidates.length)).map((quote) => ({
      quote,
      location: "task-relevant retrieved source"
    }))
  };
}

function selectExtractiveEvidence(sourceText, task, limit) {
  const keywords = [...new Set([
    ...(task.requiredEvidence || []).flatMap((value) => String(value).toLowerCase().match(/[a-z][a-z-]{3,}/g) || []),
    ...(String(task.goal || "").toLowerCase().match(/[a-z][a-z-]{3,}/g) || [])
  ])].filter((word) => !/^(?:identify|explain|extract|summarize|paper|reading|focus|explicit|qualifiers|preserve|apply|complete)$/.test(word));
  const units = [];
  for (const line of String(sourceText || "").split(/\n+/)) {
    const protectedLine = line.trim()
      .replace(/(\d)\.(\d)/g, "$1\uE000$2")
      .replace(/\b(e)\.\s*(g)\./gi, "$1\uE001$2\uE001")
      .replace(/\b(i)\.\s*(e)\./gi, "$1\uE001$2\uE001")
      .replace(/\b(et)\s+(al)\./gi, "$1 $2\uE001");
    const matches = protectedLine.match(/[^.!?。！？]+[.!?。！？]?/g) || [];
    for (const match of matches) {
      const value = match.replace(/[\uE000\uE001]/g, ".").replace(/^#+\s*/, "").replace(/\s+/g, " ").trim();
      if (value.length < 32 || value.length > 420 || /^(?:references|bibliography|figure|fig\.|table)\s*\d*/i.test(value)) continue;
      if (/^[a-z]{2,}\s/.test(value) || /\.{3,}$|…$|[,;:]$|\b(?:and|or|to|of|with|by|for|from|that|which)$/i.test(value)) continue;
      const lower = value.toLowerCase();
      const keywordHits = keywords.reduce((sum, keyword) => sum + (lower.includes(keyword) ? 1 : 0), 0);
      const evidenceSignals = /\d|=|because|however|propos|challenge|limitation|result|method|model|objective|theor|experiment|dataset|contribut/i.test(value) ? 2 : 0;
      units.push({ value, score: keywordHits * 5 + evidenceSignals });
    }
  }
  const seen = new Set();
  return units.sort((left, right) => right.score - left.score || right.value.length - left.value.length)
    .filter((item) => item.score >= 2)
    .filter((item) => {
      const key = normalizeForEvidenceMatch(item.value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map((item) => item.value);
}

function selectCandidateForField(candidates, field) {
  const signals = {
    problem: /problem|challenge|limitation|fail|depend|loss|difficult|cannot|unable|however/i,
    motivation: /motivat|important|need|therefore|thus|allow|enable|benefit|arbitrary|fully exploit/i,
    contributions: /contribut|propos|introduc|present|develop|design|novel|first|unified framework|architecture|new method/i,
    innovation: /novel|first|unified|context-aware|innov/i,
    logicReview: /limitation|however|because|therefore|result|outperform/i
  };
  const pattern = signals[field];
  return pattern ? candidates.find((candidate) => pattern.test(candidate)) : candidates[0];
}

function extractSourceTitle(sourceText) {
  return String(sourceText || "").split(/\n+/).map((line) => line.replace(/^#+\s*/, "").trim())
    .find((line) => line.length >= 5 && line.length <= 180 && !/^\[?(?:source|evidence)/i.test(line)) || "";
}

function fillMissingTaskFields(analysis, task) {
  for (const field of task.fields) {
    if (analysis[field]) continue;
    analysis[field] = field === "title" ? "Untitled paper" : "not found in provided context";
  }
}

function fillMissingAnalysisFields(analysis) {
  for (const field of ANALYSIS_FIELDS) {
    if (!analysis[field]) analysis[field] = field === "title" ? "Untitled paper" : "not found in provided context";
  }
}

function normalizeEvidenceItems(items, paperText = "") {
  const pages = splitPaperPages(paperText);
  return items.map((item) => {
    const rawQuote = sanitizeEvidenceQuote(item?.quote);
    if (!isUsableEvidenceQuote(rawQuote)) return null;
    const match = findEvidenceSentence(rawQuote, pages);
    const rawLocation = String(item?.location || "paper context").replace(/\s+/g, " ").trim();
    const genericLocation = /^(?:task-relevant retrieved source|retrieved source|paper context)$/i.test(rawLocation);
    const hasPage = /(?:page|p\.?)\s*[:#-]?\s*\d+/i.test(rawLocation);
    const location = match?.page
      ? genericLocation
        ? `Uploaded PDF, page ${match.page}`
        : hasPage ? rawLocation : `${rawLocation}, page ${match.page}`
      : rawLocation;
    const resolvedQuote = String(match?.sentence || rawQuote).trim();
    if (hasMergedSectionBoundary(resolvedQuote)) return null;
    return {
      quote: resolvedQuote.slice(0, 520),
      location: String(location).slice(0, 160)
    };
  }).filter(Boolean).slice(0, 5);
}

function sanitizeEvidenceQuote(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\/10\.\d{4,9}\/[\w.()/:;-]+\s*/i, "")
    .replace(/^org\/10\.\d{4,9}\/[\w.()/:;-]+\s*/i, "")
    .replace(/^(?:arxiv:\S+\s*)?(?:\[[^\]]{1,12}\]|[A-Za-z.]{1,8}\])\s*\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s*/i, "")
    .trim();
}

function isUsableEvidenceQuote(value) {
  const quote = String(value || "").trim();
  if (!quote) return false;
  if (/^(?:[A-Za-z][A-Za-z0-9_-]{0,12}|\d{1,3})[.)]$/.test(quote)) return false;
  if (/^(?:test cases?|results?|methods?|figures?|tables?)\.?$/i.test(quote)) return false;
  if (hasMergedSectionBoundary(quote)) return false;
  return true;
}

function hasMergedSectionBoundary(value) {
  const quote = String(value || "").replace(/\s+/g, " ").trim();
  return /[a-z0-9,)]\s+(?:In recent years|Recently,|Abstract\b|Introduction\b|Related Work\b|Methodology\b|Experiments?\b)\s+(?:In |We |The |Recent)/i.test(quote);
}

function splitPaperPages(paperText) {
  const source = String(paperText || "");
  const markers = [...source.matchAll(/^##\s+Page\s+(\d+)\s*$/gim)];
  if (!markers.length) return [{ page: null, text: source }];
  return markers.map((marker, index) => ({
    page: Number(marker[1]),
    text: source.slice(marker.index + marker[0].length, markers[index + 1]?.index ?? source.length)
  }));
}

function findEvidenceSentence(quote, pages) {
  const quoteKey = normalizeForEvidenceMatch(quote);
  if (quoteKey.length < 8) return null;
  const candidates = [];
  const allSentences = [];
  for (const page of pages) {
    const text = String(page.text || "").replace(/\s+/g, " ").trim();
    const protectedText = text
      .replace(/(\d)\.(\d)/g, "$1\uE000$2")
      .replace(/\b(e|i)\.\s*(g|e)\./gi, "$1\uE001$2\uE001")
      .replace(/\b(et)\s+(al)\./gi, "$1 $2\uE001")
      .replace(/\b(v)\.\s*(s)\./gi, "$1\uE001$2\uE001")
      .replace(/\bvs\./gi, "vs\uE001")
      .replace(/\bw\.r\.t\./gi, "w\uE001r\uE001t\uE001");
    for (const part of protectedText.match(/[^.!?。！？]+[.!?。！？]?/g) || []) {
      const sentence = part.replace(/[\uE000\uE001]/g, ".").replace(/\s+/g, " ").trim();
      const sentenceKey = normalizeForEvidenceMatch(sentence);
      if (!sentenceKey) continue;
      allSentences.push({ page: page.page, sentence, sentenceKey });
      const embeddedOffset = quoteKey.indexOf(sentenceKey);
      if (sentenceKey.includes(quoteKey) || (embeddedOffset >= 0 && embeddedOffset <= 32)) {
        candidates.push({ page: page.page, sentence, excess: Math.abs(sentenceKey.length - quoteKey.length) });
      }
    }
  }
  const exact = candidates.sort((left, right) => left.excess - right.excess)[0];
  if (exact) return exact;

  const quoteTokens = evidenceTokenSet(quoteKey);
  const fuzzy = allSentences.map((candidate) => {
    const sentenceTokens = evidenceTokenSet(candidate.sentenceKey);
    const shared = [...sentenceTokens].filter((token) => quoteTokens.has(token)).length;
    const coverage = shared / Math.max(1, Math.min(sentenceTokens.size, quoteTokens.size));
    const prefix = commonPrefixLength(candidate.sentenceKey, quoteKey);
    return { ...candidate, shared, coverage, prefix, score: coverage * 100 + Math.min(20, prefix / 6) };
  }).filter((candidate) => candidate.shared >= 8 && (candidate.coverage >= 0.58 || candidate.prefix >= 64))
    .sort((left, right) => right.score - left.score || right.shared - left.shared);
  return fuzzy[0] || null;
}

function evidenceTokenSet(value) {
  return new Set(String(value || "").toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length >= 2) || []);
}

function commonPrefixLength(left, right) {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

function publicTaskState(task) {
  return {
    id: task.id,
    label: task.label,
    goal: task.goal,
    fields: [...task.fields],
    priority: task.priority || "standard",
    status: task.status,
    durationMs: task.durationMs,
    evidenceCount: task.evidenceCount,
    attempts: task.attempts,
    evidenceToolCalls: task.evidenceToolCalls,
    memoryHits: task.memoryHits,
    fallbackUsed: Boolean(task.fallbackUsed),
    phase: task.fallbackUsed ? "completed with grounded fallback" : task.status,
    reactSteps: task.reactSteps.map((step) => ({ ...step })),
    error: task.error
  };
}

function normalizePriorToolTrace(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-30).map((item) => ({
    callId: String(item?.callId || ""),
    name: String(item?.name || "external.tool").slice(0, 80),
    stage: String(item?.stage || "preprocessing").slice(0, 40),
    status: ["completed", "failed", "skipped"].includes(item?.status) ? item.status : "completed",
    durationMs: Math.max(0, Number(item?.durationMs || 0)),
    summary: String(item?.summary || "Completed before analysis.").slice(0, 300),
    runtime: String(item?.runtime || "browser").slice(0, 30),
    metrics: normalizeToolMetrics(item?.metrics)
  }));
}

function normalizeToolMetrics(value) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).slice(0, 20).map(([key, metric]) => [
    String(key).slice(0, 80),
    typeof metric === "boolean" ? metric : Math.max(0, Number(metric || 0))
  ]));
}

function sumToolMetric(records, key) {
  return records.reduce((sum, record) => sum + Math.max(0, Number(record.metrics?.[key] || 0)), 0);
}

function safeErrorMessage(error) {
  const message = String(error?.message || "unknown verification error");
  return message.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 240);
}

function summarizeReadingTaskFailures(readingTasks) {
  const errors = readingTasks.map((task) => task.error).filter(Boolean);
  const combined = errors.join("\n");

  if (/\b402\b|insufficient balance|payment required|billing/i.test(combined)) {
    return "The LLM API rejected every paper-reading task (HTTP 402). Check the provider account balance and billing status, then retry.";
  }
  if (/\b401\b|authentication fails|invalid api key|unauthorized/i.test(combined)) {
    return "The LLM API rejected every paper-reading task (HTTP 401). Check the configured API key, then retry.";
  }
  if (/\b429\b|rate limit|too many requests|quota/i.test(combined)) {
    return "The LLM API rate-limited every paper-reading task (HTTP 429). Wait briefly or check the account quota, then retry.";
  }

  const firstError = errors[0];
  return firstError
    ? `No paper-reading task could be completed by the model. First model error: ${firstError}`
    : "No paper-reading task could be completed by the model.";
}

function parseJsonObject(content, label) {
  const text = String(content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch {}
    }
    throw new Error(`LLM returned invalid ${label} JSON. First 200 chars: ${text.slice(0, 200)}`);
  }
}

function normalizeVerification(value) {
  return {
    verdict: value?.verdict === "revise" ? "revise" : "pass",
    summary: String(value?.summary || "Verification completed."),
    confidence: Math.max(0, Math.min(1, Number(value?.confidence || 0))),
    checks: Array.isArray(value?.checks) ? value.checks.slice(0, 8).map((item) => ({
      id: String(item?.id || item?.name || "check"),
      name: String(item?.name || "check"),
      ok: Boolean(item?.ok),
      severity: ["low", "medium", "high"].includes(item?.severity) ? item.severity : "medium",
      detail: String(item?.detail || ""),
      fields: Array.isArray(item?.fields) ? item.fields.slice(0, 8).map(String) : []
    })) : [],
    missingContent: Array.isArray(value?.missingContent) ? value.missingContent.slice(0, 10).map(String) : [],
    unsupportedClaims: Array.isArray(value?.unsupportedClaims) ? value.unsupportedClaims.slice(0, 10).map(String) : [],
    corrections: value?.corrections && typeof value.corrections === "object" ? value.corrections : {},
    appliedCorrections: {},
    rejectedCorrections: {}
  };
}

function applyCorrections(analysis, corrections, paperContext) {
  const applied = {};
  const rejected = {};
  for (const field of ANALYSIS_FIELDS) {
    const replacement = corrections?.[field];
    if (typeof replacement !== "string" || !replacement.trim()) continue;
    const grounding = checkCorrectionGrounding(replacement, paperContext);
    if (!grounding.ok) {
      rejected[field] = grounding.reason;
      continue;
    }
    if (field === "contributions") {
      const semanticIssue = contributionSemanticIssue(replacement);
      if (semanticIssue) {
        rejected[field] = semanticIssue;
        continue;
      }
    }
    analysis[field] = replacement.trim();
    applied[field] = replacement.trim();
  }
  return { applied, rejected };
}

function checkCorrectionGrounding(replacement, paperContext) {
  const text = String(replacement || "").trim();
  const source = normalizeForEvidenceMatch(paperContext);
  const numbers = text.match(/\b\d+(?:\.\d+)?%?/g) || [];
  const missingNumbers = numbers.filter((number) => !source.includes(number.toLowerCase()));
  if (missingNumbers.length) {
    return { ok: false, reason: `Numbers absent from paper context: ${missingNumbers.join(", ")}.` };
  }
  const words = [...new Set((text.toLowerCase().match(/[a-z][a-z-]{4,}/g) || [])
    .filter((word) => !["which", "their", "about", "these", "those", "paper", "context"].includes(word)))];
  if (words.length >= 4) {
    const matches = words.filter((word) => source.includes(word)).length;
    if (matches < Math.ceil(words.length * 0.2)) {
      return { ok: false, reason: "Correction has too little lexical support in the paper context." };
    }
  }
  return { ok: true, reason: "Correction passed deterministic grounding checks." };
}

function normalizeEvidence(value) {
  const output = {};
  if (!value || typeof value !== "object") return output;
  for (const [key, items] of Object.entries(value)) {
    if (Array.isArray(items)) output[key] = normalizeEvidenceItems(items);
  }
  return output;
}

module.exports = { DEFAULT_PLAN, runPaperAgent, mergeTaskResult, validateTaskEvidence, validateTaskFields, contributionSemanticIssue, applyCorrections, checkCorrectionGrounding, normalizeEvidenceItems };
