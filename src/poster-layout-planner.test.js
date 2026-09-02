const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  planPanels,
  estimateHeightFromSamples,
  estimateAspectFromSamples,
  estimateReadableFigureFloor,
  applyReviewHints,
  findClippedPanelIds,
  findSeverelyClippedPanelIds,
  standaloneGuardScript
} = require("./poster-layout-planner.js");

function area(rect) {
  return rect.w * rect.h;
}

test("content completeness gate detects horizontal and vertical clipping", () => {
  const panels = [
    { hidden: false, clientWidth: 400, scrollWidth: 400, clientHeight: 180, scrollHeight: 181, dataset: { posterSection: "method" } },
    { hidden: false, clientWidth: 400, scrollWidth: 421, clientHeight: 180, scrollHeight: 180, dataset: { posterSection: "results" } },
    { hidden: false, clientWidth: 400, scrollWidth: 400, clientHeight: 180, scrollHeight: 220, dataset: { posterSection: "contribution" } }
  ];
  const root = { querySelectorAll: () => panels };
  assert.deepEqual(findClippedPanelIds(root), ["results", "contribution"]);
});

test("content completeness gate tolerates small decorative connector overflow", () => {
  const panel = {
    hidden: false,
    clientWidth: 400,
    scrollWidth: 410,
    clientHeight: 180,
    scrollHeight: 180,
    dataset: { posterSection: "theory" }
  };
  assert.deepEqual(findClippedPanelIds({ querySelectorAll: () => [panel] }), []);
});

test("content completeness gate ignores subpixel and border-height overflow", () => {
  const panel = {
    hidden: false,
    clientWidth: 400,
    scrollWidth: 400,
    clientHeight: 180,
    scrollHeight: 186,
    dataset: { posterSection: "method" },
    getBoundingClientRect: () => ({ top: 0, bottom: 180 }),
    querySelectorAll: () => []
  };

  assert.deepEqual(findClippedPanelIds({ querySelectorAll: () => [panel] }), []);
});

test("content completeness gate detects visual descendants clipped by hidden overflow", () => {
  const panel = {
    hidden: false,
    clientWidth: 400,
    scrollWidth: 400,
    clientHeight: 180,
    scrollHeight: 180,
    dataset: { posterSection: "contribution" },
    getBoundingClientRect: () => ({ top: 0, bottom: 180 }),
    querySelectorAll: () => [{
      tagName: "LI",
      getClientRects: () => [1],
      getBoundingClientRect: () => ({ height: 24, bottom: 190 })
    }]
  };
  assert.deepEqual(findClippedPanelIds({ querySelectorAll: () => [panel] }), ["contribution"]);
});

test("fallback gate distinguishes small layout noise from real content overflow", () => {
  const panels = [
    { hidden: false, clientWidth: 400, scrollWidth: 416, clientHeight: 180, scrollHeight: 192, dataset: { posterSection: "theory" } },
    { hidden: false, clientWidth: 400, scrollWidth: 400, clientHeight: 180, scrollHeight: 224, dataset: { posterSection: "results" } }
  ];

  assert.deepEqual(findSeverelyClippedPanelIds({ querySelectorAll: () => panels }), ["results"]);
});

test("standalone layout guard remains executable and responds to resize and font loading", () => {
  const source = standaloneGuardScript();
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /content-safe-grid/);
  assert.match(source, /layoutRepaired/);
  assert.ok(source.indexOf("layoutRepaired") < source.indexOf('root.dataset.layout = "content-safe-grid"'));
  assert.match(source, /addEventListener\("resize"/);
  assert.match(source, /document\.fonts/);
  assert.match(source, /contentBottom < 97/);
  assert.match(source, /layoutCompacted/);
  assert.match(source, /layoutEngine !== "measured-masonry-v3"/);
  assert.match(source, /Math\.max\(0\.78, aspect \* scale\)/);
  assert.ok(source.indexOf('root.dataset.layout = "adaptive-tree"') < source.indexOf("const panels"));
});

