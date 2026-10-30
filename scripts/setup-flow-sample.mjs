#!/usr/bin/env node
/**
 * Plain-text preview of the Anthropic setup path at a fixed terminal width (for docs/QA).
 */
import { wrapPlain } from '../dist/setup/wrap.js';

const WIDTH = 80;
const indent = '  ';

function section(title) {
  console.log('');
  console.log(`${indent}${title}`);
  console.log('');
}

function line(text) {
  for (const l of wrapPlain(text, indent, WIDTH)) console.log(l);
}

console.log(`${indent}Sass · Discord roast bot — setup (Anthropic path preview @ ${WIDTH} cols)`);
section('Step 1 of 5 · Discord bot');
line('Sass needs a Discord bot app and your personal Discord user ID.');
line('Application ID — the number Discord shows for your app.');
console.log(`${indent}  Get it: Open Application ID (hyperlink)`);
console.log(`${indent}◆  Application ID (CLIENT_ID)`);
console.log(`${indent}◆  Bot token (DISCORD_TOKEN) — masked`);
console.log(`${indent}◆  Your Discord user ID (CREATOR_ID)`);

section('Step 2 of 5 · AI model');
console.log(`${indent}◆  Who powers Sass's replies?`);
console.log(`${indent}   Recommended · best Sass`);
console.log(`${indent}   ❯ Anthropic (Claude)`);
console.log(`${indent}   OpenAI`);
console.log(`${indent}   …`);
console.log(`${indent}   Lite · free & private`);
console.log(`${indent}◆  Anthropic API key for chat.`);
console.log(`${indent}  Get it: Create API key (console.anthropic.com)`);
console.log(`${indent}◆  Chat model (OPENAI_MODEL)`);

section('Step 3 of 5 · Memory (database)');
line('Default: local Postgres in .sass-data/ on this machine.');
console.log(`${indent}◆  How should Postgres run?`);
console.log(`${indent}◆  How should memory embeddings run? (Ollama local or OpenAI key)`);

section('Summary');
line('Chat: Anthropic — messages go to api.anthropic.com');
line('Embeddings: local Ollama or OpenAI — depending on memory step');
line('Memory DB: this machine (.sass-data/)');
console.log(`${indent}Next:    sass start`);
console.log(`${indent}Stop:    Ctrl+C`);
console.log(`${indent}Remove:  sass uninstall`);
