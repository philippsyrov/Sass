export function isReasoningChatModel(model: string): boolean {
  const name = model.split('/').at(-1) ?? model;
  return !name.includes('chat-latest') && /^(?:gpt-[56](?:[.-]|$)|o[134](?:-|$))/.test(name);
}

export function replyTokenBudget(model: string, anthropic: boolean, requested?: number, config: NodeJS.ProcessEnv = process.env): number {
  const reasoning = anthropic || /(?:^|\/)claude-/.test(model) || isReasoningChatModel(model);
  const normal = reasoning ? Math.max(requested ?? 0, 16384) : requested ?? 4096;
  const configured = config.SASS_REPLY_MAX_TOKENS?.trim();
  if (!configured) return normal;
  const limit = Number(configured);
  if (!/^\d+$/.test(configured) || !Number.isSafeInteger(limit) || limit < 64 || limit > 131072) {
    throw new Error('SASS_REPLY_MAX_TOKENS must be an integer between 64 and 131072');
  }
  return reasoning || requested === undefined ? limit : Math.min(requested, limit);
}