test("dynamic poster states override the generic medium-width responsive grid", () => {
  const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  const mediumGrid = css.lastIndexOf("@media (min-width: 641px) and (max-width: 1639px)");
  const adaptiveState = css.lastIndexOf('.poster-export[data-layout="adaptive-tree"] .poster-grid');
  const fallbackState = css.lastIndexOf('.poster-export[data-layout="content-safe-grid"] .poster-grid');

  assert.ok(mediumGrid >= 0);
  assert.ok(adaptiveState > mediumGrid);
  assert.ok(fallbackState > mediumGrid);
  assert.match(css.slice(adaptiveState), /grid-template-columns: none/);
});

test("adaptive poster layout gives larger content more area without gaps", () => {
  const plan = planPanels([
    { id: "problem", weight: 1, aspect: 1.2 },
    { id: "method", weight: 2, aspect: 1.7 },
    { id: "visuals", weight: 5, aspect: 2.3 },
    { id: "results", weight: 2, aspect: 1.0 }
  ]);
  const byId = Object.fromEntries(plan.panels.map((panel) => [panel.id, panel.rect]));

  assert.ok(area(byId.visuals) > area(byId.method));
  assert.ok(area(byId.method) > area(byId.problem));
  const totalArea = plan.panels.reduce((sum, panel) => sum + area(panel.rect), 0);
  assert.ok(Math.abs(totalArea - (1 / plan.aspect)) < 1e-9);
});

test("adaptive poster layout preserves reading order and valid bounds", () => {
  const plan = planPanels([
    { id: "quality", weight: 1, aspect: 1.4 },
    { id: "problem", weight: 1, aspect: 1.2 },
    { id: "visuals", weight: 4, aspect: 2.4 },
    { id: "method", weight: 2, aspect: 1.6 }
  ]);

  assert.deepEqual(plan.panels.map((panel) => panel.id), ["problem", "method", "visuals", "quality"]);
  for (const { rect } of plan.panels) {
    assert.ok(rect.x >= 0 && rect.y >= 0);
    assert.ok(rect.x + rect.w <= 1 + 1e-9);
    assert.ok(rect.y + rect.h <= (1 / plan.aspect) + 1e-9);
  }
});

test("academic text panels do not become full-height narrow sidebars", () => {
  const plan = planPanels([
    { id: "problem", weight: 2.36, aspect: 1.35 },
    { id: "method", weight: 3.44, aspect: 1.75 },
    { id: "theory", weight: 6.84, aspect: 1.05 },
    { id: "visuals", weight: 8, aspect: 2.25 },
    { id: "results", weight: 7.2, aspect: 1.05 },
    { id: "contribution", weight: 2, aspect: 1.5 }
  ]);

  for (const { rect } of plan.panels) {
    assert.ok(rect.w / rect.h >= 0.62);
    assert.ok(!(rect.h > 0.42 && rect.w < 0.24));
  }
});

test("rich posters may use a taller canvas instead of squeezing the problem into a sidebar", () => {
  const samples = (height) => [
    { width: 420, height: height * 1.25 },
    { width: 760, height },
    { width: 1120, height: height * 0.84 },
    { width: 1560, height: height * 0.74 }
  ];
  const features = [
    { id: "problem", weight: 2, aspect: 2.8, minWidth: 0.26, minHeight: 0.12, sizeSamples: samples(230) },
    { id: "method", weight: 6, aspect: 1.25, minWidth: 0.4, minHeight: 0.3, images: 1, sizeSamples: samples(700) },
    { id: "theory", weight: 2, aspect: 2.4, minWidth: 0.26, minHeight: 0.12, sizeSamples: samples(190) },
    { id: "results", weight: 7, aspect: 1.15, minWidth: 0.42, minHeight: 0.3, tableFigures: 2, sizeSamples: samples(760) },
    { id: "contribution", weight: 1, aspect: 5, minWidth: 0.28, minHeight: 0.08, sizeSamples: samples(120) }
  ];
  const plan = planPanels(features);
  const byId = Object.fromEntries(plan.panels.map((panel) => [panel.id, panel.rect]));

  assert.ok(byId.problem.w >= 0.26);
  assert.ok(byId.method.w >= 0.4);
  assert.ok(byId.results.w >= 0.42);
  assert.ok(plan.aspect <= 1.6);
});

