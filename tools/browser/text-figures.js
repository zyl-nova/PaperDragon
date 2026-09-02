(function registerTextFigureDefinition(global) {
  function extractFigures(text) {
    const assets = [];
    for (const line of String(text || "").slice(0, 16000).split(/\n/)) {
      if (assets.length >= 8) break;
      const latexAsset = line.match(/(?:Figure|Table)\s+\d+:\s*\[([^\]\n]{2,240})\]\s*Source:\s*([^\n]+)/i);
      if (latexAsset) {
        assets.push({ name: latexAsset[1].trim(), source: latexAsset[2].trim() });
        continue;
      }
      const markdown = line.match(/!\[([^\]]*)\]\(([^)]+)\)/);
      if (markdown) {
        assets.push({ name: markdown[1] || `Figure ${assets.length + 1}`, source: markdown[2] });
        continue;
      }
      const plain = line.match(/(?:\u56fe\u7247|\u63d2\u56fe|\u56fe|figure|fig\.)\s*[:\uff1a]?\s*\[?([^\]\n\u3002]{4,120})\]?/i);
      if (plain) assets.push({ name: plain[1].trim(), source: "Original paper figure placeholder" });
    }
    const seen = new Set();
    return assets.filter((item) => {
      const key = `${item.name}|${item.source}`.toLowerCase().replace(/\s+/g, " ").trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 8);
  }

  global.PaperToolAlgorithms ||= {};
  global.PaperToolAlgorithms.extractFigures = extractFigures;
  global.PaperToolDefinitions ||= {};
  global.PaperToolDefinitions.textFigures = () => ({
    name: "text.figures",
    description: "Extract text figure references",
    stage: "preprocessing",
    runtime: "browser",
    inputTypes: ["pdf", "text"],
    run: ({ text }) => extractFigures(text),
    summarize: (items) => `${items.length} figure references detected.`
  });
})(window);
