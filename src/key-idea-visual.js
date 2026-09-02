(function registerKeyIdeaVisual(global, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (global) global.PaperKeyIdeaVisual = api;
})(typeof window !== "undefined" ? window : globalThis, function createKeyIdeaVisual() {
  function buildKeyIdeaMap({ theory = "", method = "" } = {}) {
    const primary = clean(theory);
    const supporting = clean(method);
    if (primary && supporting && textSimilarity(primary, supporting) >= 0.68) return null;
    const theoryPhrases = unique(extractPhrases(primary));
    const phrases = (theoryPhrases.length >= 3
      ? theoryPhrases
      : unique([...theoryPhrases, ...extractPhrases(supporting)]))
      .slice(0, 5);
    if (phrases.length < 3) return null;
    return {
      center: phrases[0],
      branches: phrases.slice(1, 5)
    };
  }

  function buildMethodFlow({ method = "" } = {}) {
    const steps = unique(extractPhrases(method)).slice(0, 5);
    if (steps.length < 3) return null;
    return { steps };
  }

  function buildMechanismFlow({ theory = "", method = "" } = {}) {
    const resultPattern = /\b(?:improv(?:e|es|ed|ing)|outperform|state[- ]of[- ]the[- ]art|benchmark|accuracy|performance|result|limitation|addresses?|enables? strong|achieves?)\b|性能|结果|提升|优于|局限/i;
    const mechanismPattern = /\b(?:retrieve|select|rank|encode|condition|marginali[sz]|generate|decode|attend|update|optimi[sz]|combine|fuse|route|sample|predict|train)\w*\b|检索|选择|排序|编码|条件|边缘化|生成|解码|更新|优化|融合|训练/i;
    const phrases = unique([
      ...extractPhrases(method),
      ...extractPhrases(theory)
    ]).filter((phrase) => mechanismPattern.test(phrase) && !resultPattern.test(phrase));
    const steps = phrases.map((phrase) => shortenMechanismStep(phrase)).filter(Boolean).slice(0, 4);
    return steps.length >= 3 ? { steps } : null;
  }

  function shortenMechanismStep(value) {
    const text = stripLead(clean(value))
      .replace(/^(?:the model|the method|the system|rag)\s+/i, "")
      .replace(/\s+(?:in order to|so that)\s+.*$/i, "")
      .trim();
    return truncateAtCompleteClause(text, 120) || (text.length <= 120 ? text : "");
  }

  function shouldBuildKeyIdeaMap({ formulas = [], formulaImages = [], theoryFigures = [] } = {}) {
    return !formulas.length && !formulaImages.length && !theoryFigures.length;
  }

  function extractPhrases(value) {
    const text = clean(value);
    if (!text) return [];
    const protectedText = text
      .replace(/e\.g\./gi, "e\u0001g\u0001")
      .replace(/i\.e\./gi, "i\u0001e\u0001")
      .replace(/(\d)\.(\d)/g, "$1\u0002$2");
    let chunks = protectedText.split(/[.;:]\s*/);
    if (chunks.length < 3) {
      chunks = protectedText.split(/,\s+(?=(?:then|and then|which|while|whereas|but|executes?|generates?|uses?|applies?|feeds?|updates?|refines?|produces?|retrieves?|selects?|encodes?|decodes?)\b)/i);
    }
    return chunks
      .map((chunk) => clean(chunk.replace(/\u0001/g, ".").replace(/\u0002/g, ".")))
      .map(stripLead)
      .filter((chunk) => chunk.length >= 12)
      .map((chunk) => truncateAtCompleteClause(chunk, 180))
      .filter((chunk) => chunk && !endsWithConnector(chunk));
  }

  function stripLead(value) {
    return String(value || "")
      .replace(/^(?:the paper|this paper|the authors|we)\s+(?:introduces?|proposes?|presents?|develops?|shows?)\s+/i, "")
      .replace(/^(?:and|which|while|whereas|then|thereby)\s+/i, "")
      .trim();
  }

  function truncateAtCompleteClause(value, limit) {
    const text = clean(value);
    if (text.length <= limit) return text;
    const cut = text.slice(0, limit + 1);
    const boundaries = [...cut.matchAll(/[,;:]\s+/g)];
    const boundary = boundaries.map((match) => match.index).filter((index) => index >= limit * 0.55).at(-1);
    const candidate = Number.isFinite(boundary) ? cut.slice(0, boundary).trim() : "";
    return candidate && !endsWithConnector(candidate) ? candidate : "";
  }

  function endsWithConnector(value) {
    return /\b(?:and|or|with|without|that|which|to|for|from|into|by|through|then|thereby|yielding|enabling|generates?|executes?|uses?|applies?|feeds?|updates?|refines?|produces?|retrieves?|selects?|encodes?|decodes?)$/i.test(clean(value));
  }

  function unique(values) {
    const seen = new Set();
    return values.filter((value) => {
      const key = clean(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function textSimilarity(left, right) {
    const tokens = (value) => new Set(clean(value).toLowerCase()
      .match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu) || []);
    const a = tokens(left);
    const b = tokens(right);
    if (!a.size || !b.size) return 0;
    const shared = [...a].filter((token) => b.has(token)).length;
    return shared / Math.min(a.size, b.size);
  }

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  return { buildKeyIdeaMap, buildMethodFlow, buildMechanismFlow, shouldBuildKeyIdeaMap, extractPhrases, textSimilarity };
});
