import React, { useEffect, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { wrapPlain } from '../wrap.js';
import { setupMascotLines } from '../mascotCompact.js';
import {
  getInkMessages,
  getInkPrompt,
  getInkStep,
  registerInkRerender,
  submitInkPrompt,
} from './prompterBridge.js';

const TOTAL_STEPS = 5;

function progressDots(step: number): string {
  const filled = '•'.repeat(Math.min(TOTAL_STEPS, Math.max(0, step)));
  const empty = '○'.repeat(Math.max(0, TOTAL_STEPS - filled.length));
  return `${filled}${empty}`;
}

export function SetupView({ onCancel }: { onCancel?: () => void } = {}): React.ReactElement {
  const [, bump] = useState(0);
  const { stdout } = useStdout();
  const rows = Math.max(8, (stdout?.rows ?? 24) - 1);
  const cols = Math.max(20, (stdout?.columns ?? 80) - 1);
  const [historyOffset, setHistoryOffset] = useState(0);
  useEffect(() => {
    const resize = () => bump(n => n + 1);
    stdout?.on('resize', resize);
    return () => { stdout?.off('resize', resize); };
  }, [stdout]);

  useEffect(() => {
    registerInkRerender(() => bump((n) => n + 1));
    bump((n) => n + 1);
    return () => registerInkRerender(() => {});
  }, []);

  const prompt = getInkPrompt();
  const messages = getInkMessages();
  const { step, title } = getInkStep();
  const mascot = setupMascotLines();

  const [input, setInput] = useState('');
  const [selectIdx, setSelectIdx] = useState(0);

  useEffect(() => {
    if (prompt?.kind === 'select') setSelectIdx(prompt.defaultIndex);
    setInput('');
    setHistoryOffset(0);
  }, [prompt?.id]);

  useInput((char, key) => {
    if (key.ctrl && char === 'c') {
      onCancel?.();
      return;
    }
    if (cols < 79 || rows < 23) return;
    if (key.pageUp) { setHistoryOffset(i => Math.min(Math.max(0, messageLines.length - maxDone), i + 3)); return; }
    if (key.pageDown) { setHistoryOffset(i => Math.max(0, i - 3)); return; }
    if (!prompt) return;
    if (prompt.kind === 'action') { if (key.return) submitInkPrompt(prompt.id, true); return; }
    if (prompt.kind === 'confirm') {
      if (key.return) submitInkPrompt(prompt.id, prompt.defaultYes);
      else if (char === 'y' || char === 'Y') submitInkPrompt(prompt.id, true);
      if (char === 'n' || char === 'N') submitInkPrompt(prompt.id, false);
      return;
    }
    if (prompt.kind === 'select') {
      if (key.upArrow) setSelectIdx((i) => Math.max(0, i - 1));
      if (key.downArrow) setSelectIdx((i) => Math.min(prompt.options.length - 1, i + 1));
      if (key.return) submitInkPrompt(prompt.id, selectIdx);
    }
  });

  const contentWidth = Math.max(20, cols - 48);
  const question = prompt
    ? `${prompt.message}${prompt.kind === 'confirm' ? (prompt.defaultYes ? ' (Y/n)' : ' (y/N)') : ''}`
    : 'Working…';
  const questionLines = wrapPlain(question, '', contentWidth).flatMap(line => {
    const chunks: string[] = [];
    for (let i = 0; i < line.length; i += contentWidth) chunks.push(line.slice(i, i + contentWidth));
    return chunks;
  });
  const questionHeight = questionLines.length;
  const optionRows = Math.max(1, rows - 7 - questionHeight);
  const optionCount = prompt?.kind === 'select' ? Math.min(prompt.options.length, optionRows) : 0;
  const optionStart = prompt?.kind === 'select'
    ? Math.max(0, Math.min(selectIdx - Math.floor(optionCount / 2), prompt.options.length - optionCount))
    : 0;
  const promptRows = questionHeight + (prompt?.kind === 'select' ? optionCount + 1 : prompt?.kind === 'text' ? 1 : 0);
  const maxDone = Math.max(0, rows - promptRows - 6);
  const messageLines = messages.flatMap(line => wrapPlain(line, '', contentWidth));
  const messageEnd = Math.max(maxDone, messageLines.length - historyOffset);
  const visibleMessages = maxDone ? messageLines.slice(Math.max(0, messageEnd - maxDone), messageEnd) : [];

  if (cols < 79 || rows < 23) {
    return <Box flexDirection="column" width={cols} height={rows} overflow="hidden">
      <Text>Sass · Discord roast bot</Text>
      <Text>Resize to at least 80 columns by 24 rows. Ctrl+C quits.</Text>
    </Box>;
  }

  return (
    <Box flexDirection="row" width={cols} height={rows} overflow="hidden">
      <Box flexDirection="column" width={45} height={23} marginRight={3} flexShrink={0}>
        {mascot.map((line, i) => <Text key={i}>{line}</Text>)}
      </Box>
      <Box flexDirection="column" width={contentWidth} height={rows} overflow="hidden">
        <Text bold wrap="truncate-end">Sass · Discord roast bot</Text>
        <Text wrap="truncate-end">Step {step}/{TOTAL_STEPS} · {title} {progressDots(step)}</Text>
        <Text dimColor>PageUp/PageDown: details</Text>
        <Box flexDirection="column" marginTop={1} height={maxDone} overflow="hidden">
          {visibleMessages.map((line, i) => <Text key={i} dimColor>{line}</Text>)}
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {questionLines.map((line, i) => <Text key={i} color="cyan">{line}</Text>)}
          {prompt?.kind === 'text' && <Box height={1} overflow="hidden">
            <TextInput
              value={input}
              onChange={setInput}
              mask={prompt.secret ? '•' : undefined}
              placeholder={prompt.fallback ? (prompt.secret ? '(Enter = keep current)' : '(Enter = keep value)') : ''}
              onSubmit={value => submitInkPrompt(prompt.id, value)}
            />
          </Box>}
          {prompt?.kind === 'select' && <Box flexDirection="column">
            {prompt.options.slice(optionStart, optionStart + optionCount).map((opt, i) => (
              <Text key={optionStart + i} wrap="truncate-end" color={optionStart + i === selectIdx ? 'cyan' : undefined}>
                {optionStart + i === selectIdx ? '❯ ' : '  '}{opt}
              </Text>
            ))}
            {prompt.options.length > optionCount && <Text dimColor>{selectIdx + 1}/{prompt.options.length} · ↑/↓ choose</Text>}
          </Box>}
        </Box>
      </Box>
    </Box>
  );
}
