type RoleMembership = { has(id: string): boolean } | undefined;

function addressesSass(kind: string, id: string, botId: string, roles: RoleMembership, guildId?: string): boolean {
  return kind === '&' ? id !== guildId && !!roles?.has(id) : id === botId;
}

/** Account mentions and explicit role tags containing Sass, excluding everyone. */
export function mentionsSass(content: string, botId: string, roles?: RoleMembership, guildId?: string): boolean {
  return [...content.matchAll(/<@([!&]?)(\d+)>/g)].some((match) =>
    addressesSass(match[1] ?? '', match[2] ?? '', botId, roles, guildId));
}

/** Preserve other user IDs for commands that target a person. */
export function stripSassMentions(content: string, botId: string, roles?: RoleMembership, guildId?: string): string {
  return content.replace(/<@([!&]?)(\d+)>/g, (raw, kind: string, id: string) =>
    addressesSass(kind, id, botId, roles, guildId) ? '' : raw).trim();
}

/** Commands keep every target after the leading address, including Sass herself. */
export function stripSassCommandAddress(content: string, botId: string, roles?: RoleMembership, guildId?: string): string {
  let remaining = content.trim();
  for (;;) {
    const match = /^<@([!&]?)(\d+)>\s*/.exec(remaining);
    if (!match || !addressesSass(match[1] ?? '', match[2] ?? '', botId, roles, guildId)) break;
    remaining = remaining.slice(match[0].length);
  }
  const target = /^(?:remember|roast)\s+(<@!?\d+>)/i.exec(remaining);
  const targetOffset = target?.[1] ? target[0].length - target[1].length : -1;
  const ship = /^ship\s+(?:<@!?\d+>\s*)+/i.exec(remaining);
  return remaining.replace(/<@([!&]?)(\d+)>/g, (raw, kind: string, id: string, offset: number) => {
    if (!addressesSass(kind, id, botId, roles, guildId)) return raw;
    if (kind !== '&' && (offset === targetOffset || (ship && offset < ship[0].length))) return raw;
    return '';
  }).trim();
}
