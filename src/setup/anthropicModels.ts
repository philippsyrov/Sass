/**
 * Pick a default Claude chat model from Anthropic's model list.
 * @see https://docs.claude.com/en/docs/about-claude/models/overview
 */

/** Newest Sonnet alias when /v1/models is unavailable (Oct 2026 docs). */
export const DEFAULT_ANTHROPIC_SONNET_MODEL = 'claude-sonnet-5-5';

type ParsedClaudeId = {
  tier: 'sonnet' | 'opus' | 'haiku' | 'fable' | 'other';
  major: number;
  minor: number;
  /** YYYYMMDD snapshot, or 0 for dateless alias IDs. */
  snapshot: number;
};

function parseClaudeModelId(id: string): ParsedClaudeId {
  const lower = id.toLowerCase();
  const tierMatch = /claude-(sonnet|opus|haiku|fable)/.exec(lower);
  const tier = (tierMatch?.[1] as ParsedClaudeId['tier']) ?? 'other';

  // claude-sonnet-5-5, claude-sonnet-4-5-20250929, claude-sonnet-4-20250514
  const version = /^claude-(?:sonnet|opus|haiku|fable)-(\d+)(?:-(\d+))?(?:-(\d{8}))?$/i.exec(id);
  if (!version) {
    return { tier, major: 0, minor: 0, snapshot: 0 };
  }
  const major = Number(version[1]);
  const second = version[2];
  const third = version[3];
  if (third) {
    return { tier, major, minor: Number(second), snapshot: Number(third) };
  }
  if (second && second.length === 8 && /^\d{8}$/.test(second)) {
    return { tier, major, minor: 0, snapshot: Number(second) };
  }
  if (second) {
    return { tier, major, minor: Number(second), snapshot: 0 };
  }
  return { tier, major, minor: 0, snapshot: 0 };
}

/** Higher = newer / preferred for default Sonnet pick. */
export function anthropicModelSortKey(id: string): bigint {
  const p = parseClaudeModelId(id);
  const tierBoost = p.tier === 'sonnet' ? 1n : 0n;
  const snapshotScore = p.snapshot === 0 ? 99999999n : BigInt(p.snapshot);
  return tierBoost * 10_000_000_000_000_000n
    + BigInt(p.major) * 1_000_000_000_000n
    + BigInt(p.minor) * 1_000_000_000n
    + snapshotScore;
}

export function pickDefaultAnthropicModel(ids: string[]): string | undefined {
  if (ids.length === 0) return undefined;
  const sonnet = ids.filter((id) => /sonnet/i.test(id));
  const pool = sonnet.length > 0 ? sonnet : ids;
  const sorted = [...pool].sort((a, b) => {
    const diff = anthropicModelSortKey(b) - anthropicModelSortKey(a);
    if (diff > 0n) return 1;
    if (diff < 0n) return -1;
    return b.localeCompare(a);
  });
  return sorted[0];
}

export function sortAnthropicModelsForSelect(ids: string[]): string[] {
  const sonnet = ids.filter((id) => /sonnet/i.test(id));
  const opus = ids.filter((id) => /opus/i.test(id));
  const haiku = ids.filter((id) => /haiku/i.test(id));
  const rest = ids.filter((id) => !sonnet.includes(id) && !opus.includes(id) && !haiku.includes(id));
  const byKey = (list: string[]) => [...list].sort((a, b) => {
    const diff = anthropicModelSortKey(b) - anthropicModelSortKey(a);
    if (diff > 0n) return 1;
    if (diff < 0n) return -1;
    return b.localeCompare(a);
  });
  const bucket = [...byKey(sonnet), ...byKey(opus), ...byKey(haiku), ...byKey(rest)];
  return bucket.length > 0 ? bucket : byKey([...ids]);
}
