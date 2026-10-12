/**
 * The wire client is two parts with a small interface between them:
 *
 * - `transport.ts`: the socket, HELLO, fragments, keyframes and deltas, acks, RESYNC, PING and the timing of every
 *   tick, with the five hooks you are expected to replace (`onPacket`, `shouldResync`, `predictState`, `planMoves`,
 *   `onTick`);
 * - your bot: `decide(state)` returning a move. `starter.ts` is the one we ship.
 *
 * `WireClient` is the old name of `Transport`, kept so existing code still runs.
 */
export { Transport as WireClient, ClientError, type Bot, type ClientOptions, type MatchSummary } from "./transport.js";
