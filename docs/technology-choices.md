# Technology Choices

This document records the technology selected for each concern, the alternatives considered, and the rationale. Architecturally significant decisions are expanded in the [decision records](adr/).

## Selection criteria

1. **Unattended operation.** The pipeline must run continuously, without external rate limits or quotas that could stall it.
2. **Operational simplicity.** As few moving parts as the workload allows.
3. **Transactional integrity.** State changes and the work they trigger must commit together.
4. **Reproducibility.** A reviewer can run the full system locally, with or without a language model.

## Selections

| Concern | Selection | Alternatives considered | Rationale | References |
|---|---|---|---|---|
| Language-model runtime | Ollama | Hosted OpenAI-compatible APIs, Gemini API | Runs locally with no account, network dependency or rate limits. Schema-constrained JSON output through the `format` parameter. Hosted providers remain supported through `LLM_PROVIDER=openai`. | [Ollama](https://github.com/ollama/ollama), [structured outputs](https://registry.ollama.ai/blog/structured-outputs), [ADR 0001](adr/0001-local-llm-runtime.md) |
| Model | qwen3:4b (Apache 2.0) | llama3.2:3b | Schema-valid output on all benchmark calls, better editorial judgement, and no partner notifications wrongly dismissed. Selected by measurement. | [Evaluation](evaluation.md#2-model-selection) |
| Operation without a model | Rules engine (`src/core/rules.ts`) | — | The system remains fully functional when no model is available, and the rules engine provides the baseline for evaluation | [Evaluation](evaluation.md#1-routing-quality) |
| Datastore, queue and deduplication | PostgreSQL with `pg_trgm` | Redis with BullMQ, pg-boss, MongoDB, SQLite | A single transactional store: a post and its routing job commit together. `SKIP LOCKED` provides a reliable queue at this volume, and trigram similarity clusters stories without an embeddings service. | [`SKIP LOCKED`](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE), [queue benchmark](https://levelup.gitconnected.com/postgres-vs-redis-as-a-job-queue-postgres-enqueued-2-5x-faster-redis-drained-2x-faster-ebef92f98aba), [ADR 0002](adr/0002-postgres-as-single-datastore.md) |
| News source | Google News RSS (India edition) | GDELT DOC 2.0, commercial news and search APIs, X API | Per-company queries with no credentials, updated within minutes | [Parameter reference](https://newscatcherapi.com/blog/google-news-rss-search-parameters-the-missing-documentaiton), [ADR 0005](adr/0005-news-ingestion-and-feed-delivery.md) |
| Web application | Next.js 16, React 19, Tailwind CSS 4 | Remix, SvelteKit | Server components query PostgreSQL directly. One language across the UI, API and worker. | [Next.js](https://github.com/vercel/next.js) |
| Schema validation | Zod 4 | Ajv | One definition produces the JSON Schema sent to the model (`z.toJSONSchema`) and validates the response | [Zod](https://github.com/colinhacks/zod) |
| RSS parsing | fast-xml-parser | rss-parser | Small and maintained, with no native dependencies | [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) |
| Identifiers | UUIDv7 | Snowflake, serial integers | Time-ordered and coordinator-free, so ordering by ID gives chronological order | [RFC 9562](https://www.rfc-editor.org/rfc/rfc9562) |
| Typography | IBM Plex Sans and IBM Plex Mono | Inter, system fonts | High legibility for dense, data-heavy views, with tabular numerals | [IBM Plex](https://github.com/IBM/plex) |
| Script runner | tsx | ts-node | Runs the worker and scripts directly from TypeScript, with path aliases | [tsx](https://github.com/privatenumber/tsx) |

## Deployment considerations

The worker is a long-running process that polls on a schedule. It needs an always-on host, so serverless functions and instance types that suspend when idle are unsuitable for it.

| Option | Suitability |
|---|---|
| Single virtual machine running `docker-compose.yml` (PostgreSQL and Ollama), the worker and the web application | Recommended. For example, an OCI Ampere A1 instance with 4 OCPUs and 24 GB RAM can run qwen3:4b on CPU alongside the other services ([OCI resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm)). |
| Managed PostgreSQL with containerised worker and web services | Suitable, using `LLM_PROVIDER=openai` with a hosted model endpoint |
| Serverless web hosting | Suitable for the web application only; the worker must run elsewhere |