test("a primary results table receives enough width and height to remain legible", () => {
  const plan = planPanels([
    { id: "problem", weight: 2.2, aspect: 1.35 },
    { id: "method", weight: 3.4, aspect: 1.75 },
    { id: "theory", weight: 4.8, aspect: 1.1 },
    { id: "visuals", weight: 6.5, aspect: 2.4 },
    { id: "results", weight: 8.8, aspect: 1.9, minWidth: 0.42, minHeight: 0.2 },
    { id: "contribution", weight: 2, aspect: 1.5 }
  ]);
  const results = plan.panels.find((panel) => panel.id === "results").rect;

  assert.ok(results.w >= 0.42);
  assert.ok(results.h >= 0.2);
});

test("a short contribution summary uses measured space without violating its minimum size", () => {
  const plan = planPanels([
    { id: "problem", weight: 3.8, aspect: 1.35, minWidth: 0.16, minHeight: 0.18, sizeSamples: [{ width: 560, height: 220 }] },
    { id: "method", weight: 2.8, aspect: 1.75, minWidth: 0.16, minHeight: 0.13, sizeSamples: [{ width: 560, height: 160 }] },
    { id: "theory", weight: 5, aspect: 1.1, minWidth: 0.24, minHeight: 0.2, sizeSamples: [{ width: 560, height: 310 }] },
    { id: "visuals", weight: 7, aspect: 1.4, minWidth: 0.34, minHeight: 0.24, sizeSamples: [{ width: 560, height: 480 }] },
    { id: "results", weight: 6, aspect: 1.9, minWidth: 0.42, minHeight: 0.22, sizeSamples: [{ width: 560, height: 320 }] },
    { id: "contribution", weight: 1.2, aspect: 4.2, minWidth: 0.28, minHeight: 0.11, sizeSamples: [{ width: 560, height: 115 }] }
  ]);
  const byId = Object.fromEntries(plan.panels.map((panel) => [panel.id, panel.rect]));

  assert.ok(byId.contribution.w >= 0.28);
  assert.ok(byId.contribution.h >= 0.11);
  assert.equal(byId.contribution.w, 1);
  const bodyBottom = Math.max(
    ...Object.entries(byId)
      .filter(([id]) => !["problem", "contribution"].includes(id))
      .map(([, rect]) => rect.y + rect.h)
  );
  assert.ok(Math.abs(byId.contribution.y - bodyBottom) < 1e-9);
  const totalArea = plan.panels.reduce((sum, panel) => sum + area(panel.rect), 0);
  assert.ok(totalArea <= (1 / plan.aspect) + 1e-9);
  assert.ok(totalArea >= (1 / plan.aspect) * 0.65);
});

test("a repaired contribution keeps its content constraints without forcing a fixed band", () => {
  const plan = planPanels([
    { id: "problem", weight: 3, aspect: 1.4, minWidth: 0.16, minHeight: 0.15, sizeSamples: [{ width: 760, height: 150 }] },
    { id: "method", weight: 4, aspect: 1.8, minWidth: 0.24, minHeight: 0.2, sizeSamples: [{ width: 760, height: 220 }] },
    { id: "theory", weight: 5, aspect: 1.1, minWidth: 0.24, minHeight: 0.25, sizeSamples: [{ width: 760, height: 330 }] },
    { id: "results", weight: 8, aspect: 1.2, minWidth: 0.42, minHeight: 0.25, sizeSamples: [{ width: 760, height: 510 }] },
    { id: "contribution", weight: 8, aspect: 4.2, minWidth: 0.28, minHeight: 0.095, sizeSamples: [{ width: 560, height: 130 }, { width: 760, height: 105 }] }
  ], { aspect: 1.05 });
  const contribution = plan.panels.find((panel) => panel.id === "contribution").rect;

  assert.ok(contribution.w >= 0.28);
  assert.ok(contribution.h >= 0.095);
});

