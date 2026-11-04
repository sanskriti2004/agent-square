export type LlmProviderName = "ollama" | "openai" | "rules";

function provider(): LlmProviderName {
  const value = (process.env.LLM_PROVIDER ?? "ollama").toLowerCase();
  return value === "openai" || value === "rules" ? value : "ollama";
}

export type RouterJudge = "rules" | "blend" | "llm";

function routerJudge(): RouterJudge {
  const value = (process.env.ROUTER_JUDGE ?? "rules").toLowerCase();
  return value === "blend" || value === "llm" ? value : "rules";
}

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://localhost:5432/agent_square",
  llmProvider: provider(),
  routerJudge: routerJudge(),
  ollamaUrl: process.env.OLLAMA_URL ?? "http://127.0.0.1:11434",
  ollamaModel: process.env.OLLAMA_MODEL ?? "qwen3:4b",
  ollamaDecideModel: process.env.OLLAMA_DECIDE_MODEL ?? process.env.OLLAMA_MODEL ?? "qwen3:4b",
  openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.groq.com/openai/v1",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL ?? "llama-3.1-8b-instant",
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 60000),
};
