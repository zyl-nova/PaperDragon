const ALLOWED_FIELDS = new Set(["summary", "problem", "motivation", "method", "theory", "results", "contributions"]);
const ALLOWED_OPERATIONS = new Set(["shorten", "clarify", "reorganize", "deduplicate", "strengthen_takeaway"]);
const { extractInlineMath, preservesInlineMath } = require("../../src/inline-math");

function createPosterContentRefineTool({ callModel, options = {} }) {
  return {
    name: "poster.content-refine",
    description: "Refining poster copy against paper evidence and visual-review findings",
    stage: "content-refinement",
    runtime: "server",
    inputTypes: ["poster-content"],
    async run({ posterContent = {}, paperContext = {}, requests = [] }) {
      const normalizedRequests = normalizeContentRequests(requests);
      if (!normalizedRequests.length) return { revisions: {}, rejected: {}, raw: null };
      const prompt = buildContentRefinementPrompt({ posterContent, paperContext, requests: normalizedRequests });
      const result = await callModel({
        messages: [
          { role: "system", content: "You are an evidence-grounded academic poster editor. Return valid JSON only." },
          { role: "user", content: prompt }
        ],
        maxTokens: options.maxTokens || 1800,
        responseFormat: { type: "json_object" },
        timeoutMs: options.timeoutMs || 60000,
        textChars: prompt.length
      });
      const proposed = parseJsonObject(result.content)?.revisions || {};
      const validated = validateRevisions(proposed, { posterContent, paperContext, requests: normalizedRequests });
      return { ...validated, raw: result.raw };
    },
    summarize: (result) => `${Object.keys(result.revisions).length} poster section(s) refined; ${Object.keys(result.rejected).length} rejected.`,
    metrics: (result) => {
      const usage = result.raw?.usage || {};
      return {
        inputTokens: Number(usage.prompt_tokens || 0),
        outputTokens: Number(usage.completion_tokens || 0),
        totalTokens: Number(usage.total_tokens || 0),
        revisedSections: Object.keys(result.revisions).length,
        rejectedSections: Object.keys(result.rejected).length
      };
    }
  };
}

function buildContentRefinementPrompt({ posterContent, paperContext, requests }) {
  return `Improve only the requested text fields of an academic conference poster.

GOALS:
- Build a clear problem -> motivation -> method -> evidence/results -> contribution narrative.
- Lead with the takeaway and keep only details useful to a poster reader.
- Remove repetition across panels.
- Use complete, concise sentences. Do not use ellipses.
- Preserve the paper's language when practical.

GROUNDING RULES:
- Use only facts, entities, numbers, datasets, metrics, and claims already present in POSTER CONTENT or PAPER EVIDENCE.
- Never invent a stronger claim, causal relationship, comparison, limitation, formula, or result.
- Do not change mathematical notation or numerical values.
- Preserve every mathematical expression present in the original field verbatim. Never remove a formula while shortening or clarifying prose.
- If the evidence is insufficient, preserve the original field instead of filling gaps.
- Return revisions only for requested fields.
- Each revision must be plain text suitable for a poster, with at most the requested sentence count.

REQUESTS:
${JSON.stringify(requests).slice(0, 5000)}

CURRENT POSTER CONTENT:
${JSON.stringify(posterContent).slice(0, 10000)}

PAPER ANALYSIS AND EVIDENCE:
${JSON.stringify(paperContext).slice(0, 18000)}

Return exactly:
{
  "revisions": {
    "motivation": "replacement text"
  }
}
Return no Markdown and no commentary.`;
}

function normalizeContentRequests(requests) {
  if (!Array.isArray(requests)) return [];
  const seen = new Set();
  return requests.slice(0, 8).map((request) => {
    const field = String(request?.field || "").toLowerCase();
    if (!ALLOWED_FIELDS.has(field) || seen.has(field)) return null;
    seen.add(field);
    const operation = ALLOWED_OPERATIONS.has(request?.operation) ? request.operation : "clarify";
    return {
      field,
      operation,
      objective: safeText(request?.objective, 260),
      maxSentences: Math.max(1, Math.min(3, Number(request?.maxSentences) || 2))
    };
  }).filter(Boolean).slice(0, 5);
}

function validateRevisions(proposed, { posterContent, paperContext, requests }) {
  const revisions = {};
  const rejected = {};
  const requested = new Map(requests.map((request) => [request.field, request]));
  const source = normalizeText(JSON.stringify({ posterContent, paperContext }));
  for (const [field, value] of Object.entries(proposed && typeof proposed === "object" ? proposed : {})) {
    if (!requested.has(field) || typeof value !== "string" || !value.trim()) continue;
    const revision = safeText(value, 900);
    const original = safeText(posterContent?.[field], 1200);
    if (extractInlineMath(original).length && !preservesInlineMath(original, revision)) {
      rejected[field] = "Revision removes or changes mathematical notation from the original field.";
      continue;
    }
    const numbers = revision.match(/\b\d+(?:\.\d+)?%?/g) || [];
    const unsupportedNumbers = numbers.filter((number) => !source.includes(normalizeText(number)));
    if (unsupportedNumbers.length) {
      rejected[field] = `Unsupported numeric evidence: ${unsupportedNumbers.join(", ")}`;
      continue;
    }
    const maxSentences = requested.get(field).maxSentences;
    if (sentenceCount(revision) > maxSentences + 1) {
      rejected[field] = `Revision exceeds the ${maxSentences}-sentence poster budget.`;
      continue;
    }
    if (original && revision.length > Math.max(original.length * 1.45, original.length + 180)) {
      rejected[field] = "Revision expands the panel instead of refining it.";
      continue;
    }
    revisions[field] = revision;
  }
  return { revisions, rejected };
}

function sentenceCount(value) {
  return String(value || "").split(/(?<=[.!?。！？])\s*/).filter((item) => item.trim()).length;
}

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ");
}

function safeText(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function parseJsonObject(content) {
  const source = String(content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(source);
  } catch {
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(source.slice(start, end + 1));
    throw new Error(`Content refiner returned invalid JSON: ${source.slice(0, 200)}`);
  }
}

module.exports = {
  createPosterContentRefineTool,
  buildContentRefinementPrompt,
  normalizeContentRequests,
  validateRevisions
};
