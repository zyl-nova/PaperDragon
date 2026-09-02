const PANELS = new Set(["problem", "motivation", "method", "theory", "visuals", "results", "contribution", "global"]);
const SEVERITIES = new Set(["high", "medium", "low"]);

function createPosterVisionReviewTool({ callModel, options = {} }) {
  return {
    name: "vision.poster-review",
    description: "Inspecting poster assets, content, and layout during production",
    stage: "visual-review",
    runtime: "server",
    inputTypes: ["poster-image"],
    async run({ imageDataUrl, metrics = {}, posterContent = {}, paperContext = {}, stage = "final", iteration = 1, previousReview = null }) {
      if (!isImageDataUrl(imageDataUrl)) throw new Error("Poster review requires a PNG, JPEG, or WebP data URL.");
      const prompt = buildPosterReviewPrompt({ metrics, posterContent, paperContext, stage, iteration, previousReview });
      const result = await callModel({
        messages: [
          {
            role: "system",
            content: "You are a rigorous multimodal academic-poster production inspector. Check the requested production stage, use the supplied paper evidence, and return valid JSON."
          },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageDataUrl } }
            ]
          }
        ],
        maxTokens: options.maxTokens || 2200,
        responseFormat: { type: "json_object" },
        timeoutMs: options.timeoutMs || 90000,
        textChars: prompt.length
      });
      return { review: normalizePosterReview(parseJsonObject(result.content), stage), raw: result.raw };
    },
    summarize: (result) => `Visual review scored ${result.review.overallScore}/100 with ${result.review.issues.length} issue(s).`,
    metrics: (result) => {
      const usage = result.raw?.usage || {};
      return {
        inputTokens: Number(usage.prompt_tokens || 0),
        outputTokens: Number(usage.completion_tokens || 0),
        totalTokens: Number(usage.total_tokens || 0),
        score: result.review.overallScore,
        issues: result.review.issues.length
      };
    }
  };
}

