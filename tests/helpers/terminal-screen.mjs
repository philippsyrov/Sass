// Small VT screen model for the cursor and erase sequences emitted by Bash and Ink.
export function terminalScreen(output, columns = 80, rows = 24) {
  let row = 0, col = 0, active = false, scrolls = 0;
  let cells = Array.from({ length: rows }, () => Array(columns).fill(' '));
  let lastScreen = '';
  function down() {
    row++;
    if (row >= rows) {
      if (active) scrolls++;
      cells.shift(); cells.push(Array(columns).fill(' ')); row = rows - 1;
    }
  }
  for (const token of output.matchAll(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][\s\S]*?(?:\x07|\x1b\\)|[\s\S]/gu)) {
    const value = token[0];
    if (value.startsWith('\x1b[')) {
      const command = value.at(-1);
      const raw = value.slice(2, -1);
      const params = raw.split(';').map(Number);
      const amount = params[0] || 1;
      if (raw === '?1049' && command === 'h') { active = true; row = col = 0; cells = Array.from({ length: rows }, () => Array(columns).fill(' ')); }
      else if (raw === '?1049' && command === 'l') { lastScreen = cells.map(line => line.join('').trimEnd()).join('\n'); active = false; }
      else if (command === 'H' || command === 'f') { row = Math.min(rows - 1, Math.max(0, (params[0] || 1) - 1)); col = Math.min(columns - 1, Math.max(0, (params[1] || 1) - 1)); }
      else if (command === 'A') row = Math.max(0, row - amount);
      else if (command === 'B') row = Math.min(rows - 1, row + amount);
      else if (command === 'C') col = Math.min(columns - 1, col + amount);
      else if (command === 'D') col = Math.max(0, col - amount);
      else if (command === 'G') col = Math.min(columns - 1, amount - 1);
      else if (command === 'E') { row = Math.min(rows - 1, row + amount); col = 0; }
      else if (command === 'F') { row = Math.max(0, row - amount); col = 0; }
      else if (command === 'J' && params[0] === 2) cells = Array.from({ length: rows }, () => Array(columns).fill(' '));
      else if (command === 'K') {
        const start = params[0] === 1 || params[0] === 2 ? 0 : col;
        const end = params[0] === 1 ? col + 1 : columns;
        cells[row].fill(' ', start, end);
      }
      continue;
    }
    if (value.startsWith('\x1b]')) continue;
    if (value === '\r') { col = 0; continue; }
    if (value === '\n') { down(); continue; }
    if (value === '\b') { col = Math.max(0, col - 1); continue; }
    if (value.charCodeAt(0) < 32) continue;
    if (col >= columns) { col = 0; down(); }
    cells[row][col++] = value;
  }
  return { screen: cells.map(line => line.join('').trimEnd()).join('\n'), lastScreen, scrolls };
}
