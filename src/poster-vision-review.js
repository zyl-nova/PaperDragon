(function initPosterVisionReview(global, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (global) global.PosterVisionReview = api;
})(typeof window !== "undefined" ? window : globalThis, function createPosterVisionReview() {
  const PANEL_IDS = ["problem", "motivation", "method", "theory", "visuals", "results", "contribution"];

  function mergeReviewHints(current = [], additions = []) {
    const merged = new Map((Array.isArray(current) ? current : []).map((hint) => [hint.panel, { ...hint }]));
    for (const hint of Array.isArray(additions) ? additions : []) {
      if (!PANEL_IDS.includes(hint?.panel)) continue;
      const previous = merged.get(hint.panel) || { panel: hint.panel, areaScale: 1, widthScale: 1, heightScale: 1 };
      merged.set(hint.panel, {
        panel: hint.panel,
        areaScale: clampScale(previous.areaScale * numberOrOne(hint.areaScale)),
        widthScale: clampScale(previous.widthScale * numberOrOne(hint.widthScale)),
        heightScale: clampScale(previous.heightScale * numberOrOne(hint.heightScale)),
        reason: String(hint.reason || previous.reason || "").slice(0, 180)
      });
    }
    return [...merged.values()];
  }

  function readReviewHints(root) {
    try {
      const value = JSON.parse(root?.dataset?.reviewLayoutHints || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function applyVisualReview(root, review) {
    if (!root || !review) return;
    const hints = mergeReviewHints(readReviewHints(root), review.layoutAdjustments);
    root.dataset.reviewLayoutHints = JSON.stringify(hints);
    root.dataset.visualReviewScore = String(Math.round(Number(review.overallScore) || 0));

    const style = review.styleAdjustments || {};
    const bodyScale = cumulativeScale(root, "reviewBodyScale", style.bodyFontScale);
    const headingScale = cumulativeScale(root, "reviewHeadingScale", style.headingScale);
    const mediaScale = cumulativeScale(root, "reviewMediaScale", style.mediaScale);
    root.style.setProperty("--poster-review-body-size", `${Math.round(12 * bodyScale * 10) / 10}px`);
    root.style.setProperty("--poster-review-heading-size", `${Math.round(14 * headingScale * 10) / 10}px`);
    root.style.setProperty("--poster-review-media-scale", String(mediaScale));
    root.style.setProperty("--poster-review-media-max-height", `${Math.round(300 * mediaScale)}px`);
    root.classList.toggle("poster-review-contrast", style.contrast === "increase" || root.classList.contains("poster-review-contrast"));
  }

  async function createPosterReviewSnapshot(sourceRoot, dependencies) {
    const { preparePosterForExport, refinePosterLayout } = dependencies;
    const clone = sourceRoot.cloneNode(true);
    preparePosterForExport(clone);
    clone.classList.add("poster-calibration", "poster-review-capture");
    const hadStandaloneClass = document.body.classList.contains("standalone-poster");
    document.body.classList.add("standalone-poster");
    document.body.append(clone);
    try {
      await waitForImages(clone);
      refinePosterLayout(clone, { iterations: 3, reviewHints: readReviewHints(sourceRoot) });
      await nextFrame();
      const metrics = collectPosterMetrics(clone);
      await inlineImages(clone);
      const imageDataUrl = await rasterizePoster(clone);
      return { imageDataUrl, metrics };
    } finally {
      clone.remove();
      if (!hadStandaloneClass) document.body.classList.remove("standalone-poster");
    }
  }

  function collectPosterMetrics(root) {
    const rootRect = root.getBoundingClientRect();
    const panels = {};
    for (const id of PANEL_IDS) {
      const panel = root.querySelector(`[data-poster-section="${id}"]`);
      if (!panel) continue;
      const rect = panel.getBoundingClientRect();
      const style = getComputedStyle(panel);
      const images = [...panel.querySelectorAll("img")].map((image) => {
        const imageRect = image.getBoundingClientRect();
        return { width: Math.round(imageRect.width), height: Math.round(imageRect.height) };
      });
      panels[id] = {
        x: Math.round(rect.left - rootRect.left),
        y: Math.round(rect.top - rootRect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        scrollWidth: panel.scrollWidth,
        scrollHeight: panel.scrollHeight,
        overflowX: panel.scrollWidth > panel.clientWidth + 2,
        overflowY: panel.scrollHeight > panel.clientHeight + 2,
        textChars: panel.textContent.replace(/\s+/g, " ").trim().length,
        bodyFontPx: Number.parseFloat(style.fontSize) || 0,
        images
      };
    }
    return {
      poster: {
        width: Math.round(rootRect.width),
        height: Math.round(rootRect.height),
        aspect: Number(root.style.getPropertyValue("--poster-layout-aspect")) || 0
      },
      panels
    };
  }

  async function rasterizePoster(root) {
    const rect = root.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const renderer = globalThis.html2canvas;
    if (typeof renderer !== "function") throw new Error("Poster screenshot renderer is unavailable. Reload the page and try again.");
    const previous = {
      left: root.style.left,
      top: root.style.top,
      zIndex: root.style.zIndex,
      visibility: root.style.visibility
    };
    root.style.left = "0";
    root.style.top = "0";
    root.style.zIndex = "-1000";
    root.style.visibility = "visible";
    try {
      const canvas = await renderer(root, {
        backgroundColor: "#ffffff",
        scale: 1,
        useCORS: true,
        allowTaint: false,
        logging: false,
        width,
        height,
        windowWidth: width,
        windowHeight: height,
        scrollX: 0,
        scrollY: 0
      });
      return canvas.toDataURL("image/jpeg", 0.92);
    } finally {
      root.style.left = previous.left;
      root.style.top = previous.top;
      root.style.zIndex = previous.zIndex;
      root.style.visibility = previous.visibility;
    }
  }

  async function inlineImages(root) {
    await Promise.all([...root.querySelectorAll("img")].map(async (image) => {
      const source = image.currentSrc || image.src;
      if (!source || source.startsWith("data:")) return;
      try {
        const response = await fetch(source);
        if (!response.ok) return;
        image.src = await blobToDataUrl(await response.blob());
      } catch {
        // Keep the already-rendered image when inlining is blocked.
      }
    }));
  }

  function waitForImages(root) {
    return Promise.all([...root.querySelectorAll("img")].map((image) => {
      if (image.complete) return Promise.resolve();
      return new Promise((resolve) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
        setTimeout(resolve, 5000);
      });
    }));
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function cumulativeScale(root, key, incoming) {
    const previous = numberOrOne(root.dataset[key]);
    const next = Math.max(0.9, Math.min(1.25, previous * numberOrOne(incoming)));
    root.dataset[key] = String(next);
    return next;
  }

  function numberOrOne(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 1;
  }

  function clampScale(value) {
    return Math.max(0.8, Math.min(1.35, numberOrOne(value)));
  }

  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  return { createPosterReviewSnapshot, collectPosterMetrics, applyVisualReview, mergeReviewHints, readReviewHints };
});