function buildPosterReviewPrompt({ metrics, posterContent, paperContext, stage = "final", iteration, previousReview }) {
  const normalizedStage = ["assets", "content", "layout", "final"].includes(stage) ? stage : "final";
  const stageInstructions = {
    assets: `ASSET EXTRACTION CHECK. Inspect every visible formula, figure, and table. Check that each crop contains the complete intended asset, excludes adjacent body text and unrelated captions, preserves labels and equation numbers, is not distorted, and is legible. Also check that the selected asset supports the panel where it appears. Do not request prose rewrites. Use layout adjustments only to enlarge or rebalance illegible assets.`,
    content: `CONTENT DRAFT CHECK. Inspect every content section: summary, research problem, motivation, method, theory/formulas, results, and contributions. Check scientific coherence against PAPER CONTEXT, completeness, concise takeaway quality, evidence support, repetition, truncation, and whether nearby explanations state what each visual proves. Request evidence-grounded rewrites through contentRequests. Do not spend this stage on minor spacing or decoration.`,
    layout: `LAYOUT COMPOSITION CHECK. Inspect clipping, overflow, image/table/formula scale, typography, hierarchy, reading order, whitespace, alignment, and overall rectangular composition. Make constrained layout and style adjustments. Do not request scientific rewrites unless a high-severity content defect makes the poster misleading.`,
    final: `FINAL ACCEPTANCE CHECK. Verify the complete poster across assets, scientific content, narrative, evidence, and layout. Report only remaining actionable defects.`
  };
  return `Review this in-progress academic conference poster during its ${normalizedStage.toUpperCase()} production stage.

${stageInstructions[normalizedStage]}

Priorities, in order:
1. No clipped, hidden, overlapping, or unreadably small content.
2. Key method figures, formulas, and result tables must be legible.
3. Clear visual hierarchy and reading path: problem/motivation -> method -> evidence/results -> contribution.
4. Balanced use of space without forcing every panel into equal dimensions.
5. Concise conference-poster appearance rather than a web dashboard or paper transcript.
6. Content selection: retain the central problem, method, strongest evidence, and concrete contribution; remove secondary or repeated material.
7. Narrative quality: every panel should advance one coherent problem -> motivation -> method -> evidence -> contribution story.
8. Communication quality: headings and opening sentences should state takeaways rather than generic labels or process descriptions.
9. Figure/table interpretation: nearby text should explain what the selected visual proves, not merely repeat its caption.
10. Evidence discipline: flag vague or unsupported-looking claims, but use only PAPER CONTEXT to judge them.

Do not invent or rewrite scientific claims yourself. Do not suggest adding decorative illustrations. Base observations on the rendered poster, supplied content, measurements, and paper context. A panel may be: problem, motivation, method, theory, visuals, results, contribution, or global. Content revisions may target only summary, problem, motivation, method, theory, results, or contributions; request an evidence-grounded text refiner instead of writing replacement copy.

This is ${normalizedStage} inspection iteration ${Number(iteration) || 1}.
Measured layout data:
${JSON.stringify(metrics).slice(0, 12000)}
Current poster content:
${JSON.stringify(posterContent).slice(0, 10000)}
Paper context and evidence:
${JSON.stringify(paperContext).slice(0, 14000)}
${previousReview ? `Previous review summary:\n${JSON.stringify(previousReview).slice(0, 4000)}` : ""}

Every score below MUST be an integer on a 0-100 scale. Never use a 0-10 or 0-1 scale.
Return exactly one JSON object with this shape:
{
  "overallScore": 0,
  "stage": "${normalizedStage}",
  "verdict": "pass or revise",
  "summary": "one concise sentence",
  "dimensions": {
    "readability": 0,
    "hierarchy": 0,
    "balance": 0,
    "assetLegibility": 0,
    "contentDensity": 0,
    "polish": 0,
    "narrative": 0,
    "contentSelection": 0,
    "evidenceCommunication": 0,
    "concision": 0
  },
  "strengths": ["up to four visible strengths"],
  "issues": [{
    "panel": "results",
    "severity": "high, medium, or low",
    "category": "clipping, readability, hierarchy, whitespace, density, alignment, asset_scale, redundancy, vague_takeaway, weak_narrative, weak_caption, missing_evidence, or content_selection",
    "observation": "specific visible problem",
    "recommendation": "specific repair"
  }],
  "layoutAdjustments": [{
    "panel": "results",
    "areaScale": 1.2,
    "widthScale": 1.1,
    "heightScale": 1.1,
    "reason": "short reason"
  }],
  "contentRequests": [{
    "field": "motivation",
    "operation": "shorten, clarify, reorganize, deduplicate, or strengthen_takeaway",
    "objective": "describe what must improve without writing replacement claims",
    "maxSentences": 2
  }],
  "styleAdjustments": {
    "bodyFontScale": 1.0,
    "headingScale": 1.0,
    "mediaScale": 1.0,
    "contrast": "keep or increase"
  }
}

Adjustment scales must remain between 0.8 and 1.35. Use the fewest adjustments necessary. Return no Markdown.`;
}

function parseJsonObject(content) {
  const source = String(content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(source);
  } catch {
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(source.slice(start, end + 1));
    throw new Error(`Vision model returned invalid JSON: ${source.slice(0, 200)}`);
  }
}

