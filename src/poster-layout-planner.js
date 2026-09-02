(function registerPosterLayoutPlanner(global, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (global) global.PosterLayoutPlanner = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis, () => {
  const DEFAULT_ORDER = [
    "problem",
    "motivation",
    "method",
    "theory",
    "visuals",
    "results",
    "contribution"
  ];

  const SECTION_BIAS = {
    problem: { weight: 0.95, aspect: 1.35 },
    motivation: { weight: 0.9, aspect: 1.35 },
    method: { weight: 1.35, aspect: 1.75 },
    theory: { weight: 1.15, aspect: 1.05 },
    visuals: { weight: 1.55, aspect: 2.25 },
    results: { weight: 1.2, aspect: 1.05 },
    contribution: { weight: 0.78, aspect: 4.2 }
  };
  const LAYOUT_CANVAS_WIDTH = 1600;
  const PANEL_SAMPLE_WIDTHS = [280, 420, 560, 760, 1120, 1560];

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function sumWeight(items) {
    return items.reduce((sum, item) => sum + item.weight, 0);
  }

  function groupMinimum(items, key, fallback) {
    return items.reduce((largest, item) => Math.max(largest, Number(item[key]) || fallback), fallback);
  }

  function splitRatios(baseRatio, firstMinimum, secondMinimum, span) {
    const lower = clamp(firstMinimum / Math.max(span, 0.001), 0.12, 0.88);
    const upper = clamp(1 - secondMinimum / Math.max(span, 0.001), 0.12, 0.88);
    if (lower > upper) return [clamp(baseRatio, 0.16, 0.84)];
    const ratios = [clamp(baseRatio, lower, upper), (lower + upper) / 2];
    if (lower <= 0.5 && upper >= 0.5) ratios.push(0.5);
    return [...new Set(ratios.map((value) => Number(value.toFixed(6))))];
  }

  function leafLoss(item, rect) {
    const actualAspect = Math.max(rect.w / Math.max(rect.h, 0.001), 0.05);
    const aspectLoss = Math.abs(Math.log(actualAspect / item.aspect)) * item.weight;
    const requiredWidth = Math.max(0.16, Number(item.minWidth) || 0);
    const requiredHeight = Math.max(0.075, Number(item.minHeight) || 0.13);
    const widthViolation = Math.max(0, requiredWidth - rect.w);
    const heightViolation = Math.max(0, requiredHeight - rect.h);
    const shapeViolation = Math.max(0, 0.62 - actualAspect);
    const hardConstraintPenalty = widthViolation || heightViolation || shapeViolation
      ? 100000 + (widthViolation + heightViolation + shapeViolation) * item.weight * 100000
      : 0;
    const thinPenalty = rect.w < 0.18 ? (0.18 - rect.w) * 24 : 0;
    const shortPenalty = rect.h < 0.14 ? (0.14 - rect.h) * 24 : 0;
    const portraitTextPenalty = actualAspect < 0.62
      ? (0.62 - actualAspect) * item.weight * 20
      : 0;
    const fullHeightStripPenalty = rect.h > 0.42 && rect.w < 0.24
      ? ((0.24 - rect.w) + (rect.h - 0.42)) * item.weight * 30
      : 0;
    const horizontalMediaPenalty = item.aspect >= 2.4 && actualAspect < 1.45
      ? (1.45 - actualAspect) * item.weight * 18
      : 0;
    const panelWidth = Math.max(120, rect.w * (item.canvasWidth || LAYOUT_CANVAS_WIDTH) - 8);
    const panelHeight = Math.max(80, rect.h * (item.canvasWidth || LAYOUT_CANVAS_WIDTH) - 8);
    const estimatedHeight = estimateHeightFromSamples(item.sizeSamples, panelWidth);
    const contentOverflow = estimatedHeight > 0 ? Math.max(0, estimatedHeight - panelHeight) : 0;
    const contentFitPenalty = contentOverflow > 0
      ? 250000 + contentOverflow * item.weight * 2500
      : 0;
    const excessWhitespacePenalty = estimatedHeight > 0 && panelHeight > estimatedHeight * 1.18
      ? (panelHeight / estimatedHeight - 1.18) * item.weight * 48
      : 0;
    return aspectLoss + thinPenalty + shortPenalty + portraitTextPenalty + fullHeightStripPenalty
      + horizontalMediaPenalty + hardConstraintPenalty
      + contentFitPenalty + excessWhitespacePenalty;
  }

  function recursiveLayout(items, rect) {
    if (items.length === 1) {
      return { loss: leafLoss(items[0], rect), panels: [{ ...items[0], rect }] };
    }

    let best = { loss: Number.POSITIVE_INFINITY, panels: [] };
    const totalWeight = sumWeight(items);
    for (let split = 1; split < items.length; split += 1) {
      const first = items.slice(0, split);
      const second = items.slice(split);
      const ratio = sumWeight(first) / totalWeight;
      const verticalRatios = splitRatios(
        ratio,
        groupMinimum(first, "minWidth", 0.16),
        groupMinimum(second, "minWidth", 0.16),
        rect.w
      );
      const horizontalRatios = splitRatios(
        ratio,
        groupMinimum(first, "minHeight", 0.13),
        groupMinimum(second, "minHeight", 0.13),
        rect.h
      );
      const candidates = [
        ...verticalRatios.map((splitRatio) => [
          { x: rect.x, y: rect.y, w: rect.w * splitRatio, h: rect.h },
          { x: rect.x + rect.w * splitRatio, y: rect.y, w: rect.w * (1 - splitRatio), h: rect.h }
        ]),
        ...horizontalRatios.map((splitRatio) => [
          { x: rect.x, y: rect.y, w: rect.w, h: rect.h * splitRatio },
          { x: rect.x, y: rect.y + rect.h * splitRatio, w: rect.w, h: rect.h * (1 - splitRatio) }
        ])
      ];

      for (const [firstRect, secondRect] of candidates) {
        const firstPlan = recursiveLayout(first, firstRect);
        const secondPlan = recursiveLayout(second, secondRect);
        const balancePenalty = Math.abs(
          firstRect.w * firstRect.h - sumWeight(first) / totalWeight * rect.w * rect.h
        ) * 20;
        const loss = firstPlan.loss + secondPlan.loss + balancePenalty;
        if (loss < best.loss) best = { loss, panels: [...firstPlan.panels, ...secondPlan.panels] };
      }
    }
    return best;
  }

  function layoutWithContributionBand(items, aspect) {
    const contribution = items.find((item) => item.id === "contribution");
    const remaining = items.filter((item) => item !== contribution);
    if (!contribution || !remaining.length) return null;
    const fullHeight = 1 / aspect;
    const sampledHeight = estimateHeightFromSamples(contribution.sizeSamples, LAYOUT_CANVAS_WIDTH - 8);
    const requiredHeight = Math.max(
      Number(contribution.minHeight) || 0.095,
      sampledHeight ? (sampledHeight + 18) / LAYOUT_CANVAS_WIDTH : 0
    );
    const maximumBandHeight = Math.min(0.18, fullHeight * 0.3);
    if (requiredHeight > maximumBandHeight + 0.002) return null;
    const bandHeight = clamp(requiredHeight, 0.095, maximumBandHeight);
    const remainingRect = { x: 0, y: 0, w: 1, h: fullHeight - bandHeight };
    const measuredRows = layoutMeasuredRows(remaining, remainingRect);
    const measuredColumns = measuredRows ? null : layoutMeasuredColumns(remaining, remainingRect);
    const remainingPlan = measuredRows || measuredColumns || recursiveLayout(remaining, remainingRect);
    const remainingBottom = remainingPlan.panels.reduce(
      (bottom, panel) => Math.max(bottom, panel.rect.y + panel.rect.h),
      0
    );
    const bodyPanels = measuredColumns
      ? alignMeasuredColumnFrames(remainingPlan.panels, remainingBottom)
      : remainingPlan.panels;
    const contributionRect = { x: 0, y: remainingBottom, w: 1, h: bandHeight };
    return {
      loss: remainingPlan.loss + leafLoss(contribution, contributionRect),
      panels: [...bodyPanels, { ...contribution, rect: contributionRect }],
      naturalHeight: true
    };
  }

  function alignMeasuredColumnFrames(panels, sharedBottom) {
    const bottomByColumn = new Map();
    panels.forEach((panel) => {
      const key = panel.rect.x.toFixed(6);
      const bottom = panel.rect.y + panel.rect.h;
      const current = bottomByColumn.get(key);
      if (!current || bottom > current.bottom) bottomByColumn.set(key, { bottom, id: panel.id });
    });
    return panels.map((panel) => {
      const key = panel.rect.x.toFixed(6);
      const column = bottomByColumn.get(key);
      if (column?.id !== panel.id || sharedBottom <= column.bottom) return panel;
      return {
        ...panel,
        rect: { ...panel.rect, h: panel.rect.h + sharedBottom - column.bottom }
      };
    });
  }

  function measuredStack(items, rect) {
    const width = Math.max(160, rect.w * LAYOUT_CANVAS_WIDTH - 8);
    const required = items.map((item) => measuredItemHeight(item, width));
    const total = required.reduce((sum, height) => sum + height, 0);
    if (total > rect.h + 0.002) return null;
    let y = rect.y;
    const panels = items.map((item, index) => {
      const height = required[index];
      const panel = { ...item, rect: { x: rect.x, y, w: rect.w, h: height } };
      y += height;
      return panel;
    });
    return { panels, requiredHeight: total };
  }

  function measuredItemHeight(item, width) {
    const measured = estimateHeightFromSamples(item.sizeSamples, width);
    const safety = item.tableFigures > 0 || item.tableRows > 0 ? 24 : 18;
    return Math.max(
      Number(item.minHeight) || 0.09,
      measured ? (measured + safety) / LAYOUT_CANVAS_WIDTH : 0.13
    );
  }

  function measuredPairRow(first, second, rect, y, ratio) {
    const firstWidth = rect.w * ratio;
    const secondWidth = rect.w - firstWidth;
    if (firstWidth < (first.minWidth || 0.16) || secondWidth < (second.minWidth || 0.16)) return null;
    const firstHeight = measuredItemHeight(first, Math.max(160, firstWidth * LAYOUT_CANVAS_WIDTH - 8));
    const secondHeight = measuredItemHeight(second, Math.max(160, secondWidth * LAYOUT_CANVAS_WIDTH - 8));
    const height = Math.max(firstHeight, secondHeight);
    const firstPanel = { ...first, rect: { x: rect.x, y, w: firstWidth, h: height } };
    const secondPanel = { ...second, rect: { x: rect.x + firstWidth, y, w: secondWidth, h: height } };
    return {
      height,
      panels: [firstPanel, secondPanel],
      loss: leafLoss(first, firstPanel.rect) + leafLoss(second, secondPanel.rect)
        + Math.abs(firstHeight - secondHeight) * 16000
    };
  }

  function layoutMeasuredRows(items, rect) {
    if (items.length !== 4 || items.some((item) => !item.sizeSamples?.length)) return null;
    const opening = items.find((item) => item.id === "problem")
      || items.find((item) => item.id === "motivation");
    const method = items.find((item) => item.id === "method");
    const theory = items.find((item) => item.id === "theory");
    const results = items.find((item) => item.id === "results");
    if (!opening || !method || !theory || !results) return null;
    const arrangements = [
      [[opening, method], [theory, results]],
      [[opening, theory], [method, results]]
    ];
    const ratios = [0.3, 0.34, 0.38, 0.42, 0.46, 0.5, 0.54, 0.58, 0.62, 0.66, 0.7];
    let best = null;
    for (const arrangement of arrangements) {
      for (const firstRatio of ratios) {
        const firstRow = measuredPairRow(...arrangement[0], rect, rect.y, firstRatio);
        if (!firstRow) continue;
        for (const secondRatio of ratios) {
          const secondRow = measuredPairRow(
            ...arrangement[1],
            rect,
            rect.y + firstRow.height,
            secondRatio
          );
          if (!secondRow) continue;
          const requiredHeight = firstRow.height + secondRow.height;
          if (requiredHeight > rect.h + 0.002) continue;
          const splitDifference = Math.abs(firstRatio - secondRatio);
          const loss = firstRow.loss + secondRow.loss + splitDifference * 0.35;
          if (!best || loss < best.loss) {
            best = {
              loss,
              panels: [...firstRow.panels, ...secondRow.panels],
              naturalHeight: true
            };
          }
        }
      }
    }
    return best;
  }

  function layoutMeasuredColumns(items, rect) {
    if (items.length < 3 || items.length > 7) return null;
    if (items.filter((item) => item.sizeSamples?.length).length < Math.ceil(items.length / 2)) return null;
    let best = null;
    const assignmentLimit = 2 ** items.length;
    for (const leftRatio of [0.38, 0.4, 0.42, 0.44, 0.46, 0.48, 0.5, 0.52, 0.54, 0.56, 0.58, 0.6, 0.62]) {
      const leftRect = { x: rect.x, y: rect.y, w: rect.w * leftRatio, h: rect.h };
      const rightRect = { x: rect.x + leftRect.w, y: rect.y, w: rect.w - leftRect.w, h: rect.h };
      for (let assignment = 1; assignment < assignmentLimit - 1; assignment += 1) {
        if ((assignment & 1) === 0) continue;
        const leftItems = items.filter((_, index) => assignment & (1 << index));
        const rightItems = items.filter((_, index) => !(assignment & (1 << index)));
        if (leftItems.some((item) => leftRect.w < (item.minWidth || 0.16))
          || rightItems.some((item) => rightRect.w < (item.minWidth || 0.16))) continue;
        const leftStack = measuredStack(leftItems, leftRect);
        const rightStack = measuredStack(rightItems, rightRect);
        if (!leftStack || !rightStack) continue;
        const panels = [...leftStack.panels, ...rightStack.panels];
        const theoryPanel = panels.find((panel) => panel.id === "theory");
        const resultsPanel = panels.find((panel) => panel.id === "results");
        if (theoryPanel && resultsPanel && theoryPanel.rect.y > resultsPanel.rect.y + 0.002) continue;
        const contributionPanel = panels.find((panel) => panel.id === "contribution");
        if (contributionPanel && resultsPanel && contributionPanel.rect.y < resultsPanel.rect.y - 0.002) continue;
        const sideSequence = items.map((_, index) => assignment & (1 << index) ? 0 : 1);
        const switches = sideSequence.slice(1).reduce(
          (count, side, index) => count + (side !== sideSequence[index] ? 1 : 0),
          0
        );
        const requiredImbalance = Math.abs(leftStack.requiredHeight - rightStack.requiredHeight);
        const unusedHeight = Math.max(0, rect.h - leftStack.requiredHeight)
          + Math.max(0, rect.h - rightStack.requiredHeight);
        const widthImbalance = Math.abs(leftRatio - 0.5);
        const loss = panels.reduce((sum, panel) => sum + leafLoss(panel, panel.rect), 0)
          + requiredImbalance * 24000 + unusedHeight * 1000
          + widthImbalance * 2 + Math.max(0, switches - 2) * 0.8;
        if (!best || loss < best.loss) best = { loss, panels, naturalHeight: true };
      }
    }
    return best;
  }

  function layoutMeasuredColumnsWithAlignedFrames(items, rect) {
    const plan = layoutMeasuredColumns(items, rect);
    if (!plan) return null;
    const sharedBottom = plan.panels.reduce(
      (bottom, panel) => Math.max(bottom, panel.rect.y + panel.rect.h),
      rect.y
    );
    const alignedPanels = alignMeasuredColumnFrames(plan.panels, sharedBottom);
    const frameExtension = alignedPanels.reduce((total, panel, index) => (
      total + Math.max(0, panel.rect.h - plan.panels[index].rect.h)
    ), 0);
    if (frameExtension > 0.045) return null;
    return {
      ...plan,
      loss: plan.loss + frameExtension * 5000,
      panels: alignedPanels,
      naturalHeight: true
    };
  }

  function layoutWithCompactSummaryBands(items, aspect) {
    const problem = items.find((item) => item.id === "problem")
      || items.find((item) => item.id === "motivation");
    const remaining = items.filter((item) => item !== problem);
    if (!problem || remaining.length < 3 || !problem.sizeSamples?.length) return null;
    const fullHeight = 1 / aspect;
    const problemSample = estimateHeightFromSamples(problem.sizeSamples, LAYOUT_CANVAS_WIDTH - 8);
    const problemHeight = Math.max(Number(problem.minHeight) || 0.085, (problemSample + 18) / LAYOUT_CANVAS_WIDTH);
    const problemMaximum = Math.min(0.19, fullHeight * 0.27);
    if (problemHeight > problemMaximum) return null;
    const top = clamp(problemHeight, 0.075, problemMaximum);
    const contribution = remaining.find((item) => item.id === "contribution");
    const middle = remaining.filter((item) => item !== contribution);
    if (contribution?.sizeSamples?.length && middle.length >= 2) {
      const contributionSample = estimateHeightFromSamples(contribution.sizeSamples, LAYOUT_CANVAS_WIDTH - 8);
      const contributionHeight = Math.max(Number(contribution.minHeight) || 0.085, (contributionSample + 18) / LAYOUT_CANVAS_WIDTH);
      const contributionMaximum = Math.min(0.16, fullHeight * 0.24);
      if (contributionHeight <= contributionMaximum + 0.002) {
        const bottom = clamp(contributionHeight, 0.07, contributionMaximum);
        const middleHeight = fullHeight - top - bottom;
        if (middleHeight >= groupMinimum(middle, "minHeight", 0.13)) {
          const middleRect = { x: 0, y: top, w: 1, h: middleHeight };
          const middlePlan = layoutMeasuredColumns(middle, middleRect) || recursiveLayout(middle, middleRect);
          const problemRect = { x: 0, y: 0, w: 1, h: top };
          const middleBottom = middlePlan.panels.reduce(
            (largest, panel) => Math.max(largest, panel.rect.y + panel.rect.h),
            top
          );
          const contributionRect = { x: 0, y: middleBottom, w: 1, h: bottom };
          const largestMiddleArea = middlePlan.panels.reduce(
            (largest, panel) => Math.max(largest, panel.rect.w * panel.rect.h),
            0
          );
          if (bottom < largestMiddleArea * 0.92) {
            return {
              loss: middlePlan.loss + leafLoss(problem, problemRect) + leafLoss(contribution, contributionRect),
              panels: [
                { ...problem, rect: problemRect },
                ...middlePlan.panels,
                { ...contribution, rect: contributionRect }
              ],
              naturalHeight: true
            };
          }
        }
      }
    }
    const balancedMiddleRect = { x: 0, y: top, w: 1, h: fullHeight - top };
    const balancedMiddlePlan = layoutMeasuredColumns(remaining, balancedMiddleRect);
    if (!balancedMiddlePlan) return null;
    const problemRect = { x: 0, y: 0, w: 1, h: top };
    return {
      loss: balancedMiddlePlan.loss + leafLoss(problem, problemRect),
      panels: [{ ...problem, rect: problemRect }, ...balancedMiddlePlan.panels],
      naturalHeight: true
    };
  }

  function compactMeasuredOpeningBand(panels) {
    const opening = panels.find((panel) => ["problem", "motivation"].includes(panel.id));
    if (!opening || opening.rect.x > 0.002 || opening.rect.y > 0.002 || opening.rect.w < 0.98) return panels;
    const openingBottom = opening.rect.y + opening.rect.h;
    const following = panels.filter((panel) => panel !== opening);
    if (!following.length || following.some((panel) => panel.rect.y < openingBottom - 0.002)) return panels;
    const measuredHeight = measuredItemHeight(opening, LAYOUT_CANVAS_WIDTH - 8);
    const targetHeight = Math.max(Number(opening.minHeight) || 0.075, measuredHeight * 1.06);
    const reduction = opening.rect.h - targetHeight;
    if (reduction < 0.012) return panels;
    return panels.map((panel) => panel === opening
      ? { ...panel, rect: { ...panel.rect, h: targetHeight } }
      : { ...panel, rect: { ...panel.rect, y: panel.rect.y - reduction } });
  }

  function planPanels(features, options = {}) {
    const ordered = [...features].sort((a, b) => {
      const aOrder = DEFAULT_ORDER.indexOf(a.id);
      const bOrder = DEFAULT_ORDER.indexOf(b.id);
      return (aOrder < 0 ? 99 : aOrder) - (bOrder < 0 ? 99 : bOrder);
    });
    const requestedAspect = Number(options.aspect);
    const aspects = requestedAspect
      ? [clamp(requestedAspect, 0.78, 2.2)]
      : [0.78, 0.9, 1, 1.1, 1.15, 1.25, 1.35, 1.45, 1.55, 1.65, 1.7, 1.72, 1.78, 1.84, 1.9];
    const candidates = aspects.flatMap((aspect) => {
      const fullRect = { x: 0, y: 0, w: 1, h: 1 / aspect };
      const unconstrained = recursiveLayout(ordered, { x: 0, y: 0, w: 1, h: 1 / aspect });
      const contributionBand = layoutWithContributionBand(ordered, aspect);
      const compactSummaryBands = layoutWithCompactSummaryBands(ordered, aspect);
      const measuredColumns = layoutMeasuredColumns(ordered, fullRect);
      const hasContribution = ordered.some((item) => item.id === "contribution");
      const measuredContributionLayout = hasContribution
        ? layoutMeasuredColumnsWithAlignedFrames(ordered, fullRect)
        : null;
      const shapePreference = Math.abs(Math.log(aspect / 1.55)) * 3;
      const layouts = hasContribution
        ? [
            { candidate: contributionBand, layoutKind: "contribution-band" },
            { candidate: compactSummaryBands, layoutKind: "compact-summary" },
            { candidate: measuredContributionLayout, layoutKind: "measured-contribution" }
          ]
        : [
            { candidate: compactSummaryBands, layoutKind: "compact-summary" },
            { candidate: measuredColumns, layoutKind: "measured-columns" },
            { candidate: unconstrained, layoutKind: "recursive" }
          ];
      const availableLayouts = layouts.filter(({ candidate }) => Boolean(candidate));
      const safeLayouts = availableLayouts.length
        ? availableLayouts
        : [{ candidate: unconstrained, layoutKind: "recursive-fallback" }];
      return safeLayouts
        .map(({ candidate, layoutKind }) => ({
          aspect,
          ...candidate,
          layoutKind,
          adjustedLoss: candidate.loss + shapePreference
        }));
    });
    const naturalCandidates = candidates.filter((candidate) => candidate.naturalHeight);
    const eligibleCandidates = naturalCandidates.length ? naturalCandidates : candidates;
    const plan = eligibleCandidates.reduce(
      (best, candidate) => candidate.adjustedLoss < best.adjustedLoss ? candidate : best
    );
    const compactedPanels = compactMeasuredOpeningBand(plan.panels);
    const contentBottom = compactedPanels.reduce(
      (bottom, panel) => Math.max(bottom, panel.rect.y + panel.rect.h),
      0
    );
    const compactedAspect = plan.naturalHeight && !options.lockAspect
      ? clamp(1 / Math.max(contentBottom, 0.001), plan.aspect, 2.1)
      : plan.aspect;
    return {
      aspect: compactedAspect,
      loss: plan.loss,
      panels: compactedPanels.map((panel) => ({ id: panel.id, rect: panel.rect }))
    };
  }

  function imageAspect(image) {
    const width = Number(image.naturalWidth || image.getAttribute("width")) || 0;
    const height = Number(image.naturalHeight || image.getAttribute("height")) || 0;
    return width > 0 && height > 0 ? width / height : 1.4;
  }

  function svgAspect(svg) {
    const viewBox = String(svg.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
    if (viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) return viewBox[2] / viewBox[3];
    const width = Number.parseFloat(svg.getAttribute("width")) || 0;
    const height = Number.parseFloat(svg.getAttribute("height")) || 0;
    return width > 0 && height > 0 ? width / height : 0;
  }

  function estimateHeightFromSamples(samples, width) {
    const points = Array.isArray(samples)
      ? samples.filter((sample) => sample?.width > 0 && sample?.height > 0).sort((a, b) => a.width - b.width)
      : [];
    if (!points.length) return 0;
    if (width <= points[0].width) {
      return points[0].height * Math.pow(points[0].width / Math.max(width, 80), 0.7);
    }
    const last = points[points.length - 1];
    if (width >= last.width) {
      return Math.max(last.height * 0.95, last.height * Math.pow(last.width / width, 0.2));
    }
    for (let index = 1; index < points.length; index += 1) {
      const next = points[index];
      const previous = points[index - 1];
      if (width <= next.width) {
        const ratio = (width - previous.width) / (next.width - previous.width);
        return previous.height + (next.height - previous.height) * ratio;
      }
    }
    return last.height;
  }

  function estimateAspectFromSamples(samples, width = 560, fallback = 1.35) {
    const height = estimateHeightFromSamples(samples, width);
    return height > 0 ? clamp(width / height, 0.75, 6.8) : fallback;
  }

  function estimateReadableFigureFloor(figureGroups, width) {
    const groups = Array.isArray(figureGroups) ? figureGroups : [];
    if (!groups.length || width <= 0) return 0;
    const usableWidth = Math.max(120, width - 24);
    return groups.reduce((total, group) => {
      const aspects = (Array.isArray(group) ? group : [])
        .map(Number)
        .filter((aspect) => aspect > 0);
      if (!aspects.length) return total;
      const columns = aspects.length > 1 ? Math.min(2, aspects.length) : 1;
      const itemWidth = (usableWidth - (columns - 1) * 8) / columns;
      let mediaHeight = 0;
      for (let index = 0; index < aspects.length; index += columns) {
        const rowAspects = aspects.slice(index, index + columns);
        mediaHeight += Math.max(...rowAspects.map((aspect) => {
          const naturalHeight = itemWidth / aspect;
          return aspect < 1.15
            ? clamp(naturalHeight, 180, 520)
            : clamp(naturalHeight, 110, 620);
        }));
      }
      // Caption and interpretation text need space below every selected figure.
      return total + mediaHeight + 78;
    }, 0);
  }

  function measurePanelSizeSamples(panel) {
    const documentRef = panel?.ownerDocument;
    if (!documentRef?.body || typeof panel.cloneNode !== "function") return [];
    const sourcePoster = panel.closest?.(".poster");
    const host = documentRef.createElement("section");
    host.className = "poster poster-focused poster-export poster-size-probe";
    if (sourcePoster?.dataset.paperType) host.dataset.paperType = sourcePoster.dataset.paperType;
    host.style.cssText = [
      "position:fixed",
      "left:-30000px",
      "top:0",
      "z-index:-1",
      "visibility:hidden",
      "pointer-events:none",
      "padding:0",
      "margin:0",
      "border:0",
      "box-shadow:none",
      "overflow:visible"
    ].join(";");
    const grid = documentRef.createElement("div");
    grid.className = "poster-grid";
    grid.style.cssText = "display:block;margin:0;overflow:visible;aspect-ratio:auto";
    host.append(grid);
    documentRef.body.append(host);

    const samples = [];
    try {
      for (const width of PANEL_SAMPLE_WIDTHS) {
        host.style.width = `${width}px`;
        grid.style.width = `${width}px`;
        const clone = panel.cloneNode(true);
        clone.removeAttribute("style");
        clone.style.cssText = [
          "position:static",
          "display:block",
          "width:100%",
          "height:auto",
          "min-height:0",
          "overflow:visible",
          "grid-area:auto"
        ].join(";");
        grid.replaceChildren(clone);
        const height = Math.ceil(Math.max(clone.scrollHeight, clone.getBoundingClientRect().height));
        samples.push({ width, height });
      }
    } finally {
      host.remove();
    }
    return samples;
  }

  function inspectPosterPanels(root) {
    return DEFAULT_ORDER.map((id) => root.querySelector(`[data-poster-section="${id}"]`))
      .filter((panel) => Boolean(panel) && !panel.hidden)
      .map((panel) => {
        const id = panel.dataset.posterSection;
        const bias = SECTION_BIAS[id] || { weight: 1, aspect: 1.35 };
        const textChars = panel.textContent.replace(/\s+/g, " ").trim().length;
        const images = [...panel.querySelectorAll("img")];
        const originalFigures = [...panel.querySelectorAll("figure.paper-figure:not(.paper-table-figure)")];
        const figureMediaGroups = originalFigures
          .map((figure) => [...figure.querySelectorAll(".figure-media img")].map(imageAspect))
          .filter((group) => group.length);
        const originalFigureImages = figureMediaGroups.reduce((count, group) => count + group.length, 0);
        const wideSvgs = [...panel.querySelectorAll("svg.logic-map")];
        const generatedDiagrams = panel.querySelectorAll(".method-flow-map, .key-idea-map").length;
        const figureCount = panel.querySelectorAll("figure").length;
        const formulaCount = panel.querySelectorAll(".formula").length;
        const tableRows = panel.querySelectorAll("table tr").length;
        const tableFigures = panel.querySelectorAll(".paper-table-figure").length;
        const tableImages = panel.querySelectorAll(".paper-table-figure img").length;
        const multiImageGroups = panel.querySelectorAll(".figure-media.multi").length;
        const hasPrimaryTable = tableFigures > 0 || tableRows > 0;
        const measuredSizeSamples = measurePanelSizeSamples(panel);
        const sizeSamples = measuredSizeSamples.map((sample) => ({
          ...sample,
          height: Math.max(sample.height, estimateReadableFigureFloor(figureMediaGroups, sample.width))
        }));
        const priority = panel.dataset.priority === "high" ? 1.16 : panel.dataset.priority === "supporting" ? 0.82 : 1;
        const mediaWeight = images.length * 1.45 + wideSvgs.length * 0.9 + generatedDiagrams * 0.85 + figureCount * 0.55
          + formulaCount * 0.65 + Math.min(tableRows, 10) * 0.12 + tableFigures * 1.15;
        const textWeight = clamp(textChars / 260, 0.45, 2.8);
        const measuredHeight = estimateHeightFromSamples(sizeSamples, 560);
        const measuredAspect = estimateAspectFromSamples(sizeSamples, 560, bias.aspect);
        const measuredWeight = measuredHeight ? clamp(measuredHeight / 210, 0.75, 3.8) : 1;
        const weight = clamp((0.55 + textWeight + mediaWeight + measuredWeight) * bias.weight * priority, 0.75, 9.5);
        const mediaAspects = [
          ...images.map(imageAspect),
          ...wideSvgs.map(svgAspect).filter(Boolean)
        ];
        const averageMediaAspect = mediaAspects.length
          ? mediaAspects.reduce((sum, value) => sum + value, 0) / mediaAspects.length
          : bias.aspect;
        const groupedMediaAspect = mediaAspects.length > 1 ? averageMediaAspect * 1.35 : averageMediaAspect;
        const mediaAspect = multiImageGroups || figureCount > 1
          ? Math.max(groupedMediaAspect, 1.35)
          : groupedMediaAspect;
        const aspect = hasPrimaryTable
          ? clamp((mediaAspect + 1.45) / 2, 1.45, 2.45)
          : clamp(mediaAspects.length ? mediaAspect : measuredAspect * 0.82 + bias.aspect * 0.18, 0.75, 6.8);
        const hasRichMedia = images.length > 0 || wideSvgs.length > 0 || formulaCount > 1;
        const hasLandscapeMedia = mediaAspects.some((value) => value >= 1.45);
        const minWidth = id === "contribution"
          ? 0.28
          : id === "problem"
            ? 0.26
          : hasPrimaryTable
          ? tableFigures > 1 || tableImages > 1 ? 0.46 : 0.36
          : originalFigureImages > 1 || (figureMediaGroups.length && mediaAspects.some((value) => value < 2.2))
            ? 0.46
          : multiImageGroups && figureCount > 1
            ? 0.42
            : hasLandscapeMedia || images.length > 0 || formulaCount > 0
              ? 0.4
            : hasRichMedia
              ? 0.3
              : 0.16;
        const contentHeight = clamp(0.13 + textChars / 6000, 0.13, 0.19);
        const compactSummaryHeight = estimateHeightFromSamples(sizeSamples, LAYOUT_CANVAS_WIDTH - 40);
        const sampledTextHeight = estimateHeightFromSamples(sizeSamples, 560);
        const measuredTextMinHeight = sampledTextHeight
          ? clamp((sampledTextHeight + 18) / LAYOUT_CANVAS_WIDTH, 0.085, 0.19)
          : contentHeight;
        const generatedDiagramHeight = generatedDiagrams > 0 && !hasRichMedia
          ? estimateHeightFromSamples(sizeSamples, 1120)
          : 0;
        const generatedDiagramMinHeight = generatedDiagramHeight
          ? clamp((generatedDiagramHeight + 18) / LAYOUT_CANVAS_WIDTH, 0.095, 0.16)
          : measuredTextMinHeight;
        const minHeight = ["problem", "contribution"].includes(id) && compactSummaryHeight
          ? clamp((compactSummaryHeight + 14) / LAYOUT_CANVAS_WIDTH, 0.075, id === "problem" ? 0.16 : 0.145)
          : hasPrimaryTable
          ? clamp(0.215 + Math.min(tableRows, 12) * 0.004, 0.215, 0.255)
          : hasRichMedia
            ? Math.max(0.2, contentHeight)
            : generatedDiagrams > 0
              ? generatedDiagramMinHeight
              : measuredTextMinHeight;
        return {
          id,
          weight: hasPrimaryTable ? clamp(weight * 1.22, 0.75, 9.5) : weight,
          aspect,
          minWidth,
          minHeight,
          textChars,
          images: images.length,
          wideSvgs: wideSvgs.length,
          generatedDiagrams,
          formulas: formulaCount,
          tableRows,
          tableFigures,
          tableImages,
          originalFigureImages,
          figureMediaGroups,
          multiImageGroups,
          sizeSamples,
          canvasWidth: LAYOUT_CANVAS_WIDTH
        };
      });
  }

  function writeLayout(root, plan) {
    root.dataset.layout = "adaptive-tree";
    root.dataset.layoutEngine = "measured-masonry-v3";
    root.style.setProperty("--poster-layout-aspect", String(plan.aspect));
    for (const panel of plan.panels) {
      const element = root.querySelector(`[data-poster-section="${panel.id}"]`);
      if (!element) continue;
      const { x, y, w, h } = panel.rect;
      element.style.setProperty("--poster-x", `${x * 100}%`);
      element.style.setProperty("--poster-y", `${y * plan.aspect * 100}%`);
      element.style.setProperty("--poster-w", `${w * 100}%`);
      element.style.setProperty("--poster-h", `${h * plan.aspect * 100}%`);
    }
    root.dataset.layoutLoss = plan.loss.toFixed(3);
  }

  function applyPosterLayout(root, options = {}) {
    const features = options.features || inspectPosterPanels(root);
    const plan = planPanels(features, options);
    writeLayout(root, plan);
    return { ...plan, features };
  }

  function applyReviewHints(features, reviewHints = []) {
    const byPanel = new Map((Array.isArray(reviewHints) ? reviewHints : [])
      .filter((hint) => hint && typeof hint === "object" && hint.panel)
      .map((hint) => [String(hint.panel), hint]));
    return features.map((feature) => {
      const hint = byPanel.get(feature.id);
      if (!hint) return { ...feature };
      const areaScale = clamp(Number(hint.areaScale) || 1, 0.8, 1.35);
      const widthScale = clamp(Number(hint.widthScale) || 1, 0.8, 1.35);
      const heightScale = clamp(Number(hint.heightScale) || 1, 0.8, 1.35);
      return {
        ...feature,
        weight: clamp(feature.weight * areaScale, 0.45, 9.5),
        aspect: clamp(feature.aspect * widthScale / heightScale, 0.72, 6.8),
        // Review suggestions are soft preferences. Only measured content may impose
        // hard width and height floors; otherwise one requested wide panel can squeeze
        // a landscape figure into a narrow, mostly empty neighboring column.
        minWidth: clamp(feature.minWidth || 0.16, 0.14, 0.52),
        // Readability hints may reshape a panel, but content measurements own its height.
        // Enlarging a height floor without adding content creates the blank bands that the
        // measured layout is specifically intended to remove.
        minHeight: clamp(feature.minHeight || 0.13, 0.075, 0.32),
        reviewHint: { areaScale, widthScale, heightScale }
      };
    });
  }

  function panelUtilization(panel) {
    const panelRect = panel.getBoundingClientRect();
    if (!panelRect.height) return 1;
    const visible = [...panel.querySelectorAll("*")]
      .filter((node) => !["SCRIPT", "STYLE"].includes(node.tagName) && node.getClientRects().length);
    const leaves = visible.filter((node) => ![...node.children].some((child) => child.getClientRects().length));
    const measuredNodes = leaves.length ? leaves : [...panel.children].filter((child) => child.getClientRects().length);
    if (!measuredNodes.length) return 0.5;
    const contentBottom = Math.max(...measuredNodes.map((node) => node.getBoundingClientRect().bottom));
    const usedHeight = contentBottom - panelRect.top + 10;
    const scrollUtilization = panel.clientHeight && panel.scrollHeight > panel.clientHeight + 2
      ? panel.scrollHeight / panel.clientHeight
      : 0;
    return clamp(Math.max(usedHeight / panelRect.height, scrollUtilization), 0.2, 2.8);
  }

  function findClippedPanelIds(root) {
    return [...(root?.querySelectorAll?.("[data-poster-section]") || [])]
      .filter((panel) => !panel.hidden && panel.clientWidth > 0 && panel.clientHeight > 0)
      .filter((panel) => {
        if (panel.scrollHeight > panel.clientHeight + 8 || panel.scrollWidth > panel.clientWidth + 14) return true;
        if (typeof panel.getBoundingClientRect !== "function" || typeof panel.querySelectorAll !== "function") return false;
        const panelRect = panel.getBoundingClientRect();
        const safeBottom = panelRect.bottom + 6;
        return [...panel.querySelectorAll("*")]
          .filter((node) => !["SCRIPT", "STYLE"].includes(node.tagName))
          .some((node) => {
            if (typeof node.getBoundingClientRect !== "function" || node.getClientRects?.().length === 0) return false;
            const rect = node.getBoundingClientRect();
            return rect.height > 0 && rect.bottom > safeBottom;
          });
      })
      .map((panel) => panel.dataset.posterSection)
      .filter(Boolean);
  }

  function findSeverelyClippedPanelIds(root) {
    return [...(root?.querySelectorAll?.("[data-poster-section]") || [])]
      .filter((panel) => !panel.hidden && panel.clientWidth > 0 && panel.clientHeight > 0)
      .filter((panel) => {
        const verticalRatio = panel.scrollHeight / Math.max(1, panel.clientHeight);
        const horizontalRatio = panel.scrollWidth / Math.max(1, panel.clientWidth);
        return verticalRatio > 1.08 || horizontalRatio > 1.045;
      })
      .map((panel) => panel.dataset.posterSection)
      .filter(Boolean);
  }

  function standaloneGuardScript() {
    return String.raw`(() => {
  let repairAttempts = 0;
  const check = () => {
    const root = document.querySelector(".poster-export");
    if (!root) return;
    if (root.dataset.layout === "content-safe-grid") {
      if (root.dataset.layoutEngine !== "measured-masonry-v3") return;
      root.dataset.layout = "adaptive-tree";
      delete root.dataset.clippingFallback;
    }
    const panels = [...root.querySelectorAll("[data-poster-section]")];
    const coordinates = panels.map((panel) => ({
      panel,
      y: Number.parseFloat(panel.style.getPropertyValue("--poster-y")),
      h: Number.parseFloat(panel.style.getPropertyValue("--poster-h"))
    })).filter(({ y, h }) => Number.isFinite(y) && Number.isFinite(h));
    const contentBottom = coordinates.reduce((bottom, item) => Math.max(bottom, item.y + item.h), 0);
    if (contentBottom > 40 && contentBottom < 97) {
      const scale = 100 / contentBottom;
      const aspect = Number.parseFloat(root.style.getPropertyValue("--poster-layout-aspect")) || 1.78;
      coordinates.forEach(({ panel, y, h }) => {
        panel.style.setProperty("--poster-y", String(y * scale) + "%");
        panel.style.setProperty("--poster-h", String(h * scale) + "%");
      });
      root.style.setProperty("--poster-layout-aspect", String(aspect * scale));
      root.dataset.layoutCompacted = "true";
    }
    const clipped = panels.filter((panel) => {
      if (panel.hidden || !panel.clientHeight || !panel.clientWidth) return false;
      if (panel.scrollHeight > panel.clientHeight + 8 || panel.scrollWidth > panel.clientWidth + 14) return true;
      const bounds = panel.getBoundingClientRect();
      const safeBottom = bounds.bottom + 6;
      return [...panel.querySelectorAll("*")].some((node) => {
        if (["SCRIPT", "STYLE"].includes(node.tagName) || !node.getClientRects().length) return false;
        const rect = node.getBoundingClientRect();
        return rect.height > 0 && rect.bottom > safeBottom;
      });
    });
    if (clipped.length) {
      const overflowRatio = clipped.reduce((largest, panel) => {
        const bounds = panel.getBoundingClientRect();
        const descendantBottom = Math.max(bounds.bottom, ...[...panel.querySelectorAll("*")]
          .filter((node) => !["SCRIPT", "STYLE"].includes(node.tagName) && node.getClientRects().length)
          .map((node) => node.getBoundingClientRect().bottom + 6));
        return Math.max(
          largest,
          panel.scrollHeight / Math.max(1, panel.clientHeight),
          (descendantBottom - bounds.top) / Math.max(1, bounds.height)
        );
      }, 1);
      const aspect = Number.parseFloat(root.style.getPropertyValue("--poster-layout-aspect")) || 1.78;
      if (repairAttempts < 8 && aspect > 0.82) {
        const scale = Math.max(0.78, Math.min(0.96, 1 / overflowRatio - 0.012));
        root.style.setProperty("--poster-layout-aspect", String(Math.max(0.78, aspect * scale)));
        root.dataset.layoutRepaired = String(++repairAttempts);
        window.setTimeout(schedule, 70);
        return;
      }
      const severe = clipped.filter((panel) => (
        panel.scrollHeight / Math.max(1, panel.clientHeight) > 1.08
        || panel.scrollWidth / Math.max(1, panel.clientWidth) > 1.045
      ));
      if (severe.length) {
        root.dataset.layout = "content-safe-grid";
        root.dataset.clippingFallback = severe.map((panel) => panel.dataset.posterSection).filter(Boolean).join(",");
        return;
      }
      root.dataset.layoutWarning = clipped.map((panel) => panel.dataset.posterSection).filter(Boolean).join(",");
      delete root.dataset.clippingFallback;
      return;
    }
    repairAttempts = 0;
    delete root.dataset.clippingFallback;
  };
  let timer = 0;
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => requestAnimationFrame(check), 40);
  };
  window.addEventListener("load", schedule, { once: true });
  window.addEventListener("resize", schedule);
  document.fonts?.ready?.then(schedule).catch(() => {});
  schedule();
})();`;
  }

  function applyContentSafeLayout(root, clippedIds) {
    root.dataset.layout = "content-safe-grid";
    root.dataset.clippingFallback = clippedIds.join(",");
  }

  function refinePosterLayout(root, options = {}) {
    const inspectedFeatures = options.features || inspectPosterPanels(root);
    const baseFeatures = applyReviewHints(inspectedFeatures, options.reviewHints);
    let activeFeatures = baseFeatures;
    let result = applyPosterLayout(root, { ...options, features: activeFeatures });
    const iterations = clamp(Number(options.iterations) || 3, 1, 6);
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      root.getBoundingClientRect();
      const clippedIds = new Set(findClippedPanelIds(root));
      if (!clippedIds.size) break;
      const gridWidth = Math.max(1, root.querySelector?.(".poster-grid")?.getBoundingClientRect?.().width || LAYOUT_CANVAS_WIDTH);
      const adjusted = activeFeatures.map((feature) => {
        const panel = root.querySelector(`[data-poster-section="${feature.id}"]`);
        const utilization = panel ? panelUtilization(panel) : 1;
        const sizeFactor = clamp(utilization / 0.72, 0.32, 1.8);
        const shapeFactor = clamp(0.72 / utilization, 0.65, 2.5);
        const measuredMinHeight = panel && clippedIds.has(feature.id)
          ? (panel.scrollHeight + 12) / gridWidth
          : 0;
        return {
          ...feature,
          weight: clamp(feature.weight * sizeFactor, 0.45, 9.5),
          aspect: clamp(feature.aspect * shapeFactor, 0.72, 6.8),
          minHeight: Math.max(feature.minHeight || 0.09, measuredMinHeight),
          utilization
        };
      });
      const overflowRatio = clippedIds.size
        ? [...clippedIds].reduce((largest, id) => {
            const panel = root.querySelector(`[data-poster-section="${id}"]`);
            if (!panel?.clientHeight) return largest;
            const panelRect = panel.getBoundingClientRect();
            const descendantBottom = Math.max(
              panelRect.bottom,
              ...[...panel.querySelectorAll("*")]
                .filter((node) => !["SCRIPT", "STYLE"].includes(node.tagName) && node.getClientRects().length)
                .map((node) => node.getBoundingClientRect().bottom + 6)
            );
            const scrollRatio = panel.scrollHeight / panel.clientHeight;
            const descendantRatio = (descendantBottom - panelRect.top) / Math.max(1, panelRect.height);
            return Math.max(largest, scrollRatio, descendantRatio);
          }, 1)
        : 1;
      const retryScale = clamp(1 / overflowRatio - 0.005, 0.88, 0.985);
      const retryAspect = clippedIds.size ? Math.max(0.78, result.aspect * retryScale) : options.aspect;
      activeFeatures = adjusted;
      result = applyPosterLayout(root, { ...options, aspect: retryAspect, features: activeFeatures });
    }
    for (let compaction = 0; compaction < 2; compaction += 1) {
      root.getBoundingClientRect();
      if (findClippedPanelIds(root).length) break;
      let changed = false;
      const compacted = activeFeatures.map((feature) => {
        if (feature.id === "problem" || !feature.sizeSamples?.length) return feature;
        const panel = root.querySelector(`[data-poster-section="${feature.id}"]`);
        const utilization = panel ? panelUtilization(panel) : 1;
        if (utilization >= 0.93) return feature;
        const heightScale = clamp(utilization + 0.04, 0.72, 0.96);
        changed = true;
        return {
          ...feature,
          sizeSamples: feature.sizeSamples.map((sample) => ({
            ...sample,
            height: Math.max(1, sample.height * heightScale)
          }))
        };
      });
      if (!changed) break;
      const previousFeatures = activeFeatures;
      const previousResult = result;
      activeFeatures = compacted;
      result = applyPosterLayout(root, { ...options, features: activeFeatures });
      root.getBoundingClientRect();
      if (findClippedPanelIds(root).length) {
        activeFeatures = previousFeatures;
        result = applyPosterLayout(root, { ...options, aspect: previousResult.aspect, features: activeFeatures });
        break;
      }
    }
    root.getBoundingClientRect();
    let remainingClipped = findClippedPanelIds(root);
    for (let repair = 0; remainingClipped.length && repair < 4; repair += 1) {
      const repairedAspect = Math.max(0.78, result.aspect * 0.88);
      if (Math.abs(repairedAspect - result.aspect) < 0.001) break;
      result = applyPosterLayout(root, { ...options, aspect: repairedAspect, features: baseFeatures });
      root.getBoundingClientRect();
      remainingClipped = findClippedPanelIds(root);
    }
    if (remainingClipped.length) {
      const severeClipped = findSeverelyClippedPanelIds(root);
      if (!severeClipped.length) {
        root.dataset.layoutWarning = remainingClipped.join(",");
        delete root.dataset.clippingFallback;
        return { ...result, fallback: "", clippedPanels: [], layoutWarnings: remainingClipped };
      }
      applyContentSafeLayout(root, severeClipped);
      root.getBoundingClientRect();
      return { ...result, fallback: "content-safe-grid", clippedPanels: severeClipped };
    }
    delete root.dataset.layoutWarning;
    delete root.dataset.clippingFallback;
    return { ...result, fallback: "", clippedPanels: [] };
  }

  return {
    planPanels,
    inspectPosterPanels,
    applyPosterLayout,
    refinePosterLayout,
    estimateHeightFromSamples,
    estimateAspectFromSamples,
    estimateReadableFigureFloor,
    applyReviewHints,
    findClippedPanelIds,
    findSeverelyClippedPanelIds,
    standaloneGuardScript
  };
});
