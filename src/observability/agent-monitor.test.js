const test = require("node:test");
const assert = require("node:assert/strict");
const { createMonitorState, reduceMonitorState, finishMonitorState, summarizeMonitor } = require("./agent-monitor");

test("monitor reducer tracks tasks, retries, tools, memory, and tokens", () => {
  let state = createMonitorState(0);
  state = reduceMonitorState(state, { stage: "planning", atMs: 5, plan: [{ id: "method", label: "Method", status: "pending" }] });
  state = reduceMonitorState(state, { stage: "analysis", atMs: 10, task: { id: "method", label: "Method", status: "running", attempts: 1 } });
  state = reduceMonitorState(state, { stage: "analysis", atMs: 15, memory: { taskId: "method", recalledItems: 2 } });
  state = reduceMonitorState(state, { stage: "analysis", atMs: 20, react: { taskId: "method", round: 1, phase: "reflection", detail: "broaden" } });
  state = reduceMonitorState(state, { stage: "analysis", atMs: 25, tool: { callId: "llm.analyze:1", name: "llm.analyze", status: "completed", metrics: { totalTokens: 120, tokenEstimate: true } } });
  const summary = summarizeMonitor(state);
  assert.equal(state.tasks[0].memoryHits, 2);
  assert.equal(summary.retries, 1);
  assert.equal(summary.totalTokens, 120);
  assert.equal(summary.tokenEstimate, true);
});

test("finished monitor prefers authoritative final metrics", () => {
  const finished = finishMonitorState(createMonitorState(0), {
    plan: [{ id: "overview", status: "completed" }],
    tools: [],
    metrics: { durationMs: 2500, totalTokens: 400, retries: 2, toolCalls: 6 }
  });
  const summary = summarizeMonitor(finished);
  assert.equal(finished.status, "completed");
  assert.equal(summary.totalTokens, 400);
  assert.equal(summary.retries, 2);
  assert.equal(summary.elapsedMs, 2500);
});