function normalizePosterReview(value = {}, stage = "final") {
  const dimensions = value.dimensions && typeof value.dimensions === "object" ? value.dimensions : {};
  const dimensionValues = Object.values(dimensions).map(Number).filter(Number.isFinite);
  const dimensionScoreMultiplier = inferScoreMultiplier(dimensionValues);
  const normalizedDimensionValues = dimensionValues.map((item) => item * dimensionScoreMultiplier);
  const medianDimension = median(normalizedDimensionValues.filter((item) => item > 0));
  const rawOverallScore = Number(value.overallScore) || 0;
  const overallScoreMultiplier = dimensionScoreMultiplier > 1
    ? dimensionScoreMultiplier
    : rawOverallScore > 0 && rawOverallScore <= 10 && medianDimension >= 40
      ? 10
      : 1;
  const issues = Array.isArray(value.issues) ? value.issues.slice(0, 10).map((issue) => ({
    panel: normalizePanel(issue?.panel),
    severity: SEVERITIES.has(issue?.severity) ? issue.severity : "medium",
    category: safeText(issue?.category, 40) || "readability",
    observation: safeText(issue?.observation, 260),
    recommendation: safeText(issue?.recommendation, 260)
  })).filter((issue) => issue.observation) : [];
  const layoutAdjustments = Array.isArray(value.layoutAdjustments)
    ? value.layoutAdjustments.slice(0, 7).map(normalizeLayoutAdjustment).filter(Boolean)
    : [];
  const style = value.styleAdjustments && typeof value.styleAdjustments === "object" ? value.styleAdjustments : {};
  const overallScore = score(value.overallScore, overallScoreMultiplier);
  return {
    stage: ["assets", "content", "layout", "final"].includes(stage) ? stage : "final",
    overallScore,
    verdict: String(value.verdict || "").toLowerCase() === "pass" && !issues.some((issue) => issue.severity === "high") ? "pass" : "revise",
    summary: safeText(value.summary, 360) || "Visual review completed.",
    dimensions: {
      readability: score(dimensions.readability, dimensionScoreMultiplier),
      hierarchy: score(dimensions.hierarchy, dimensionScoreMultiplier),
      balance: score(dimensions.balance, dimensionScoreMultiplier),
      assetLegibility: score(dimensions.assetLegibility, dimensionScoreMultiplier),
      contentDensity: score(dimensions.contentDensity, dimensionScoreMultiplier),
      polish: score(dimensions.polish, dimensionScoreMultiplier),
      narrative: score(dimensions.narrative, dimensionScoreMultiplier),
      contentSelection: score(dimensions.contentSelection, dimensionScoreMultiplier),
      evidenceCommunication: score(dimensions.evidenceCommunication, dimensionScoreMultiplier),
      concision: score(dimensions.concision, dimensionScoreMultiplier)
    },
    strengths: Array.isArray(value.strengths) ? value.strengths.slice(0, 4).map((item) => safeText(item, 180)).filter(Boolean) : [],
    issues,
    layoutAdjustments,
    contentRequests: normalizeContentRequests(value.contentRequests),
    styleAdjustments: {
      bodyFontScale: scale(style.bodyFontScale),
      headingScale: scale(style.headingScale),
      mediaScale: scale(style.mediaScale),
      contrast: style.contrast === "increase" ? "increase" : "keep"
    }
  };
}

function normalizeContentRequests(value) {
  const fields = new Set(["summary", "problem", "motivation", "method", "theory", "results", "contributions"]);
  const operations = new Set(["shorten", "clarify", "reorganize", "deduplicate", "strengthen_takeaway"]);
  const seen = new Set();
  return (Array.isArray(value) ? value : []).slice(0, 8).map((item) => {
    const field = String(item?.field || "").toLowerCase();
    if (!fields.has(field) || seen.has(field)) return null;
    seen.add(field);
    return {
      field,
      operation: operations.has(item?.operation) ? item.operation : "clarify",
      objective: safeText(item?.objective, 260),
      maxSentences: Math.max(1, Math.min(3, Number(item?.maxSentences) || 2))
    };
  }).filter(Boolean).slice(0, 5);
}

function normalizeLayoutAdjustment(item) {
  if (!item || typeof item !== "object") return null;
  const panel = normalizePanel(item.panel);
  if (panel === "global") return null;
  return {
    panel,
    areaScale: scale(item.areaScale),
    widthScale: scale(item.widthScale),
    heightScale: scale(item.heightScale),
    reason: safeText(item.reason, 180)
  };
}

function isImageDataUrl(value) {
  return /^data:image\/(?:png|jpeg|webp);base64,/i.test(String(value || ""));
}

function normalizePanel(value) {
  const panel = String(value || "global").toLowerCase();
  return PANELS.has(panel) ? panel : "global";
}

function safeText(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function score(value, multiplier = 1) {
  return Math.round(Math.max(0, Math.min(100, (Number(value) || 0) * multiplier)));
}

function inferScoreMultiplier(values) {
  const positive = values.filter((value) => Number.isFinite(value) && value > 0);
  if (positive.length < 3) return 1;
  const maximum = Math.max(...positive);
  if (maximum <= 1) return 100;
  if (maximum <= 10) return 10;
  return 1;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function scale(value) {
  return Math.max(0.8, Math.min(1.35, Number(value) || 1));
}

module.exports = {
  createPosterVisionReviewTool,
  buildPosterReviewPrompt,
  normalizePosterReview,
  normalizeContentRequests,
  isImageDataUrl
};