test("short summaries stay compact when full-width bands would create column waste", () => {
  const plan = planPanels([
    { id: "problem", weight: 2.5, aspect: 5.5, minWidth: 0.16, minHeight: 0.09, sizeSamples: [{ width: 560, height: 190 }, { width: 760, height: 150 }] },
    { id: "method", weight: 6, aspect: 0.9, minWidth: 0.24, minHeight: 0.25, sizeSamples: [{ width: 560, height: 700 }] },
    { id: "theory", weight: 6, aspect: 0.9, minWidth: 0.24, minHeight: 0.25, sizeSamples: [{ width: 560, height: 650 }] },
    { id: "results", weight: 6, aspect: 0.9, minWidth: 0.24, minHeight: 0.25, sizeSamples: [{ width: 560, height: 620 }] },
    { id: "contribution", weight: 1.4, aspect: 6, minWidth: 0.28, minHeight: 0.085, sizeSamples: [{ width: 560, height: 125 }, { width: 760, height: 105 }] }
  ]);
  const byId = Object.fromEntries(plan.panels.map((panel) => [panel.id, panel.rect]));

  assert.ok(byId.problem.w >= 0.16);
  assert.ok(byId.contribution.w >= 0.28);
  assert.ok(byId.problem.h <= 0.19);
  assert.ok(byId.contribution.h <= 0.16);
  assert.ok(byId.method.h >= 0.25);
});

test("adaptive content layout may promote the problem while keeping other panels compact", () => {
  const samples = (height) => [
    { width: 420, height: height * 1.25 },
    { width: 760, height },
    { width: 1120, height: height * 0.82 },
    { width: 1560, height: height * 0.72 }
  ];
  const plan = planPanels([
    { id: "problem", weight: 1.2, aspect: 5, minWidth: 0.2, minHeight: 0.08, sizeSamples: samples(140) },
    { id: "method", weight: 4, aspect: 1.2, minWidth: 0.3, minHeight: 0.28, images: 1, sizeSamples: samples(520) },
    { id: "theory", weight: 2, aspect: 2.4, minWidth: 0.24, minHeight: 0.12, generatedDiagrams: 1, sizeSamples: samples(180) },
    { id: "results", weight: 5, aspect: 1.8, minWidth: 0.42, minHeight: 0.2, tableFigures: 1, sizeSamples: samples(350) },
    { id: "contribution", weight: 1, aspect: 6, minWidth: 0.2, minHeight: 0.075, sizeSamples: samples(115) }
  ]);
  const byId = Object.fromEntries(plan.panels.map((panel) => [panel.id, panel.rect]));
  const contentPanels = plan.panels.filter((panel) => panel.id !== "contribution");
  for (let first = 0; first < contentPanels.length; first += 1) {
    for (let second = first + 1; second < contentPanels.length; second += 1) {
      const a = contentPanels[first].rect;
      const b = contentPanels[second].rect;
      const overlaps = a.x < b.x + b.w - 1e-9 && a.x + a.w > b.x + 1e-9
        && a.y < b.y + b.h - 1e-9 && a.y + a.h > b.y + 1e-9;
      assert.equal(overlaps, false);
    }
  }
  assert.equal(byId.problem.y, 0);
  assert.ok(contentPanels.filter((panel) => panel.id !== "problem").every((panel) => panel.rect.w < 1));
  assert.ok(new Set(contentPanels.map((panel) => panel.rect.w.toFixed(4))).size >= 2);
  assert.ok(byId.method.w >= 0.3);
  assert.ok(byId.results.w >= 0.42);
  assert.ok(byId.theory.y <= byId.results.y + 1e-9);
  const contributionTop = byId.contribution.y;
  const contentBottom = Math.max(...contentPanels.map((panel) => panel.rect.y + panel.rect.h));
  assert.ok(Math.abs(contentBottom - contributionTop) < 1e-9);
});

test("measured columns also work when optional contribution content is absent", () => {
  const samples = (height) => [
    { width: 420, height: height * 1.28 },
    { width: 760, height },
    { width: 1120, height: height * 0.84 },
    { width: 1560, height: height * 0.76 }
  ];
  const features = [
    { id: "problem", weight: 1, aspect: 5, minWidth: 0.16, minHeight: 0.08, sizeSamples: samples(130) },
    { id: "method", weight: 4, aspect: 1.4, minWidth: 0.3, minHeight: 0.22, sizeSamples: samples(430) },
    { id: "theory", weight: 2, aspect: 2, minWidth: 0.24, minHeight: 0.12, sizeSamples: samples(190) },
    { id: "results", weight: 4, aspect: 1.6, minWidth: 0.42, minHeight: 0.2, sizeSamples: samples(360) }
  ];
  const plan = planPanels(features);
  const byId = Object.fromEntries(plan.panels.map((panel) => [panel.id, panel.rect]));
  const contentColumns = new Set(plan.panels.filter((panel) => panel.id !== "problem").map((panel) => panel.rect.x));

  assert.equal(contentColumns.size, 2);
  for (const feature of features) {
    assert.ok(byId[feature.id].w >= feature.minWidth - 1e-9);
    assert.ok(byId[feature.id].h >= feature.minHeight - 1e-9);
  }
});

