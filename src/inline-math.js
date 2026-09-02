(function registerInlineMath(global) {
  const TOKEN_PATTERN = /(\\\([^\n]{2,180}?\\\)|\$[^$\n]{2,180}\$|(?:O|Θ|Ω)\s*\([^\n)]{1,120}\))/g;

  function renderInlineMath(value) {
    const source = String(value || "");
    let cursor = 0;
    let output = "";
    for (const match of collectInlineMathTokens(source)) {
      const index = match.index;
      output += escapeHtml(source.slice(cursor, index));
      const formula = normalizeFormula(match.value);
      output += `<span class="poster-inline-math">${toReadableMathHtml(formula)}</span>`;
      cursor = index + match.value.length;
    }
    return output + escapeHtml(source.slice(cursor));
  }

  function extractInlineMath(value) {
    return collectInlineMathTokens(String(value || "")).map((match) => normalizeFormula(match.value));
  }

  function collectInlineMathTokens(source) {
    const tokens = [...String(source || "").matchAll(TOKEN_PATTERN)].map((match) => ({
      index: Number(match.index || 0), value: match[0]
    }));
    for (const match of findBareEquationTokens(source)) {
      const overlaps = tokens.some((token) => match.index < token.index + token.value.length
        && token.index < match.index + match.value.length);
      if (!overlaps) tokens.push(match);
    }
    const inlinePatterns = [
      /\b[A-Za-z]\s*~\s*p_[A-Za-z][A-Za-z0-9]*/g,
      /\b[A-Z][A-Za-z0-9_]*\s*=\s*[A-Z][A-Za-z0-9_]*\([^()]{1,80}\)/g,
      /\bP\([^()|]{1,40}\|[^()]{1,40}\)/g,
      /\bL_[A-Za-z][A-Za-z0-9]*\b/g
    ];
    for (const pattern of inlinePatterns) {
      for (const match of String(source || "").matchAll(pattern)) {
        const token = { index: Number(match.index || 0), value: match[0] };
        const overlaps = tokens.some((existing) => token.index < existing.index + existing.value.length
          && existing.index < token.index + token.value.length);
        if (!overlaps) tokens.push(token);
      }
    }
    return tokens.sort((left, right) => left.index - right.index);
  }

  function findBareEquationTokens(value) {
    const source = String(value || "");
    const tokens = [];
    const startPattern = /\b(?:arg\s*)?(?:min|max)\s*_\s*(?:\{[^}\n]+\}|[A-Za-z0-9]+)\b/gi;
    for (const start of source.matchAll(startPattern)) {
      const index = Number(start.index || 0);
      const tail = source.slice(index, index + 420);
      const boundary = tail.search(/[.!?](?=\s+[A-Z]|\s*$)/);
      let candidate = tail.slice(0, boundary >= 0 ? boundary : tail.length).trim();
      candidate = candidate.replace(/[.;,\s]+$/g, "");
      const mathMarks = candidate.match(/[=+\-*/^_(){}\[\]|~]/g) || [];
      if (!candidate.includes("=") || mathMarks.length < 8 || candidate.length < 16) continue;
      tokens.push({ index, value: candidate });
    }
    return tokens;
  }

  function preservesInlineMath(original, replacement) {
    const replacementKeys = new Set(extractInlineMath(replacement).map(mathKey));
    return extractInlineMath(original).every((formula) => replacementKeys.has(mathKey(formula)));
  }

  function repairMissingInlineMath(value, sourceFormulas = []) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text || extractInlineMath(text).length || !/complexit(?:y|ies)/i.test(text)) return text;
    const formula = findComplexityFormula(sourceFormulas, text);
    if (!formula) return text;
    const wrapped = `\\(${formula}\\)`;
    const emptyComparison = /\b(complexit(?:y|ies))\s+from\s+to\s*,?\s*(?=where\b)/i;
    if (emptyComparison.test(text)) {
      return text.replace(emptyComparison, (_, word) => `${word} to ${wrapped}, `);
    }
    const missingSlot = /\b(complexit(?:y|ies))(\s+of)?\s+(?=where\b)/i;
    if (missingSlot.test(text)) {
      return text.replace(missingSlot, (_, word, of = "") => `${word}${of || ""} ${wrapped}, `);
    }
    return `${text.replace(/[.\s]+$/, "")}. The source gives the corresponding complexity as ${wrapped}.`;
  }

  function findComplexityFormula(values, hint = "") {
    const hintVariables = new Set(String(hint || "").match(/\b[A-Z]\b/g) || []);
    const candidates = [];
    for (const value of Array.isArray(values) ? values : []) {
      const source = String(value || "")
        .replace(/\\begin\{(?:equation\*?|align\*?|gather\*?|multline\*?|eqnarray\*?)\}/g, " ")
        .replace(/\\end\{(?:equation\*?|align\*?|gather\*?|multline\*?|eqnarray\*?)\}/g, " ");
      for (const match of source.matchAll(/\\mathcal\{O\}\s*\([^)]{1,160}\)|(?:O|Θ|Ω)\s*\([^)]{1,160}\)/gi)) {
        const formula = normalizeFormula(match[0])
          .replace(/^\\mathcal\{O\}/, "O")
          .replace(/\b([A-Za-z]+)2\b/g, "$1^{2}");
        const variables = new Set(formula.replace(/^O/, "").match(/[A-Z]/g) || []);
        const shared = [...hintVariables].filter((item) => variables.has(item)).length;
        candidates.push({ formula, score: shared * 10 + variables.size + (formula.includes("+") ? 2 : 0) });
      }
    }
    return candidates.sort((left, right) => right.score - left.score)[0]?.formula || "";
  }

  function mathKey(value) {
    return normalizeFormula(value).replace(/\\(?:left|right)/g, "").replace(/\s+/g, "").toLowerCase();
  }

  function normalizeFormula(value) {
    let formula = String(value || "").trim();
    if (formula.startsWith("\\(") && formula.endsWith("\\)")) formula = formula.slice(2, -2).trim();
    if (formula.startsWith("$") && formula.endsWith("$")) formula = formula.slice(1, -1).trim();
    return formula
      .replaceAll("²", "^{2}")
      .replaceAll("³", "^{3}")
      .replaceAll("≤", "\\leq ")
      .replaceAll("≥", "\\geq ");
  }

  function toPlainMath(value) {
    return normalizeFormula(value)
      .replace(/\^\{2\}/g, "²")
      .replace(/\^\{3\}/g, "³")
      .replace(/\^2\b/g, "²")
      .replace(/\^3\b/g, "³")
      .replace(/\\leq\s*/g, "≤")
      .replace(/\\geq\s*/g, "≥")
      .replace(/\\cdot\s*/g, "·")
      .replace(/\\mathcal\{O\}/g, "O")
      .replace(/\\mathrm\{([^{}]+)\}/g, "$1");
  }

  function toMathJaxInline(value) {
    return normalizeFormula(value)
      .replace(/\b(arg\s*)?(min|max)\s*_\s*\{?([A-Za-z0-9]+)\}?/gi, (_, arg = "", operator, variable) => `\\${arg ? "arg" : ""}${operator.toLowerCase()}_{${variable}}`)
      .replace(/\bE_\{/g, "\\mathbb{E}_{")
      .replace(/\bp_data\b/g, "p_{\\mathrm{data}}")
      .replace(/\bp_([A-Za-z])\b/g, "p_{$1}")
      .replace(/~/g, "\\sim ")
      .replace(/\blog\b/g, "\\log")
      .replace(/\|/g, "\\mid ")
      .replace(/\\bm\{([^{}]+)\}/g, "\\mathbf{$1}")
      .replace(/\\bm([A-Za-z])/g, "\\mathbf{$1}");
  }

  function toReadableMathHtml(value) {
    let text = normalizeFormula(value)
      .replace(/\\mathbb\{E\}/g, "E")
      .replace(/\\(?:left|right)/g, "")
      .replace(/\\log\b/g, "log")
      .replace(/\\sim\b/g, "~")
      .replace(/\\mid\b/g, "|")
      .replace(/\\mathbf\{([^{}]+)\}/g, "$1")
      .replace(/\\bm\{([^{}]+)\}/g, "$1")
      .replace(/\\bm([A-Za-z])/g, "$1")
      .replace(/\\mathrm\{([^{}]+)\}/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    const expectations = [];
    text = text.replace(/\bE_\{([^{}]+)\}/g, (_, content) => {
      expectations.push(content);
      return `@@EXPECT${expectations.length - 1}@@`;
    });
    text = escapeHtml(text)
      .replace(/\b(min|max)_\{?([A-Za-z0-9]+)\}?/gi, '<span class="math-operator">$1</span><sub>$2</sub>')
      .replace(/\b([A-Za-z])_\{?([A-Za-z0-9]+)\}?\b/g, '$1<sub>$2</sub>')
      .replace(/\^\{([^{}]+)\}/g, '<sup>$1</sup>')
      .replace(/\^([A-Za-z0-9]+)\b/g, '<sup>$1</sup>')
      .replace(/~/g, "∼")
      .replace(/\|/g, "∣")
      .replace(/\\leq\s*/g, "≤")
      .replace(/\\geq\s*/g, "≥");
    text = text.replace(/@@EXPECT(\d+)@@/g, (_, index) => {
      const content = escapeHtml(expectations[Number(index)] || "")
        .replace(/~/g, "∼")
        .replace(/\|/g, "∣");
      return `<span class="math-expectation">𝔼</span><sub>${content}</sub>`;
    });
    return text.replace(/\s([+=−-])\s/g, " <wbr>$1 ");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  const api = { renderInlineMath, normalizeFormula, toPlainMath, toMathJaxInline, toReadableMathHtml, extractInlineMath, preservesInlineMath, repairMissingInlineMath, findComplexityFormula };
  global.PaperInlineMath = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
