import { z } from "zod";
import type { ClientMsg, Intent } from "./types.js";

/** Maximum size of a client frame, in bytes. */
export const MAX_FRAME_BYTES = 4096;

const id = z.string().min(1).max(64);
const dir = z.enum(["N", "E", "S", "W"]);

export const IntentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("MOVE"), dir }),
  z.object({ kind: z.literal("WAIT") }),
  z.object({ kind: z.literal("TAKE") }),
  z.object({ kind: z.literal("DROP"), item: id }),
  z.object({ kind: z.literal("USE"), item: id }),
  z.object({ kind: z.literal("SNATCH") }),
]);

export const WatchSchema = z.object({ type: z.literal("watch") });
export const HelloSchema = z.object({
  type: z.literal("hello"),
  token: z.string().min(1).max(128).optional(),
  name: z.string().max(64).optional(),
});
export const JoinSchema = z.object({
  type: z.literal("join"),
  mode: z.enum(["practice", "official"]),
  tier: z.enum(["novice", "adept", "master"]).optional(),
  speed: z.union([z.literal(1), z.literal(2), z.literal(4)]).optional(),
});
export const IntentMsgSchema = z.object({
  type: z.literal("intent"),
  match_id: id,
  tick: z.number().int().min(0).max(100_000),
  intent: z.unknown(),
});
export const LeaveSchema = z.object({ type: z.literal("leave"), match_id: id });

export type ParseResult =
  | { ok: true; msg: ClientMsg }
  | { ok: false; code: "bad_json" | "bad_message" | "bad_intent" | "frame_too_large"; message: string; match_id?: string };

/**
 * Parse one client frame. Never throws. Unknown fields are ignored (stripped).
 * An intent frame whose envelope is valid but whose intent is malformed yields `bad_intent`
 * with the match id, so the server can treat it as WAIT.
 */
export function parseClientFrame(raw: string): ParseResult {
  if (raw.length > MAX_FRAME_BYTES) return { ok: false, code: "frame_too_large", message: `frame exceeds ${MAX_FRAME_BYTES} bytes` };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, code: "bad_json", message: "frame is not valid JSON" };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, code: "bad_message", message: "frame must be a JSON object" };
  const type = (data as { type?: unknown }).type;
  switch (type) {
    case "hello": {
      const r = HelloSchema.safeParse(data);
      return r.success ? { ok: true, msg: r.data } : { ok: false, code: "bad_message", message: summarize(r.error) };
    }
    case "join": {
      const r = JoinSchema.safeParse(data);
      return r.success ? { ok: true, msg: r.data } : { ok: false, code: "bad_message", message: summarize(r.error) };
    }
    case "watch":
      return { ok: true, msg: { type: "watch" } };
    case "leave": {
      const r = LeaveSchema.safeParse(data);
      return r.success ? { ok: true, msg: r.data } : { ok: false, code: "bad_message", message: summarize(r.error) };
    }
    case "intent": {
      const r = IntentMsgSchema.safeParse(data);
      if (!r.success) return { ok: false, code: "bad_message", message: summarize(r.error) };
      const i = IntentSchema.safeParse(r.data.intent);
      if (!i.success) return { ok: false, code: "bad_intent", message: summarize(i.error), match_id: r.data.match_id };
      return { ok: true, msg: { type: "intent", match_id: r.data.match_id, tick: r.data.tick, intent: i.data as Intent } };
    }
    default:
      return { ok: false, code: "bad_message", message: "unknown or missing message type" };
  }
}

/** Parse an intent value, returning null if malformed. */
export function parseIntent(x: unknown): Intent | null {
  const r = IntentSchema.safeParse(x);
  return r.success ? (r.data as Intent) : null;
}

function summarize(e: z.ZodError): string {
  const first = e.issues[0];
  if (!first) return "invalid message";
  const path = first.path.join(".");
  return `${path ? path + ": " : ""}${first.message}`.slice(0, 200);
}
