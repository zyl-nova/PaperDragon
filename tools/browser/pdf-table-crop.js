(function registerPdfTableCropDefinition(global) {
  global.PaperToolDefinitions ||= {};
  global.PaperToolDefinitions.pdfTableCrop = (deps) => {
    const documents = new Map();

    async function getPdfDocument(url) {
      if (!documents.has(url)) {
        const loading = (async () => {
          const pdfjsLib = await deps.waitForPdfJs();
          pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
          const controller = new AbortController();
          const timeoutMs = String(url).includes("/api/arxiv-pdf") ? 18000 : 30000;
          const timeout = setTimeout(() => controller.abort(), timeoutMs);
          let response;
          try {
            response = await fetch(url, { signal: controller.signal });
          } catch (error) {
            if (error.name === "AbortError") throw new Error(`paper PDF request timed out after ${Math.round(timeoutMs / 1000)} seconds`);
            throw error;
          } finally {
            clearTimeout(timeout);
          }
          if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error || `paper PDF request failed (${response.status})`);
          }
          return await pdfjsLib.getDocument({ data: await response.arrayBuffer() }).promise;
        })();
        loading.catch(() => documents.delete(url));
        documents.set(url, loading);
      }
      return await documents.get(url);
    }

    async function renderTableCrop(url, tableNumber) {
      const pdf = await getPdfDocument(url);
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1 });
        const lines = global.PaperToolAlgorithms.groupPdfTextItems(content.items, viewport);
        for (const markerIndex of findTableMarkers(lines, tableNumber)) {
          const rendered = await cropTableFromPage(page, lines, markerIndex);
          if (rendered) return rendered;
        }
      }
      throw new Error(`Table ${tableNumber} was mentioned, but no complete table structure could be verified in the paper PDF`);
    }

    function findTableMarkers(items, tableNumber) {
      const target = String(tableNumber);
      const captionPattern = new RegExp(`^Table\\s*${target}\\s*[:.\\-]`, "i");
      const matches = [];
      for (let index = 0; index < items.length; index += 1) {
        const text = String(items[index].text || items[index].str || "").trim();
        if (captionPattern.test(text)) {
          matches.push(index);
          continue;
        }
        if (!/^Table$/i.test(text)) continue;
        const nearby = items.slice(index, index + 4).map((item) => String(item.text || item.str || "").trim()).join(" ");
        if (captionPattern.test(nearby)) matches.push(index);
      }
      return matches;
    }

    async function cropTableFromPage(page, lines, markerIndex) {
      const baseViewport = page.getViewport({ scale: 1 });
      let region = global.PaperToolAlgorithms.computePdfVisualRegion(lines, markerIndex, "table", baseViewport);
      if (!region) return "";
      region = { ...region, kind: "table", pageNumber: page.pageNumber, caption: lines[markerIndex]?.text || "" };
      region = global.PaperToolAlgorithms.stabilizePdfAssetRegion(region, baseViewport, "table");
      const scale = 3;
      const viewport = page.getViewport({ scale });
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = Math.ceil(viewport.width);
      pageCanvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: pageCanvas.getContext("2d"), viewport }).promise;
      region = await global.PaperToolAlgorithms.refinePdfRegionWithVision(pageCanvas, region, scale, deps);
      const crop = global.PaperToolAlgorithms.cropPdfAssetRegion(pageCanvas, region, scale);
      if (!crop.complete) {
        throw new Error(`Table ${tableNumber} remains clipped at ${crop.clippedEdges.join(", ")} after three repairs`);
      }
      return crop.url;
    }

    return {
      name: "pdf.table-crop",
      description: "Crop a table from the original PDF",
      stage: "reporting",
      runtime: "browser",
      inputTypes: ["arxiv"],
      run: ({ url, tableNumber }) => renderTableCrop(url, tableNumber),
      summarize: (_, inputValue) => `Table ${inputValue.tableNumber} crop rendered.`
    };
  };
})(window);
