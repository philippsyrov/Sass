import { register } from 'node:module';
import { ApplicationFlags } from 'discord.js';
register(new URL('./local-setup-loader.mjs', import.meta.url));
globalThis.fetch = async url => {
  if (String(url).endsWith('/applications/@me')) return new Response(JSON.stringify({ id:'123456789012345678',name:'synthetic bot',owner:{id:'234567890123456789'},flags:ApplicationFlags.GatewayPresenceLimited|ApplicationFlags.GatewayMessageContentLimited }), { status:200 });
  throw new Error('Network disabled in normal setup test');
};
