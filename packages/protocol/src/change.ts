/**
 * The change (SPEC 2.2): one of three, drawn per cohort. The official run plays with it. It is revealed to a candidate
 * the first time they open the Official page (or start the official run), then shown on every page, by email, and in
 * `HELLO_ACK.rule_change`. The words every surface shows for it, and the simulator flags that play it.
 */
export const RULE_CHANGE_IDS = [1, 2, 3] as const;
export type RuleChangeId = (typeof RULE_CHANGE_IDS)[number];

export interface RuleChangeText {
  id: RuleChangeId;
  /** The one rule, in large type. */
  rule: string;
  /** One line on what it means for your bot. */
  meaning: string;
  /** The simulator flags that play it (SPEC 2.2), so you can try it before the official run. */
  flags: string;
}

export const RULE_CHANGES: Readonly<Record<RuleChangeId, RuleChangeText>> = {
  1: {
    id: 1,
    rule: "Errands now post every 3 ticks instead of 6. They expire 20 to 45 ticks after they post, instead of 30 to 70.",
    meaning: "More errands, shorter lives. Read post_interval, expiry_min and expiry_max from the match start.",
    flags: "--post-interval 3 --expiry 20:45",
  },
  2: {
    id: 2,
    rule: "A snatch now costs 50 energy instead of 100, and energy regenerates 2 per tick instead of 1.",
    meaning: "Maria can snatch about 4 times as often. So can you. Read snatch_cost and regen from the match start.",
    flags: "--snatch-cost 50 --regen 2",
  },
  3: {
    id: 3,
    rule: "The Master network profile now applies to every tier.",
    meaning: "Every match on the wire now loses 1 packet in 10 each way and goes silent once for 400 ms. The match start says which network a match is on.",
    flags: "--chaos master",
  },
};

export const isRuleChangeId = (n: unknown): n is RuleChangeId => n === 1 || n === 2 || n === 3;
