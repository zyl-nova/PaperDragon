(function registerPosterNarrative(global, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (global) global.PosterNarrative = api;
})(typeof window !== "undefined" ? window : globalThis, function createPosterNarrative() {
  function composeResults(analysis = {}) {
    return joinDistinct([
      analysis.results,
      analysis.experimentsValidateClaims,
      analysis.experiments
    ]);
  }

  function composeMethod(analysis = {}) {
    return joinDistinct([
      analysis.method,
      analysis.methodSupportsProblem
    ]);
  }

  function composeContributions(analysis = {}) {
    return joinDistinct([
      analysis.contributions,
      analysis.innovation ? `Innovation: ${analysis.innovation}` : "",
      analysis.logicReview ? `Scope and evidence: ${analysis.logicReview}` : ""
    ]);
  }

  function joinDistinct(values) {
    const seen = new Set();
    return values.map(clean).filter((value) => {
      if (!value) return false;
      const key = value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).join(" ");
  }

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  return { composeResults, composeMethod, composeContributions, joinDistinct };
});
