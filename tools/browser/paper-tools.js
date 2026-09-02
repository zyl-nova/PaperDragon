(function exposePaperBrowserTools(global) {
  function createPaperBrowserTools(deps) {
    const definitions = global.PaperToolDefinitions || {};
    const factories = [
      definitions.pdfParser,
      definitions.textFormulas,
      definitions.textFigures,
      definitions.pdfTableCrop,
      definitions.posterInteractions
    ];
    if (factories.some((factory) => typeof factory !== "function")) {
      throw new Error("One or more browser tool definitions failed to load.");
    }
    const tools = global.PaperToolRuntime.create();
    factories.forEach((factory) => tools.register(factory(deps)));
    return tools;
  }

  global.createPaperBrowserTools = createPaperBrowserTools;
})(window);
