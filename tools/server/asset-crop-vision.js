function createAssetCropVisionTool({ callModel, options = {} }) {
  return {
    name: "vision.asset-crop",
    description: "Refine a PDF asset crop against its surrounding page context",
    stage: "asset-production",
    runtime: "server",
    inputTypes: ["pdf-context-image"],
    async run({ imageDataUrl, assetKind, caption = "", candidateBox = {} }) {
      if (!isImageDataUrl(imageDataUrl)) throw new Error("Asset crop inspection requires a PNG, JPEG, or WebP data URL.");
      const prompt = buildAssetCropPrompt({ assetKind, caption, candidateBox });
      const result = await callModel({
        messages: [
          {
            role: "system",
            content: "You precisely localize academic figures, tables, and equations in PDF page images. Return valid JSON only."
          },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageDataUrl } }
            ]
          }
        ],
        maxTokens: options.maxTokens || 700,
        responseFormat: { type: "json_object" },
        timeoutMs: options.timeoutMs || 60000,
        textChars: prompt.length
      });
      return { inspection: normalizeAssetCrop(parseJsonObject(result.content), candidateBox, assetKind), raw: result.raw };
    },
    summarize: (result) => result.inspection.applied
      ? `Vision refined the asset crop at ${Math.round(result.inspection.confidence * 100)}% confidence.`
      : "Vision kept the coordinate-based asset crop."
  };
}

function buildAssetCropPrompt({ assetKind, caption, candidateBox }) {
  return `Inspect this PDF page context and localize exactly one ${normalizeKind(assetKind)}.

The coordinate system is normalized to the supplied image: left/top are 0 and right/bottom are 1.
The current algorithmic candidate is ${JSON.stringify(normalizeBox(candidateBox))}.
Caption or identifier: ${String(caption || "").replace(/\s+/g, " ").trim().slice(0, 500)}

Find the complete visual asset associated with that identifier. For a table, include every rule, header, data row, footnote marker that belongs inside the table, and all glyph ascenders/descenders. Exclude the table caption and neighboring body prose. For an equation, include the complete numerator, denominator, delimiters, superscripts, subscripts, and equation number, but exclude explanatory prose. For a figure, include the complete artwork and internal labels, but exclude its external caption.

Inspect all four edges for clipping. Do not simply repeat the candidate box: correct it using visible pixels and page structure. If the intended asset cannot be identified confidently, set found to false.

Return exactly:
{
  "found": true,
  "confidence": 0.0,
  "complete": true,
  "bbox": { "left": 0.0, "top": 0.0, "right": 1.0, "bottom": 1.0 },
  "clippedEdges": ["top"],
  "notes": "brief reason"
}`;
}

function normalizeAssetCrop(value = {}, candidateBox = {}, assetKind = "figure") {
  const fallback = normalizeBox(candidateBox);
  const bbox = normalizeBox(value.bbox, fallback);
  const confidence = Math.max(0, Math.min(1, Number(value.confidence) || 0));
  const clippedEdges = Array.isArray(value.clippedEdges)
    ? value.clippedEdges.filter((edge) => ["top", "right", "bottom", "left"].includes(edge)).slice(0, 4)
    : [];
  const complete = value.complete === true;
  const valid = Boolean(value.found)
    && complete
    && clippedEdges.length === 0
    && confidence >= 0.55
    && boxArea(bbox) >= 0.01
    && hasPlausibleAssetGeometry(bbox, assetKind)
    && boxesOverlap(bbox, fallback);
  return {
    found: Boolean(value.found),
    complete,
    confidence,
    bbox: valid ? bbox : fallback,
    clippedEdges,
    notes: String(value.notes || "").replace(/\s+/g, " ").trim().slice(0, 240),
    applied: valid
  };
}

function hasPlausibleAssetGeometry(box, assetKind) {
  const width = Math.max(0, box.right - box.left);
  const height = Math.max(0, box.bottom - box.top);
  const aspect = width / Math.max(height, 0.001);
  if (assetKind === "formula") return width >= 0.08 && height >= 0.025 && aspect <= 24;
  if (assetKind === "table") return width >= 0.18 && height >= 0.08 && aspect <= 10;
  return width >= 0.12 && height >= 0.08 && aspect <= 8;
}

function normalizeBox(value = {}, fallback = { left: 0, top: 0, right: 1, bottom: 1 }) {
  const source = value && typeof value === "object" ? value : {};
  const left = clamp(source.left, fallback.left ?? 0);
  const top = clamp(source.top, fallback.top ?? 0);
  const right = clamp(source.right, fallback.right ?? 1);
  const bottom = clamp(source.bottom, fallback.bottom ?? 1);
  if (right - left < 0.02 || bottom - top < 0.02) return { ...fallback };
  return { left, top, right, bottom };
}

function boxesOverlap(left, right) {
  const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
  return width * height >= Math.min(boxArea(left), boxArea(right)) * 0.18;
}

function boxArea(box) {
  return Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top);
}

function clamp(value, fallback) {
  const number = Number(value);
  return Math.max(0, Math.min(1, Number.isFinite(number) ? number : Number(fallback) || 0));
}

function normalizeKind(value) {
  return ["table", "formula", "figure"].includes(value) ? value : "academic visual asset";
}

function parseJsonObject(content) {
  const source = String(content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(source);
  } catch {
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(source.slice(start, end + 1));
    throw new Error(`Vision model returned invalid crop JSON: ${source.slice(0, 200)}`);
  }
}

function isImageDataUrl(value) {
  return /^data:image\/(?:png|jpeg|webp);base64,/i.test(String(value || ""));
}

module.exports = { createAssetCropVisionTool, buildAssetCropPrompt, normalizeAssetCrop };
