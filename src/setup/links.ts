import { hyperlink } from './terminal.js';

export const DISCORD_APPLICATIONS_URL = 'https://discord.com/developers/applications';

export function discordApplicationsLink(): string {
  return hyperlink(DISCORD_APPLICATIONS_URL, 'Discord Developer Portal — Applications');
}

export function discordAppInformationUrl(clientId: string): string {
  return `https://discord.com/developers/applications/${clientId}/information`;
}

export function discordAppBotUrl(clientId: string): string {
  return `https://discord.com/developers/applications/${clientId}/bot`;
}

export function discordAppInformationLink(clientId: string): string {
  return hyperlink(discordAppInformationUrl(clientId), 'Application → General Information');
}

export function discordAppBotLink(clientId: string): string {
  return hyperlink(discordAppBotUrl(clientId), 'Application → Bot');
}

const PROVIDER_KEY_URL: Record<string, string> = {
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  openrouter: 'https://openrouter.ai/keys',
  groq: 'https://console.groq.com/keys',
  xai: 'https://console.x.ai/',
  together: 'https://api.together.xyz/settings/api-keys',
};

export function ollamaDownloadPageLink(): string {
  return hyperlink('https://ollama.com/download', 'ollama.com/download');
}

export function providerKeyUrl(providerKey: string): string | undefined {
  return PROVIDER_KEY_URL[providerKey];
}

export function providerKeyLink(providerKey: string): string | undefined {
  const url = providerKeyUrl(providerKey);
  return url ? hyperlink(url) : undefined;
}

export function ollamaDownloadLink(): string {
  return hyperlink('https://ollama.com', 'ollama.com');
}