test("a compact contribution may join an adaptive column when that reduces total height", () => {
  const samples = (height) => [
    { width: 420, height: height * 1.3 },
    { width: 760, height },
    { width: 1120, height: height * 0.82 },
    { width: 1560, height: height * 0.72 }
  ];
  const plan = planPanels([
    { id: "problem", weight: 1, aspect: 3, minWidth: 0.16, minHeight: 0.08, sizeSamples: samples(170) },
    { id: "method", weight: 7, aspect: 1, minWidth: 0.4, minHeight: 0.3, images: 2, sizeSamples: samples(850) },
    { id: "theory", weight: 2, aspect: 2, minWidth: 0.24, minHeight: 0.12, sizeSamples: samples(180) },
    { id: "results", weight: 4, aspect: 1.5, minWidth: 0.36, minHeight: 0.2, tableFigures: 1, sizeSamples: samples(420) },
    { id: "contribution", weight: 1, aspect: 3, minWidth: 0.28, minHeight: 0.08, sizeSamples: samples(120) }
  ]);
  const byId = Object.fromEntries(plan.panels.map((panel) => [panel.id, panel.rect]));
  assert.ok(byId.contribution.w < 1);
  assert.ok(byId.contribution.y >= byId.results.y);
  const contentBottom = Math.max(...plan.panels.map((panel) => panel.rect.y + panel.rect.h));
  assert.ok(Math.abs(byId.contribution.y + byId.contribution.h - contentBottom) < 1e-9);
});

test("column assignment follows measured height instead of fixed semantic pairings", () => {
  const samples = (height) => [
    { width: 420, height: height * 1.2 },
    { width: 760, height },
    { width: 1120, height: height * 0.85 },
    { width: 1560, height: height * 0.75 }
  ];
  const plan = planPanels([
    { id: "problem", weight: 1, aspect: 5, minWidth: 0.16, minHeight: 0.08, sizeSamples: samples(120) },
    { id: "method", weight: 2, aspect: 2, minWidth: 0.25, minHeight: 0.12, sizeSamples: samples(180) },
    { id: "theory", weight: 5, aspect: 1, minWidth: 0.25, minHeight: 0.3, sizeSamples: samples(620) },
    { id: "results", weight: 2, aspect: 2, minWidth: 0.35, minHeight: 0.12, sizeSamples: samples(180) },
    { id: "contribution", weight: 1, aspect: 6, minWidth: 0.28, minHeight: 0.075, sizeSamples: samples(100) }
  ]);
  const byId = Object.fromEntries(plan.panels.map((panel) => [panel.id, panel.rect]));

  assert.equal(byId.method.x, byId.results.x);
  assert.notEqual(byId.theory.x, byId.results.x);
  assert.equal(byId.contribution.w, 1);
});

test("content constraints remain satisfied across a complete rectangular poster", () => {
  const features = [
    { id: "problem", weight: 2.5, aspect: 1.35, minWidth: 0.16, minHeight: 0.15 },
    { id: "method", weight: 3.5, aspect: 1.75, minWidth: 0.24, minHeight: 0.2 },
    { id: "theory", weight: 4.5, aspect: 1.1, minWidth: 0.24, minHeight: 0.2 },
    { id: "visuals", weight: 6.5, aspect: 2.4, minWidth: 0.24, minHeight: 0.2 },
    { id: "results", weight: 9, aspect: 1.9, minWidth: 0.42, minHeight: 0.21 },
    { id: "contribution", weight: 2.2, aspect: 1.5, minWidth: 0.16, minHeight: 0.15 }
  ];
  const plan = planPanels(features);
  const byId = Object.fromEntries(plan.panels.map((panel) => [panel.id, panel.rect]));

  for (const feature of features) {
    assert.ok(byId[feature.id].w >= feature.minWidth - 1e-9, `${feature.id} width`);
    assert.ok(byId[feature.id].h >= feature.minHeight - 1e-9, `${feature.id} height`);
  }
});

