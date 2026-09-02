(function registerTextFormulaDefinition(global) {
  function uniqueStrings(items) {
    const seen = new Set();
    const output = [];
    for (const item of items) {
      const key = item.replace(/\s+/g, " ").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push(item);
    }
    return output;
  }

  function isPlausibleFormula(value) {
    const source = String(value || "").trim();
    if (source.length < 3 || /\\(?:author|affiliation|institution|email|orcid|thanks)\b/i.test(source)) return false;
    if (/^[,;:'`.\s\p{L}-]+$/u.test(source)) return false;
    return /[=<>≈≃∝±×÷+*/^_|]|\\(?:sum|prod|int|frac|sqrt|min|max|log|exp|argmin|argmax|mathbb|mathbf|mathrm|operatorname)\b/i.test(source)
      || /[A-Za-z]_[{A-Za-z0-9]|[A-Za-z]\s*\([^)]*[|,][^)]*\)/.test(source);
  }

  function extractFormulas(text) {
    const formulas = [];
    const lines = String(text || "").slice(0, 16000).split(/\n/);
    let block = [];
    let blockMode = "";
    for (const line of lines) {
      if (formulas.length >= 8) break;
      if (blockMode === "$$") {
        if (line.trim() === "$$") {
          formulas.push(block.join("\n").trim());
          block = [];
          blockMode = "";
        } else block.push(line);
        continue;
      }
      const envStart = line.match(/\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|eqnarray\*?)\}/);
      if (!blockMode && envStart) {
        blockMode = envStart[1];
        block = [line];
        if (line.includes(`\\end{${blockMode}}`)) {
          formulas.push(block.join("\n").trim());
          block = [];
          blockMode = "";
        }
        continue;
      }
      if (blockMode) {
        block.push(line);
        if (line.includes(`\\end{${blockMode}}`)) {
          formulas.push(block.join("\n").trim());
          block = [];
          blockMode = "";
        }
        continue;
      }
      if (line.trim() === "$$") {
        blockMode = "$$";
        block = [];
        continue;
      }
      const inline = line.match(/\$([^$\n]{2,220})\$/);
      if (inline) formulas.push(inline[1].trim());
    }
    return uniqueStrings(formulas.filter(isPlausibleFormula)).slice(0, 8);
  }

  global.PaperToolAlgorithms ||= {};
  global.PaperToolAlgorithms.extractFormulas = extractFormulas;
  global.PaperToolAlgorithms.isPlausibleFormula = isPlausibleFormula;
  global.PaperToolDefinitions ||= {};
  global.PaperToolDefinitions.textFormulas = () => ({
    name: "text.formulas",
    description: "Extract explicit text formulas",
    stage: "preprocessing",
    runtime: "browser",
    inputTypes: ["pdf", "text"],
    run: ({ text }) => extractFormulas(text),
    summarize: (items) => `${items.length} explicit formulas detected.`
  });
})(window);
