const path = require("path");
const { normalizeArchivePath, extractLatexCaption } = require("./latex-utils");

function assetMime(fileName) {
  const extension = path.posix.extname(fileName).toLowerCase();
  return {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".pdf": "application/pdf"
  }[extension] || "";
}

function cacheArxivAssets(assetCache, id, files) {
  const assets = new Map();
  let totalBytes = 0;
  for (const file of files) {
    const name = normalizeArchivePath(file.name);
    const mime = assetMime(name);
    if (!mime || !Buffer.isBuffer(file.data)) continue;
    if (file.data.length > 30_000_000 || totalBytes + file.data.length > 120_000_000) continue;
    assets.set(name.toLowerCase(), { name, mime, data: file.data });
    totalBytes += file.data.length;
  }
  assetCache.delete(id);
  assetCache.set(id, assets);
  while (assetCache.size > 4) assetCache.delete(assetCache.keys().next().value);
}

function resolveFigureAsset(rawPath, files, id) {
  const requested = normalizeArchivePath(rawPath);
  if (!requested) return null;
  const extensions = ["", ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif"];
  const fileNames = files.map((file) => normalizeArchivePath(file.name)).filter((name) => assetMime(name));
  const lowerNames = new Map(fileNames.map((name) => [name.toLowerCase(), name]));
  let match = null;
  for (const extension of extensions) {
    match = lowerNames.get(`${requested}${extension}`.toLowerCase());
    if (match) break;
  }
  if (!match) {
    const requestedBase = path.posix.basename(requested).toLowerCase();
    match = fileNames.find((name) => path.posix.basename(name.replace(/\.[^.]+$/, "")).toLowerCase() === requestedBase);
  }
  if (!match) return null;
  return {
    path: match,
    type: assetMime(match),
    url: `/api/arxiv-asset?id=${encodeURIComponent(id)}&path=${encodeURIComponent(match)}`
  };
}

function extractLatexFigures(text, files = [], id = "") {
  return [...text.matchAll(/\\begin\{figure\*?\}([\s\S]*?)\\end\{figure\*?\}/g)]
    .map((match, index) => {
      const block = match[1];
      const graphics = [...block.matchAll(/\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g)].map((item) => item[1].trim());
      return {
        name: `Figure ${index + 1}`,
        source: graphics.join(", ") || "figure environment in LaTeX source",
        caption: extractLatexCaption(block) || "caption not found",
        assets: graphics.map((graphic) => resolveFigureAsset(graphic, files, id)).filter(Boolean)
      };
    })
    .slice(0, 12);
}

function getCachedAsset(assetCache, id, assetPath) {
  const normalized = normalizeArchivePath(assetPath);
  return id && normalized ? assetCache.get(id)?.get(normalized.toLowerCase()) : null;
}

function createLatexFigureTool({ assetCache }) {
  return {
    name: "latex.figures",
    description: "Resolving original LaTeX figure assets",
    stage: "extraction",
    runtime: "server",
    inputTypes: ["arxiv"],
    run: ({ latex, files, arxivId }) => {
      cacheArxivAssets(assetCache, arxivId, files);
      return extractLatexFigures(latex, files, arxivId);
    },
    summarize: (items) => `${items.length} figures; ${items.filter((item) => item.assets?.length).length} with original artwork.`
  };
}

module.exports = { createLatexFigureTool, extractLatexFigures, getCachedAsset, normalizeArchivePath, assetMime };