test("sampled content height increases when a panel becomes narrower", () => {
  const samples = [
    { width: 280, height: 520 },
    { width: 420, height: 390 },
    { width: 560, height: 310 },
    { width: 760, height: 270 }
  ];

  assert.ok(estimateHeightFromSamples(samples, 320) > estimateHeightFromSamples(samples, 680));
  assert.equal(estimateHeightFromSamples(samples, 420), 390);
});

test("wide summary bands use their actual wide measurement instead of a narrow-panel estimate", () => {
  const samples = [
    { width: 560, height: 250 },
    { width: 760, height: 210 },
    { width: 1120, height: 170 },
    { width: 1560, height: 142 }
  ];
  assert.equal(estimateHeightFromSamples(samples, 1560), 142);
  assert.ok(estimateHeightFromSamples(samples, 1560) < estimateHeightFromSamples(samples, 760));
});

test("short measured content becomes a compact wide panel instead of a tall empty block", () => {
  const shortTheory = [
    { width: 280, height: 180 },
    { width: 420, height: 140 },
    { width: 560, height: 118 },
    { width: 760, height: 104 }
  ];
  const richTheory = [
    { width: 280, height: 510 },
    { width: 420, height: 390 },
    { width: 560, height: 320 },
    { width: 760, height: 280 }
  ];

  assert.ok(estimateAspectFromSamples(shortTheory, 560) > 4.5);
  assert.ok(estimateAspectFromSamples(shortTheory, 560) > estimateAspectFromSamples(richTheory, 560));
});

test("a multi-image evidence panel keeps a readable minimum width", () => {
  const plan = planPanels([
    { id: "problem", weight: 2.4, aspect: 1.3, minWidth: 0.16, minHeight: 0.15 },
    { id: "method", weight: 3.2, aspect: 1.5, minWidth: 0.2, minHeight: 0.18 },
    { id: "theory", weight: 4.5, aspect: 1.1, minWidth: 0.24, minHeight: 0.2 },
    { id: "visuals", weight: 7, aspect: 1.2, minWidth: 0.34, minHeight: 0.24 },
    { id: "results", weight: 8, aspect: 1.8, minWidth: 0.42, minHeight: 0.21 },
    { id: "contribution", weight: 2, aspect: 1.4, minWidth: 0.16, minHeight: 0.14 }
  ]);
  const visuals = plan.panels.find((panel) => panel.id === "visuals").rect;

  assert.ok(visuals.w >= 0.34);
});

test("figure readability floor preserves intrinsic height while leaving wide tables alone", () => {
  const figureFloor = estimateReadableFigureFloor([[2.99], [1.95]], 960);
  const narrowFloor = estimateReadableFigureFloor([[2.99], [1.95]], 560);

  assert.ok(figureFloor > 850, `expected readable stacked figures, received ${figureFloor}`);
  assert.ok(narrowFloor > 560, `expected readable narrow figures, received ${narrowFloor}`);
  assert.equal(estimateReadableFigureFloor([], 960), 0);
});

test("poster aspect adapts when a fixed wide canvas cannot fit rich content", () => {
  const features = [
    { id: "problem", weight: 3, aspect: 1.2, minWidth: 0.18, minHeight: 0.2, sizeSamples: [{ width: 560, height: 360 }] },
    { id: "method", weight: 3, aspect: 1.2, minWidth: 0.18, minHeight: 0.2, sizeSamples: [{ width: 560, height: 360 }] },
    { id: "theory", weight: 5, aspect: 1.2, minWidth: 0.28, minHeight: 0.26, sizeSamples: [{ width: 560, height: 440 }] },
    { id: "visuals", weight: 7, aspect: 1.1, minWidth: 0.34, minHeight: 0.3, sizeSamples: [{ width: 560, height: 500 }] },
    { id: "results", weight: 7, aspect: 1.6, minWidth: 0.42, minHeight: 0.25, sizeSamples: [{ width: 760, height: 420 }] },
    { id: "contribution", weight: 2, aspect: 1.4, minWidth: 0.18, minHeight: 0.17, sizeSamples: [{ width: 560, height: 250 }] }
  ];
  const adaptive = planPanels(features);

  assert.ok(adaptive.aspect < 1.78);
});

