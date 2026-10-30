/** Pick a sensible default chat model from an OpenAI-compatible /models list. */

export function pickDefaultOpenAIModel(ids: string[]): string | undefined {
  if (ids.length === 0) return undefined;
  const preferred = [
    /gpt-4o-mini/i,
    /gpt-4\.1-mini/i,
    /gpt-4o(?!-mini)/i,
    /gpt-4/i,
  ];
  for (const re of preferred) {
    const hit = ids.find((id) => re.test(id));
    if (hit) return hit;
  }
  return [...ids].sort().reverse()[0];
}
