(function exposeArxivClient(global) {
  global.PaperApi ||= {};
  global.PaperApi.loadArxivSource = async function loadArxivSource(idOrUrl) {
    const response = await fetch("/api/arxiv-source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idOrUrl })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "arXiv source extraction failed.");
    return payload;
  };

  global.PaperApi.resolveArxivByTitle = async function resolveArxivByTitle(title) {
    const response = await fetch("/api/arxiv-resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "arXiv title lookup failed.");
    return payload.match || null;
  };
})(window);