test("a clipping-repair aspect is compacted again after natural columns fit", () => {
  const samples = (height) => [
    { width: 560, height: height * 1.15 },
    { width: 760, height }
  ];
  const features = [
    { id: "problem", weight: 2, aspect: 4.5, minWidth: 0.16, minHeight: 0.1, sizeSamples: samples(145) },
    { id: "method", weight: 7, aspect: 1.1, minWidth: 0.24, minHeight: 0.25, sizeSamples: samples(520) },
    { id: "theory", weight: 3, aspect: 2, minWidth: 0.24, minHeight: 0.14, sizeSamples: samples(185) },
    { id: "results", weight: 5, aspect: 1.4, minWidth: 0.42, minHeight: 0.22, sizeSamples: samples(340) },
    { id: "contribution", weight: 1.5, aspect: 5, minWidth: 0.28, minHeight: 0.085, sizeSamples: samples(110) }
  ];
  const repaired = planPanels(features, { aspect: 1.7 });
  const occupiedBottom = Math.max(...repaired.panels.map(({ rect }) => rect.y + rect.h)) * repaired.aspect;
  const locked = planPanels(features, { aspect: 1.7, lockAspect: true });

  assert.ok(Math.abs(occupiedBottom - 1) < 1e-6);
  assert.equal(locked.aspect, 1.7);
});

test("visual review hints reshape panels without manufacturing empty height", () => {
  const [result] = applyReviewHints(
    [{ id: "results", weight: 5, aspect: 1.5, minWidth: 0.3, minHeight: 0.2 }],
    [{ panel: "results", areaScale: 9, widthScale: 0.2, heightScale: 1.2 }]
  );

  assert.equal(result.weight, 6.75);
  assert.ok(Math.abs(result.aspect - 1) < 1e-9);
  assert.equal(result.minWidth, 0.3);
  assert.equal(result.minHeight, 0.2);
});

test("visual review width requests remain soft and cannot squeeze neighboring media", () => {
  const [result] = applyReviewHints(
    [{ id: "results", weight: 5, aspect: 1.5, minWidth: 0.42, minHeight: 0.2 }],
    [{ panel: "results", areaScale: 1.2, widthScale: 1.35, heightScale: 1 }]
  );

  assert.equal(result.minWidth, 0.42);
  assert.ok(result.aspect > 1.5);
});

test("a measured full-width opening band is compacted before the content columns", () => {
  const samples = (height) => [
    { width: 420, height: height * 1.35 },
    { width: 760, height: height * 1.08 },
    { width: 1120, height: height },
    { width: 1560, height: height * 0.92 }
  ];
  const plan = planPanels([
    { id: "problem", weight: 2.5, aspect: 4.8, minWidth: 1, minHeight: 0.075, sizeSamples: samples(145) },
    { id: "method", weight: 8, aspect: 1.2, minWidth: 0.46, minHeight: 0.3, sizeSamples: samples(790) },
    { id: "theory", weight: 2, aspect: 2.2, minWidth: 0.16, minHeight: 0.1, sizeSamples: samples(190) },
    { id: "results", weight: 7, aspect: 1.5, minWidth: 0.36, minHeight: 0.215, sizeSamples: samples(370) },
    { id: "contribution", weight: 3, aspect: 2.4, minWidth: 0.28, minHeight: 0.12, sizeSamples: samples(290) }
  ]);
  const problem = plan.panels.find((panel) => panel.id === "problem").rect;
  const nextTop = Math.min(...plan.panels.filter((panel) => panel.id !== "problem").map((panel) => panel.rect.y));
  assert.equal(problem.w, 1);
  assert.ok(problem.h <= 0.13, `opening band remained too tall: ${problem.h}`);
  assert.ok(Math.abs(problem.y + problem.h - nextTop) < 1e-9);
});
