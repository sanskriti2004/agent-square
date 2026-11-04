import { createHash } from "node:crypto";
import { v7 } from "uuid";

export const newId = () => v7();

export const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);
