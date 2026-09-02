(function registerAgentMonitor(global) {
  function createMonitorState(now = Date.now()) {
    return {
      status: "idle",
      stage: "idle",
      message: "Agent is ready.",
      startedAt: now,
      elapsedMs: 0,
      tasks: [],
      tools: [],
      context: null,
      verificationScore: null
    };
  }

  function reduceMonitorState(state, event) {
    const next = {
      ...state,
      stage: event.stage || state.stage,
      message: event.message || state.message,
      elapsedMs: Math.max(state.elapsedMs || 0, Number(event.atMs || 0)),
      tasks: state.tasks.map((task) => ({ ...task })),
      tools: state.tools.map((tool) => ({ ...tool, metrics: { ...(tool.metrics || {}) } }))
    };
    if (Array.isArray(event.plan)) next.tasks = event.plan.map(normalizeTask);
    if (event.task?.id) upsertTask(next.tasks, normalizeTask(event.task));
    if (event.react?.taskId) {
      const task = ensureTask(next.tasks, event.react.taskId);
      task.round = Math.max(Number(task.round || 0), Number(event.react.round || 0));
      task.phase = event.react.phase || task.phase;
      task.detail = event.react.detail || task.detail;
      if (event.react.phase === "reflection") task.retries = Math.max(Number(task.retries || 0), Number(event.react.round || 1));
    }
    if (event.memory?.taskId) {
      const task = ensureTask(next.tasks, event.memory.taskId);
      task.memoryHits = Number(event.memory.recalledItems || 0);
    }
    if (event.tool?.name) upsertTool(next.tools, event.tool);
    if (event.contextStats) next.context = { ...event.contextStats };
    if (event.preflight) next.verificationScore = Number(event.preflight.score || 0);
    return next;
  }

  function finishMonitorState(state, agent) {
    return {
      ...state,
      status: "completed",
      stage: "reporting",
      message: "Agent run completed.",
      elapsedMs: Number(agent?.metrics?.durationMs || state.elapsedMs || 0),
      tasks: Array.isArray(agent?.plan) ? agent.plan.map(normalizeTask) : state.tasks,
      tools: Array.isArray(agent?.tools) ? agent.tools.map(normalizeTool) : state.tools,
      finalMetrics: { ...(agent?.metrics || {}) },
      verificationScore: Number(agent?.verification?.preflight?.score ?? state.verificationScore ?? 0)
    };
  }

  function summarizeMonitor(state) {
    const completed = state.tasks.filter((task) => task.status === "completed").length;
    const failed = state.tasks.filter((task) => ["failed", "insufficient"].includes(task.status)).length;
    const retries = state.tasks.reduce((sum, task) => sum + Math.max(Number(task.retries || 0), Math.max(0, Number(task.attempts || 0) - 1)), 0);
    const memoryHits = state.tasks.reduce((sum, task) => sum + Number(task.memoryHits || 0), 0);
    const finishedTools = state.tools.filter((tool) => tool.status !== "running");
    const liveTokens = finishedTools.reduce((sum, tool) => sum + Number(tool.metrics?.totalTokens || 0), 0);
    const metrics = state.finalMetrics || {};
    return {
      completed,
      failed,
      totalTasks: state.tasks.length,
      retries: Number(metrics.retries ?? retries),
      memoryHits,
      toolCalls: Number(metrics.toolCalls ?? finishedTools.length),
      totalTokens: Number(metrics.totalTokens ?? liveTokens),
      tokenEstimate: Boolean(metrics.tokenEstimate ?? finishedTools.some((tool) => tool.metrics?.tokenEstimate)),
      elapsedMs: Number(metrics.durationMs ?? state.elapsedMs ?? 0),
      costUsd: metrics.estimatedCostUsd == null ? null : Number(metrics.estimatedCostUsd)
    };
  }

  function createAgentMonitor(root) {
    let state = createMonitorState();
    let timer = null;
    const render = () => renderMonitor(root, state);
    const startTimer = () => {
      clearInterval(timer);
      timer = setInterval(() => {
        if (state.status !== "running") return;
        state = { ...state, elapsedMs: Date.now() - state.startedAt };
        render();
      }, 1000);
    };
    render();
    return {
      clear() {
        clearInterval(timer);
        state = createMonitorState();
        render();
      },
      reset() {
        state = { ...createMonitorState(), status: "running" };
        startTimer();
        render();
      },
      handle(event) {
        if (state.status === "idle") state = { ...state, status: "running", startedAt: Date.now() };
        state = reduceMonitorState(state, event || {});
        render();
      },
      complete(agent) {
        clearInterval(timer);
        state = finishMonitorState(state, agent);
        render();
      },
      fail(message) {
        clearInterval(timer);
        state = { ...state, status: "failed", message: String(message || "Agent run failed."), elapsedMs: Date.now() - state.startedAt };
        render();
      },
      getState: () => state
    };
  }

  function renderMonitor(root, state) {
    if (!root) return;
    const summary = summarizeMonitor(state);
    const stage = String(state.stage || "idle");
    const taskRows = state.tasks.length ? state.tasks.map((task) => `
      <li class="monitor-task ${escapeHtml(task.status)}">
        <span class="monitor-task-name"><b>${escapeHtml(task.label || task.id)}</b><small>${escapeHtml(task.phase || task.status)}</small></span>
        <span class="monitor-task-detail">${escapeHtml(task.detail || task.error || task.goal || "Waiting")}</span>
        <span class="monitor-task-counts">R${Number(task.round || task.attempts || 0)} | E${Number(task.evidenceCount || 0)} | M${Number(task.memoryHits || 0)}</span>
      </li>
    `).join("") : `<li class="monitor-empty">Waiting for the reading plan.</li>`;
    const recentTools = state.tools.slice(-8).reverse();
    const toolRows = recentTools.length ? recentTools.map((tool) => `
      <li class="monitor-tool ${escapeHtml(tool.status)}">
        <span><b>${escapeHtml(tool.name)}</b><small>${escapeHtml(tool.summary || tool.stage || "Running")}</small></span>
        <span>${escapeHtml(tool.status)}${tool.durationMs ? ` | ${Number(tool.durationMs)}ms` : ""}${tool.metrics?.totalTokens ? ` | ${Number(tool.metrics.totalTokens)} tok` : ""}</span>
      </li>
    `).join("") : `<li class="monitor-empty">No tool calls yet.</li>`;
    root.innerHTML = `
      <div class="monitor-head">
        <div><h2>Live Agent Execution</h2><span>${escapeHtml(state.message)}</span></div>
        <b class="monitor-stage ${escapeHtml(state.status)}">${escapeHtml(stage)}</b>
      </div>
      <div class="monitor-metrics">
        <span>Tasks <b>${summary.completed}/${summary.totalTasks || 0}</b></span>
        <span>Unresolved <b>${summary.failed}</b></span>
        <span>Tools <b>${summary.toolCalls}</b></span>
        <span>Retries <b>${summary.retries}</b></span>
        <span>Memory <b>${summary.memoryHits}</b></span>
        <span>Tokens${summary.tokenEstimate ? " est." : ""} <b>${summary.totalTokens}</b></span>
        <span>Elapsed <b>${formatDuration(summary.elapsedMs)}</b></span>
      </div>
      <div class="monitor-columns">
        <div><h3>Reading tasks</h3><ol class="monitor-task-list">${taskRows}</ol></div>
        <div><h3>Recent tools</h3><ul class="monitor-tool-list">${toolRows}</ul></div>
      </div>`;
  }

  function normalizeTask(task) {
    return {
      id: String(task?.id || "task"),
      label: String(task?.label || task?.id || "Reading task"),
      goal: String(task?.goal || ""),
      status: String(task?.status || "pending"),
      durationMs: Number(task?.durationMs || 0),
      evidenceCount: Number(task?.evidenceCount || 0),
      attempts: Number(task?.attempts || 0),
      round: Number(task?.attempts || 0),
      retries: Math.max(0, Number(task?.attempts || 0) - 1),
      memoryHits: Number(task?.memoryHits || 0),
      error: String(task?.error || ""),
      phase: String(task?.phase || ""),
      detail: String(task?.detail || "")
    };
  }

  function normalizeTool(tool) {
    return {
      callId: String(tool?.callId || `${tool?.name || "tool"}:${Math.random()}`),
      name: String(tool?.name || "tool"),
      stage: String(tool?.stage || "analysis"),
      status: String(tool?.status || "completed"),
      durationMs: Number(tool?.durationMs || 0),
      summary: String(tool?.summary || ""),
      metrics: { ...(tool?.metrics || {}) }
    };
  }

  function ensureTask(tasks, id) {
    let task = tasks.find((item) => item.id === id);
    if (!task) {
      task = normalizeTask({ id, label: id });
      tasks.push(task);
    }
    return task;
  }

  function upsertTask(tasks, task) {
    const index = tasks.findIndex((item) => item.id === task.id);
    if (index === -1) tasks.push(task);
    else tasks[index] = { ...tasks[index], ...task };
  }

  function upsertTool(tools, tool) {
    const normalized = normalizeTool(tool);
    const index = tools.findIndex((item) => item.callId === normalized.callId);
    if (index === -1) tools.push(normalized);
    else tools[index] = { ...tools[index], ...normalized };
  }

  function formatDuration(milliseconds) {
    const seconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  const api = { createAgentMonitor, createMonitorState, reduceMonitorState, finishMonitorState, summarizeMonitor, formatDuration };
  global.AgentObservability = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
