(function registerPaperSourceIdentity(global, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (global) global.PaperSourceIdentity = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis, () => {
  function cleanTitle(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/\b((?:19|20)\d{2})([A-Z][a-z]{2,})/g, "$1 $2")
      .replace(/\s+(?:abstract|introduction|keywords?)\s*$/i, "")
      .trim();
  }

  function titleKey(value) {
    return cleanTitle(value).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  }

  function titlesAgree(left, right) {
    const a = titleKey(left);
    const b = titleKey(right);
    if (!a || !b) return true;
    if (a === b) return true;
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length > b.length ? a : b;
    return shorter.length >= longer.length * 0.88 && longer.includes(shorter);
  }

  function titleFromText(text) {
    const heading = String(text || "").split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => /^#\s+\S/.test(line));
    return cleanTitle(heading?.replace(/^#\s+/, "") || "");
  }

  function firstPageText(text) {
    const source = String(text || "");
    const pageOne = source.match(/##\s+Page\s+1\s*([\s\S]*?)(?=\n##\s+Page\s+2\b|$)/i);
    return pageOne ? pageOne[1] : source.slice(0, 12000);
  }

  function cleanDoi(value) {
    const match = String(value || "").match(/(?:https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/[A-Z0-9][A-Z0-9._;()/:+-]*)/i);
    const doi = match ? match[1].replace(/[.,;:)}\]]+$/g, "") : "";
    return isPlaceholderDoi(doi) ? "" : doi;
  }

  function isPlaceholderDoi(value) {
    const suffix = String(value || "").toLowerCase().split("/").slice(1).join("/");
    return !suffix
      || /(?:^|[._/()-])(?:n{4,}|x{4,}|tbd|todo|placeholder)(?:$|[._/()-])/i.test(suffix)
      || /(?:n{6,}|x{6,})/i.test(suffix);
  }

  function detectFirstPageDoi(text) {
    return cleanDoi(firstPageText(text));
  }

  function normalizeArxivId(value) {
    return String(value || "").trim().replace(/^arxiv:\s*/i, "");
  }

  function hashText(value) {
    const normalized = String(value || "").replace(/\s+/g, " ").trim().slice(0, 50000);
    let hash = 2166136261;
    for (let index = 0; index < normalized.length; index += 1) {
      hash ^= normalized.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${(hash >>> 0).toString(16).padStart(8, "0")}:${normalized.length}`;
  }

  function canonicalText(preferredText, fallbackText = "") {
    return String(preferredText || "").trim()
      ? String(preferredText)
      : String(fallbackText || "");
  }

  function create(sourceProfile = {}, text = "") {
    const sourceType = String(sourceProfile.sourceType || "text");
    const profileTitle = cleanTitle(sourceProfile.title);
    const textTitle = titleFromText(text);
    const profileDoi = cleanDoi(sourceProfile.doi || sourceProfile.paperUrl);
    const textDoi = sourceType === "pdf" ? detectFirstPageDoi(text) : "";
    const arxivId = normalizeArxivId(sourceProfile.arxivId || sourceProfile.detectedArxivId);
    const conflicts = [];
    if (profileTitle && textTitle && !titlesAgree(profileTitle, textTitle)) conflicts.push("title");
    if (profileDoi && textDoi && profileDoi.toLowerCase() !== textDoi.toLowerCase()) conflicts.push("doi");
    const title = profileTitle || textTitle;
    const doi = textDoi || profileDoi;
    const paperUrl = doi
      ? `https://doi.org/${doi}`
      : arxivId ? `https://arxiv.org/abs/${arxivId}` : "";
    const contentHash = hashText(text);
    const key = doi ? `doi:${doi.toLowerCase()}` : arxivId ? `arxiv:${arxivId.toLowerCase()}` : `text:${contentHash}`;
    const sourceLines = Array.isArray(sourceProfile.titleLines) ? sourceProfile.titleLines.map(cleanTitle).filter(Boolean) : [];
    return {
      key,
      contentHash,
      title,
      titleLines: sourceLines.length > 1 && titlesAgree(sourceLines.join(" "), title) ? sourceLines : [],
      doi,
      paperUrl,
      arxivId,
      fileName: String(sourceProfile.fileName || sourceProfile.uploadedFileName || ""),
      sourceType,
      consistent: conflicts.length === 0,
      conflicts
    };
  }

  function reconcile(sourceProfile = {}, text = "") {
    const initial = create(sourceProfile, text);
    if (initial.consistent) return { ...initial, repaired: false, repairedFields: [] };

    const repairedProfile = { ...sourceProfile };
    const repairedFields = [];
    if (initial.conflicts.includes("title")) {
      const extractedTitle = titleFromText(text);
      if (extractedTitle) {
        repairedProfile.title = extractedTitle;
        repairedProfile.titleLines = [];
        repairedFields.push("title");
      }
    }
    if (initial.conflicts.includes("doi") && String(sourceProfile.sourceType || "text") === "pdf") {
      const extractedDoi = detectFirstPageDoi(text);
      if (extractedDoi) {
        repairedProfile.doi = extractedDoi;
        repairedProfile.paperUrl = `https://doi.org/${extractedDoi}`;
        repairedFields.push("doi");
      }
    }

    const repaired = create(repairedProfile, text);
    return {
      ...repaired,
      repaired: repaired.consistent && repairedFields.length > 0,
      repairedFields
    };
  }

  function enrichmentMatches(sourceProfile = {}, payload = {}, text = "") {
    const currentTitle = cleanTitle(sourceProfile.title);
    const candidateTitle = cleanTitle(payload.title) || titleFromText(text);
    if (currentTitle && candidateTitle && !titlesAgree(currentTitle, candidateTitle)) return false;

    const currentArxivId = normalizeArxivId(sourceProfile.arxivId || sourceProfile.detectedArxivId).toLowerCase().replace(/v\d+$/, "");
    const candidateArxivId = normalizeArxivId(payload.id || payload.arxivId).toLowerCase().replace(/v\d+$/, "");
    return !(currentArxivId && candidateArxivId && currentArxivId !== candidateArxivId);
  }

  function matches(left, right) {
    return Boolean(left && right
      && left.key === right.key
      && left.contentHash === right.contentHash
      && titlesAgree(left.title, right.title)
      && String(left.paperUrl || "") === String(right.paperUrl || ""));
  }

  function assertConsistent(identity, message = "Paper identity is inconsistent.") {
    if (!identity?.consistent) {
      const detail = identity?.conflicts?.join(" and ") || "source";
      throw new Error(`${message} Conflicting ${detail} metadata was detected; reload the PDF before generating.`);
    }
    return identity;
  }

  return { create, reconcile, enrichmentMatches, matches, assertConsistent, canonicalText, cleanTitle, cleanDoi, isPlaceholderDoi, titleFromText, titlesAgree, hashText };
});
