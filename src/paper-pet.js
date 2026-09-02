(function exposePaperPet(global) {
  const STAGE_COPY = {
    planning: "我先把论文拆成几个阅读任务。",
    context: "正在挑选和当前任务最相关的章节。",
    analysis: "正在理解方法、公式和实验结果。",
    verification: "正在核对结论有没有原文证据。",
    reporting: "内容确认完毕，正在排版海报。"
  };

  function createPaperPet({ root, onPdfDrop }) {
    if (!root) return createNoopPet();
    const bubble = root.querySelector(".paper-pet-bubble");
    const message = root.querySelector("[data-pet-message]");
    const mouth = root.querySelector("[data-pet-mouth]");
    const character = root.querySelector("[data-pet-drag-handle]");
    const toggle = root.querySelector("[data-pet-toggle]");
    let state = "idle";
    let drag = null;
    let fileDragDepth = 0;

    function toggleBubble(force) {
      const show = typeof force === "boolean" ? force : bubble.hidden;
      bubble.hidden = !show;
      toggle.setAttribute("aria-expanded", String(show));
    }

    function speak(text, nextState = state) {
      if (text) message.textContent = String(text).replace(/\s+/g, " ").trim();
      state = nextState;
      root.dataset.state = state;
      bubble.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
    }

    function setStage(stage, detail) {
      speak(STAGE_COPY[stage] || detail || "正在认真阅读论文。", stage === "reporting" ? "building" : "thinking");
      root.dataset.stage = stage || "";
    }

    function announce(text, status) {
      if (!text) return;
      const nextState = status === "error" ? "error" : status === "success" ? "done" : status === "loading" ? "thinking" : state;
      speak(friendlyStatus(text), nextState);
    }

    toggle.addEventListener("click", () => {
      toggleBubble(false);
    });

    character.addEventListener("dragenter", (event) => {
      event.preventDefault();
      fileDragDepth += 1;
      root.classList.add("is-fed-target");
      speak("闻到 PDF 的味道了，放进来吧。", "hungry");
    });
    character.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    });
    character.addEventListener("dragleave", () => {
      fileDragDepth = Math.max(0, fileDragDepth - 1);
      if (fileDragDepth > 0) return;
      root.classList.remove("is-fed-target");
    });
    character.addEventListener("drop", async (event) => {
      event.preventDefault();
      fileDragDepth = 0;
      root.classList.remove("is-fed-target");
      const file = [...(event.dataTransfer?.files || [])].find((item) => item.type === "application/pdf" || /\.pdf$/i.test(item.name));
      if (!file) {
        speak("这个不是 PDF，我只会认真吃论文。", "error");
        return;
      }
      speak(`收到《${file.name.replace(/\.pdf$/i, "")}》，正在咀嚼页面。`, "chewing");
      await new Promise((resolve) => setTimeout(resolve, 850));
      try {
        await onPdfDrop(file);
      } catch (error) {
        speak(error?.message || "这篇论文有点难咬，请再试一次。", "error");
      }
    });

    character.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (event.target === mouth || mouth.contains(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      const shouldMoveDesktopWindow = global.DesktopPet?.isDesktop
        && document.documentElement.classList.contains("desktop-pet-mode");
      if (shouldMoveDesktopWindow) {
        drag = { desktop: true, x: event.clientX, y: event.clientY, moved: false };
        character.setPointerCapture(event.pointerId);
        root.classList.add("is-moving");
        global.DesktopPet.startDrag();
        return;
      }
      drag = { x: event.clientX, y: event.clientY, left: root.offsetLeft, top: root.offsetTop, moved: false };
      character.setPointerCapture(event.pointerId);
      root.classList.add("is-moving");
    });
    character.addEventListener("pointermove", (event) => {
      if (!drag) return;
      event.preventDefault();
      event.stopPropagation();
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (drag.desktop) {
        global.DesktopPet.moveDrag();
        return;
      }
      const maxLeft = Math.max(8, global.innerWidth - root.offsetWidth - 8);
      const maxTop = Math.max(8, global.innerHeight - root.offsetHeight - 8);
      root.style.left = `${Math.min(maxLeft, Math.max(8, drag.left + dx))}px`;
      root.style.top = `${Math.min(maxTop, Math.max(8, drag.top + dy))}px`;
      root.style.right = "auto";
      root.style.bottom = "auto";
    });
    function finishDrag(event, { cancelled = false } = {}) {
      if (!drag) return;
      event?.preventDefault();
      event?.stopPropagation();
      const wasMoved = drag.moved;
      const wasDesktopDrag = drag.desktop;
      drag = null;
      if (event && character.hasPointerCapture(event.pointerId)) {
        character.releasePointerCapture(event.pointerId);
      }
      root.classList.remove("is-moving");
      if (wasDesktopDrag) global.DesktopPet.endDrag();
      if (!cancelled && !wasMoved) toggleBubble();
    }

    character.addEventListener("pointerup", (event) => finishDrag(event));
    character.addEventListener("pointercancel", (event) => finishDrag(event, { cancelled: true }));
    character.addEventListener("lostpointercapture", (event) => finishDrag(event, { cancelled: true }));

    global.addEventListener("paper-agent-pet-opened", () => {
      root.style.removeProperty("left");
      root.style.removeProperty("top");
      root.style.removeProperty("right");
      root.style.removeProperty("bottom");
    });

    return {
      speak,
      announce,
      setStage,
      complete() { speak("海报做好啦，我已经把重点都摆整齐了。", "done"); },
      fail(text) { speak(text || "分析没有完成，我保留了可以继续处理的内容。", "error"); },
      reset() { delete root.dataset.stage; speak("今天读哪篇论文？", "idle"); }
    };
  }

  function friendlyStatus(text) {
    const value = String(text || "");
    let match = value.match(/Parsing PDF: page (\d+) \/ (\d+)/i);
    if (match) return `正在咀嚼第 ${match[1]} / ${match[2]} 页。`;
    match = value.match(/Extracting PDF artwork: page (\d+)/i);
    if (match) return `正在把第 ${match[1]} 页的图表完整取出来。`;
    match = value.match(/^Reading (.+)\.\.\.$/i);
    if (match) return `开始阅读《${match[1].replace(/\.pdf$/i, "")}》。`;
    match = value.match(/Detected arXiv:([^\.\s]+)/i);
    if (match) return `认出了 arXiv:${match[1]}，正在寻找更准确的公式和原图。`;
    if (/Agent selected tools/i.test(value)) return "阅读计划准备好了，开始逐项分析。";
    if (/rendering verified poster assets/i.test(value)) return "核对完成，正在把重点排进海报。";
    if (/analysis complete/i.test(value)) return "论文读完了，海报也整理好了。";
    if (/Extracted \d+ pages/i.test(value)) return "论文已经咀嚼完毕，准备开始深度分析。";
    if (/^Ready\. Client/i.test(value)) return "今天读哪篇论文？";
    if (/^Upload a PDF/i.test(value)) return "我准备好了，给我一篇论文吧。";
    return value;
  }

  function createNoopPet() {
    return new Proxy({}, { get: () => () => {} });
  }

  global.PaperPet = { create: createPaperPet };
})(window);
