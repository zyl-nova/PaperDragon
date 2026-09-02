(function exposePaperToolRuntime(global) {
  class BrowserToolRegistry {
    constructor() {
      this.tools = new Map();
      this.trace = [];
    }

    register(definition) {
      if (!definition?.name || typeof definition.run !== "function") {
        throw new Error("Browser tool requires a name and run function.");
      }
      this.tools.set(definition.name, {
        description: definition.name,
        stage: "preprocessing",
        runtime: "browser",
        inputTypes: [],
        supports: null,
        summarize: () => "Completed.",
        ...definition
      });
      return this;
    }

    plan(profile = {}, options = {}) {
      return [...this.tools.values()]
        .filter((tool) => !options.stage || tool.stage === options.stage)
        .filter((tool) => !tool.inputTypes.length || tool.inputTypes.includes(profile.sourceType))
        .filter((tool) => typeof tool.supports !== "function" || tool.supports(profile))
        .map(({ name, description, stage, runtime, inputTypes }) => ({
          name, description, stage, runtime, inputTypes: [...inputTypes]
        }));
    }

    manifest() {
      return [...this.tools.values()].map(({ name, description, stage, runtime, inputTypes }) => ({
        name, description, stage, runtime, inputTypes: [...inputTypes]
      }));
    }

    async execute(name, input) {
      const tool = this.tools.get(name);
      if (!tool) throw new Error(`Unknown browser tool: ${name}`);
      const startedAt = Date.now();
      const record = { name, stage: tool.stage, status: "running", durationMs: 0, summary: "", runtime: "browser" };
      this.trace.push(record);
      try {
        const output = await tool.run(input);
        record.status = "completed";
        record.durationMs = Date.now() - startedAt;
        record.summary = String(tool.summarize(output, input) || "Completed.").slice(0, 300);
        return output;
      } catch (error) {
        record.status = "failed";
        record.durationMs = Date.now() - startedAt;
        record.summary = String(error?.message || "Tool failed.").slice(0, 240);
        throw error;
      }
    }

    getTrace() {
      return this.trace.map((item) => ({ ...item }));
    }

    clearTrace() {
      this.trace.length = 0;
    }
  }

  global.PaperToolRuntime = { create: () => new BrowserToolRegistry() };
})(window);
