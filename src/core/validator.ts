import { sensitiveMatch } from "./vocab";

export type Validation = { ok: true; body: string } | { ok: false; errors: string[] };

function numbers(text: string) {
  return (text.replace(/,(?=\d{2,3}\b)/g, "").match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n)));
}

export function validateBody(
  raw: string,
  opts: { knownHandles: Set<string>; maxLength?: number; groundingText?: string; allowedMentions?: Set<string> },
): Validation {
  const body = raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["“]|["”]$/g, "")
    .replace(/!+/g, ".")
    .replace(/\.{2,}/g, ".");
  const errors: string[] = [];
  if (opts.groundingText !== undefined) {
    const allowed = new Set(numbers(opts.groundingText));
    const invented = numbers(body).filter((n) => !allowed.has(n));
    if (invented.length) errors.push(`numbers not in source: ${[...new Set(invented)].join(", ")}`);
  }
  const max = opts.maxLength ?? 280;
  if (!body) errors.push("empty body");
  if (body.length > max) errors.push(`longer than ${max} characters (${body.length})`);
  if (/https?:\/\/|www\.|\b\S+\.(com|in|io|org|net)\b/i.test(body)) errors.push("contains a link");
  if (/\p{Extended_Pictographic}/u.test(body)) errors.push("contains an emoji");
  if ((body.match(/#\w+/g) ?? []).length > 0) errors.push("contains hashtags");
  const handles = (body.match(/@([a-z0-9_]+)/gi) ?? []).map((h) => h.slice(1).toLowerCase());
  const unknown = handles.filter((h) => !opts.knownHandles.has(h));
  if (unknown.length) errors.push(`mentions unknown handles: ${unknown.join(", ")}`);
  if (opts.allowedMentions) {
    const ungrounded = handles.filter((h) => opts.knownHandles.has(h) && !opts.allowedMentions!.has(h));
    if (ungrounded.length) errors.push(`mentions companies not in the source: ${ungrounded.join(", ")}`);
  }
  if (/[A-Za-z]:[A-Za-z]/.test(body.replace(/https?:\/\/\S+/g, ""))) errors.push("contains a corrupted word");
  const sensitive = sensitiveMatch(body);
  if (sensitive) errors.push(`sensitive wording: "${sensitive}"`);
  return errors.length ? { ok: false, errors } : { ok: true, body };
}
