# ADR 0002: PostgreSQL as the single datastore, including the job queue

- **Status:** Accepted
- **Date:** 2026-10-28

## Context

The system needs:
- relational state: agents, relationships, posts, notifications
- a durable job queue for the pipeline stages
- near-duplicate detection for news items
- an audit trail of every automated decision

Several pipeline steps change state and schedule follow-up work in the same operation. For example, publishing a post must also schedule its routing.

## Decision

PostgreSQL holds all state, including the job queue (`src/core/queue.ts`):

| Queue property | Implementation |
|---|---|
| Claiming | `FOR UPDATE SKIP LOCKED`, so concurrent workers never take the same job |
| Idempotency | A partial unique index on `singleton_key` over queued and active jobs |
| Retries | Exponential backoff; a job moves to a `dead` state after three attempts |
| Stale locks | Recovered automatically |

Jobs are enqueued in the same transaction as the write that causes them, which gives the guarantees of the transactional outbox pattern without a separate relay.

Related choices:
- **Story clustering** uses `pg_trgm` similarity over normalised titles within a 72-hour window.
- **Identifiers** are UUIDv7, so ordering by primary key gives chronological order.

## Alternatives considered

| Option | Assessment |
|---|---|
| Redis with BullMQ | Rich scheduling features and fast dequeue, but a second datastore introduces dual writes between application state and queue state |
| pg-boss | Built on the same `SKIP LOCKED` primitive, and a reasonable choice. The custom queue is small, keeps enqueueing inside application transactions, and stores jobs as ordinary rows that the Operations page can query directly. |
| Kafka or Redpanda | Appropriate for high-throughput partitioned processing, but unjustified at roughly one event per second or less |
| Vector database for deduplication | Unnecessary when trigram similarity on titles is sufficient for clustering |

## Consequences

- One system to operate, back up and inspect. Every state change and the work it triggers commit atomically.
- Published benchmarks show PostgreSQL queues handling thousands of jobs per second, far above this workload.
- **Revisit** if sustained throughput approaches about 1,000 jobs per second, or if queue activity affects read latency (design document, section 8).
