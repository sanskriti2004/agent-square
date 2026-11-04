import { z } from "zod";
import { config, type LlmProviderName } from "@/lib/config";

export type LlmCall<T> = {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  model?: string;
};

export type LlmOutcome<T> =
  | { ok: true; data: T; provider: LlmProviderName; model: string; tokensIn: number; tokensOut: number; latencyMs: number }
  | { ok: false; error: string; provider: LlmProviderName; model: string; tokensIn: number; tokensOut: number; latencyMs: number };

export function activeModel(provider: LlmProviderName = config.llmProvider, model?: string) {
  if (provider === "ollama") return model ?? config.ollamaModel;
  if (provider === "openai") return config.openaiModel;
  return "rules-v1";
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("Model did not return JSON");
  }
}

function usesThinking(model: string) {
  return /qwen3|deepseek-r1|gpt-oss|magistral/i.test(model);
}

async function callOllama(call: LlmCall<unknown>, jsonSchema: object, signal: AbortSignal) {
  const model = call.model ?? config.ollamaModel;
  const body: Record<string, unknown> = {
    model,
    stream: false,
    format: jsonSchema,
    keep_alive: "30m",
    options: { temperature: 0.3, num_predict: call.maxTokens ?? 400 },
    messages: [
      { role: "system", content: call.system },
      { role: "user", content: call.user },
    ],
  };
  if (usesThinking(model)) body.think = false;
  const response = await fetch(`${config.ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error(`Ollama ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const json = (await response.json()) as {
    message?: { content?: string };
    prompt_eval_count?: number;
    eval_count?: number;
  };
  return {
    text: json.message?.content ?? "",
    tokensIn: json.prompt_eval_count ?? 0,
    tokensOut: json.eval_count ?? 0,
    model,
  };
}

async function callOpenAiCompatible(call: LlmCall<unknown>, jsonSchema: object, signal: AbortSignal) {
  if (!config.openaiApiKey) throw new Error("OPENAI_API_KEY is not set");
  const model = config.openaiModel;
  const response = await fetch(`${config.openaiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.openaiApiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: call.maxTokens ?? 400,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${call.system}\n\nRespond with a single JSON object matching this JSON Schema:\n${JSON.stringify(jsonSchema)}` },
        { role: "user", content: call.user },
      ],
    }),
    signal,
  });
  if (!response.ok) throw new Error(`LLM ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const json = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: json.choices?.[0]?.message?.content ?? "",
    tokensIn: json.usage?.prompt_tokens ?? 0,
    tokensOut: json.usage?.completion_tokens ?? 0,
    model,
  };
}

export async function generateJson<T>(
  call: LlmCall<T>,
  provider: LlmProviderName = config.llmProvider,
): Promise<LlmOutcome<T>> {
  const started = Date.now();
  const model = activeModel(provider, call.model);
  if (provider === "rules") {
    return { ok: false, error: "rules provider selected", provider, model, tokensIn: 0, tokensOut: 0, latencyMs: 0 };
  }
  const jsonSchema = z.toJSONSchema(call.schema);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.llmTimeoutMs);
  let tokensIn = 0;
  let tokensOut = 0;
  try {
    const raw =
      provider === "ollama"
        ? await callOllama(call as LlmCall<unknown>, jsonSchema, controller.signal)
        : await callOpenAiCompatible(call as LlmCall<unknown>, jsonSchema, controller.signal);
    tokensIn = raw.tokensIn;
    tokensOut = raw.tokensOut;
    const parsed = call.schema.safeParse(extractJson(raw.text));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(`Schema mismatch at ${issue?.path.join(".") || "root"}: ${issue?.message ?? "invalid"}`);
    }
    return { ok: true, data: parsed.data, provider, model: raw.model, tokensIn, tokensOut, latencyMs: Date.now() - started };
  } catch (error) {
    const message = controller.signal.aborted ? `Timed out after ${config.llmTimeoutMs}ms` : error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, provider, model, tokensIn, tokensOut, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

export async function llmHealth(): Promise<{ provider: LlmProviderName; model: string; reachable: boolean; detail: string }> {
  const provider = config.llmProvider;
  const model = activeModel(provider);
  if (provider === "rules") return { provider, model, reachable: true, detail: "Deterministic rules engine" };
  if (provider === "openai") {
    return { provider, model, reachable: Boolean(config.openaiApiKey), detail: config.openaiApiKey ? config.openaiBaseUrl : "OPENAI_API_KEY missing" };
  }
  try {
    const response = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
    const json = (await response.json()) as { models?: { name: string }[] };
    const names = new Set((json.models ?? []).flatMap((m) => [m.name, m.name.replace(/:latest$/, "")]));
    const wanted = [...new Set([config.ollamaModel, config.ollamaDecideModel])];
    const missing = wanted.filter((m) => !names.has(m));
    const label = wanted.join(" + ");
    return { provider, model: label, reachable: missing.length === 0, detail: missing.length ? `Model ${missing.join(", ")} not pulled` : config.ollamaUrl };
  } catch {
    return { provider, model, reachable: false, detail: `Ollama not reachable at ${config.ollamaUrl}` };
  }
}
