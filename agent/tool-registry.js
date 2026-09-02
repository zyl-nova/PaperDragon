class ToolRegistry {
  constructor({ onEvent = () => {}, trace = [] } = {}) {
    this.tools = new Map();
    this.onEvent = onEvent;
    this.trace = trace;
    this.callSequence = 0;
  }

  register(definition) {
    if (!definition?.name || typeof definition.run !== "function") {
      throw new Error("A tool requires a unique name and run function.");
    }
    if (this.tools.has(definition.name)) throw new Error(`Tool already registered: ${definition.name}`);
    this.tools.set(definition.name, {
      description: "",
      stage: "analysis",
      runtime: "server",
      inputTypes: [],
      supports: null,
      summarize: () => "Completed.",
      ...definition
    });
    return this;
  }

  manifest() {
    return [...this.tools.values()].map(({ name, description, stage, runtime, inputTypes }) => ({
      name, description, stage, runtime, inputTypes: [...inputTypes]
    }));
  }

  select(profile = {}, options = {}) {
    const names = Array.isArray(options.names) ? new Set(options.names) : null;
    return [...this.tools.values()]
      .filter((tool) => !names || names.has(tool.name))
      .filter((tool) => !options.stage || tool.stage === options.stage)
      .filter((tool) => !tool.inputTypes.length || tool.inputTypes.includes(profile.sourceType))
      .filter((tool) => typeof tool.supports !== "function" || tool.supports(profile))
      .map(({ name, description, stage, runtime, inputTypes }) => ({
        name, description, stage, runtime, inputTypes: [...inputTypes]
      }));
  }

  async execute(name, input, context = {}) {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    const startedAt = Date.now();
    const record = {
      callId: `${name}:${++this.callSequence}`,
      name,
      stage: tool.stage,
      status: "running",
      startedAt,
      durationMs: 0,
      summary: "",
      metrics: {}
    };
    this.trace.push(record);
    this.onEvent({
      stage: tool.stage,
      message: `Using tool: ${tool.description || name}`,
      tool: publicRecord(record)
    });

    try {
      const output = await tool.run(input, context);
      record.status = "completed";
      record.durationMs = Date.now() - startedAt;
      record.summary = String(tool.summarize(output, input) || "Completed.").slice(0, 300);
      record.metrics = typeof tool.metrics === "function" ? normalizeMetrics(tool.metrics(output, input)) : {};
      this.onEvent({
        stage: tool.stage,
        message: `${tool.description || name} completed.`,
        tool: publicRecord(record)
      });
      return output;
    } catch (error) {
      record.status = "failed";
      record.durationMs = Date.now() - startedAt;
      record.summary = safeMessage(error);
      this.onEvent({
        stage: tool.stage,
        message: `${tool.description || name} failed: ${record.summary}`,
        warning: true,
        tool: publicRecord(record)
      });
      throw error;
    }
  }
}

function publicRecord(record) {
  return {
    callId: record.callId,
    name: record.name,
    stage: record.stage,
    status: record.status,
    durationMs: record.durationMs,
    summary: record.summary,
    metrics: normalizeMetrics(record.metrics)
  };
}

function normalizeMetrics(value) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).slice(0, 20).map(([key, metric]) => {
    if (typeof metric === "boolean") return [String(key).slice(0, 80), metric];
    if (typeof metric === "number" && Number.isFinite(metric)) return [String(key).slice(0, 80), Math.max(0, metric)];
    return [String(key).slice(0, 80), String(metric || "").slice(0, 120)];
  }));
}

function safeMessage(error) {
  return String(error?.message || "Tool execution failed.")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .slice(0, 240);
}

module.exports = { ToolRegistry, publicRecord, safeMessage, normalizeMetrics };
