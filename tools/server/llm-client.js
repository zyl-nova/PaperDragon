function createLlmClient({ getApiKey, getBaseUrl, getModel }) {
  return async function callChatCompletion({ messages, maxTokens, responseFormat, timeoutMs, textChars = 0 }) {
    const baseUrl = getBaseUrl();
    const model = getModel();
    const controller = new AbortController();
    const body = {
      model,
      temperature: Number(process.env.LLM_TEMPERATURE || 0.1),
      max_tokens: maxTokens,
      messages
    };
    if (responseFormat) body.response_format = responseFormat;
    let response;
    let data;
    try {
      console.log(`[LLM] Requesting ${model} via ${baseUrl}; text chars=${textChars}; timeout=${timeoutMs}ms`);
      const result = await withTimeout((async () => {
        const fetchResponse = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${getApiKey()}` },
          body: JSON.stringify(body)
        });
        console.log(`[LLM] Response headers received; status=${fetchResponse.status}`);
        const responseText = await fetchResponse.text();
        console.log(`[LLM] Response body read; chars=${responseText.length}`);
        let parsed = {};
        try { parsed = responseText ? JSON.parse(responseText) : {}; } catch { parsed = { rawText: responseText }; }
        return { fetchResponse, parsed };
      })(), timeoutMs, () => controller.abort());
      response = result.fetchResponse;
      data = result.parsed;
    } catch (error) {
      if (error.name === "AbortError" || error.code === "APP_TIMEOUT") {
        throw new Error(`LLM request timed out after ${Math.round(timeoutMs / 1000)} seconds. Check network, model name, or reduce MAX_PAPER_CHARS.`);
      }
      const cause = error.cause;
      const details = [error.message, cause?.code && `code=${cause.code}`, cause?.syscall && `syscall=${cause.syscall}`, cause?.hostname && `host=${cause.hostname}`, cause?.address && `address=${cause.address}`].filter(Boolean).join("; ");
      throw new Error(`Network request to LLM failed: ${details || "unknown network error"}`);
    }
    if (!response.ok) {
      const message = data.error?.message || JSON.stringify(data).slice(0, 300) || `HTTP ${response.status}`;
      throw new Error(`LLM request failed (${response.status}): ${message}`);
    }
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error(`LLM returned an empty response: ${JSON.stringify(data).slice(0, 300)}`);
    return { content, raw: data };
  };
}

function withTimeout(promise, timeoutMs, onTimeout) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      onTimeout?.();
      const error = new Error("Operation timed out.");
      error.code = "APP_TIMEOUT";
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

module.exports = { createLlmClient };
