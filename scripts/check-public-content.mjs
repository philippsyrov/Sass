#!/usr/bin/env node
// Checks tracked index and working-tree text, not Git history or untracked files.
// Tracked private paths are rejected without reading their contents.
// An optional local Git info/public-content-denylist.json contains an array of
// exact private strings; its contents and all matched values stay out of output.
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const homePath = /(?:\/Users\/|\/home\/)[^\s/\\"'`]+|[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}[^\s/\\"'`]+/g;
const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const number = /(?<![A-Za-z0-9])[0-9]{17,20}(?![A-Za-z0-9])/g;

function syntheticNumber(value) {
  if (/^(\d)\1+$/.test(value) || /^10{14,}\d{0,5}$/.test(value)) return true;
  return [...value].every((digit, i) => i === 0 || Number(digit) === (Number(value[i - 1]) + 1) % 10)
    || [...value].every((digit, i) => i === 0 || Number(digit) === (Number(value[i - 1]) + 9) % 10);
}

function allowedEmail(value) {
  const domain = value.slice(value.lastIndexOf('@') + 1).toLowerCase();
  return domain === 'users.noreply.github.com' || domain === 'noreply.github.com'
    || /^(?:[^.]+\.)*example\.(?:com|org|net|test)$/.test(domain)
    || domain.endsWith('.invalid');
}

export function scanText(text, file, denylist = []) {
  const findings = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const add = (category) => findings.push({ category, file, line: index + 1 });
    if (homePath.test(line)) add('home path');
    homePath.lastIndex = 0;
    const legalNotice = /(?:^|\/)(?:LICENSE|LICENCE|NOTICE|THIRD_PARTY_NOTICES)(?:\.|$)/i.test(file)
      && /copyright/i.test(line);
    if (!legalNotice && [...line.matchAll(email)].some((match) => !allowedEmail(match[0]))) add('email');
    if ([...line.matchAll(number)].some((match) => !syntheticNumber(match[0]))) add('numeric identifier');
    if (denylist.some((value) => value && line.includes(value))) add('private denylist');
  }
  return findings;
}

function privatePath(file) {
  const parts = file.split('/');
  const name = basename(file);
  return parts.some((part) => part === 'data' || part === '.sass-data' || part === 'node_modules' || part === '.release-work')
    || (name.startsWith('.env') && name !== '.env.example');
}

function main() {
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    const rawPath = execFileSync('git', ['rev-parse', '--git-path', 'info/public-content-denylist.json'], { cwd: root, encoding: 'utf8' }).trim();
    const denylistPath = isAbsolute(rawPath) ? rawPath : resolve(root, rawPath);
    let denylist = [];
    try {
      denylist = JSON.parse(readFileSync(denylistPath, 'utf8'));
      if (!Array.isArray(denylist) || denylist.some((v) => typeof v !== 'string' || !v)) throw new Error('invalid denylist');
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Invalid or unreadable private denylist');
    }
    const entries = execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: root })
      .toString('utf8').split('\0').filter(Boolean).map((entry) => {
        const match = /^(\d+) ([0-9a-f]+) (\d)\t([\s\S]+)$/.exec(entry);
        if (!match) throw new Error('Invalid index entry');
        return { mode: match[1], object: match[2], file: match[4] };
      });
    const findings = new Map();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const record = (finding) => findings.set(JSON.stringify(finding), finding);
    const inspect = (bytes, file) => {
      if (bytes.includes(0)) return;
      let text;
      try { text = decoder.decode(bytes); } catch { return; }
      for (const finding of scanText(text, file, denylist)) record(finding);
    };
    const workingFiles = new Set();
    for (const { mode, object, file } of entries) {
      if (privatePath(file)) {
        record({ category: 'tracked private path', file, line: 1 });
        continue;
      }
      if (mode !== '100644' && mode !== '100755') continue;
      // Check every index stage; a clean working copy must not hide a staged leak.
      inspect(execFileSync('git', ['cat-file', 'blob', object], { cwd: root, maxBuffer: 64 * 1024 * 1024 }), file);
      if (workingFiles.has(file)) continue;
      workingFiles.add(file);
      let bytes;
      try {
        if (lstatSync(join(root, file)).isSymbolicLink()) continue;
        bytes = readFileSync(join(root, file));
      } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      inspect(bytes, file);
    }
    for (const finding of findings.values()) console.error(`${finding.category}: ${finding.file}:${finding.line}`);
    if (findings.size) {
      console.error('Public content check failed. Review the reported locations.');
      process.exitCode = 1;
    } else console.log('Public content check passed.');
  } catch {
    // Never echo errors that might contain paths or denylist contents.
    console.error('Public content check could not run; check Git and the private denylist.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
