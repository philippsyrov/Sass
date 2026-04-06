/**
 * shipImage.ts — Generate ship card images using affinity-tiered templates
 *
 * Renders the template as a full background, then draws avatars on top
 * at per-template circle positions. All ship info rendered on the card —
 * user names, ship name, %, tier, and verdict. Embed is image-only.
 *
 * Template images are 1024×1536 but we crop to 1024×1050 for a wider
 * aspect ratio that displays well in Discord embeds on desktop.
 */

import { createCanvas, loadImage, registerFont } from 'canvas';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Register bundled font before any canvas creation
const fontPath = join(__dirname, '..', 'assets', 'fonts', 'Nunito-Bold.ttf');
try {
  registerFont(fontPath, { family: 'ShipFont' });
} catch (err) {
  console.error('Font registration failed:', (err as Error).message);
}

// Template source dimensions
const TEMPLATE_WIDTH = 1024;
const TEMPLATE_HEIGHT = 1536;

// Canvas output dimensions — cropped for wider Discord display
const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 1050;

// Text layout
const CENTER_X = CANVAS_WIDTH / 2;

/**
 * Per-template configuration — circle positions differ between templates
 * because the AI-generated images have circles in slightly different spots.
 */
// Shared avatar layout — identical across all templates (canvas coordinates)
const AVATAR1_CX = 172;
const AVATAR2_CX = 853;
const AVATAR_CY = 324;    // sakura: 628 + (-304) = 324, locked
const AVATAR_RADIUS = 153;

interface TemplateConfig {
  path: string;
  offsetY: number;       // Only moves the background image, not avatars
  accentColor: string;   // Stats text color (pink for sakura, icy blue for storm)
  barColor: string;      // Affinity bar fill color
}

const TEMPLATES: Record<string, TemplateConfig> = {
  sakura: {
    path: join(__dirname, '..', 'assets', 'ship-sakura.png'),
    offsetY: -304,
    accentColor: '#ff8fab',
    barColor: '#ff6b9d',
  },
  storm: {
    path: join(__dirname, '..', 'assets', 'ship-storm.png'),
    offsetY: -340,
    accentColor: '#8bb8d0',
    barColor: '#5a8fa8',
  },
};

function getTemplate(score: number): TemplateConfig {
  const key = score >= 30 ? 'sakura' : 'storm';
  const config = TEMPLATES[key];
  if (!config) throw new Error(`Missing template config for key: ${key}`);
  return config;
}

export interface ShipCardOptions {
  avatarUrl1: string;
  avatarUrl2: string;
  percent: number;
  displayName1: string;
  displayName2: string;
  shipName?: string;
  tierLabel?: string;
  verdict?: string;
}

/**
 * Generate a ship card with all info rendered on the image.
 * Returns a PNG buffer ready to attach to a Discord message.
 */
export async function generateShipImage(opts: ShipCardOptions): Promise<Buffer> {
  const { avatarUrl1, avatarUrl2, percent, displayName1, displayName2, shipName, tierLabel, verdict } = opts;
  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const ctx = canvas.getContext('2d');

  const tmpl = getTemplate(percent);

  // Load template and avatars in parallel
  const [template, img1, img2] = await Promise.all([
    loadImage(tmpl.path).catch((err) => { console.error('Template load failed:', (err as Error).message); return null; }),
    loadImage(avatarUrl1).catch((err) => { console.error('Avatar 1 load failed:', (err as Error).message); return null; }),
    loadImage(avatarUrl2).catch((err) => { console.error('Avatar 2 load failed:', (err as Error).message); return null; }),
  ]);

  // Step 1: Draw template shifted up so avatar area is centered in cropped canvas
  if (template) {
    ctx.drawImage(template, 0, tmpl.offsetY, TEMPLATE_WIDTH, TEMPLATE_HEIGHT);
  } else {
    ctx.fillStyle = '#1a0a12';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  // Step 2: Draw avatars clipped to circles on top of template
  drawCircularAvatar(ctx, img1, AVATAR1_CX, AVATAR_CY, AVATAR_RADIUS);
  drawCircularAvatar(ctx, img2, AVATAR2_CX, AVATAR_CY, AVATAR_RADIUS);

  // Step 3: User display names under each avatar (with dark glow for readability)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 36px ShipFont';
  const nameY = AVATAR_CY + AVATAR_RADIUS + 38;
  drawTextWithGlow(ctx, displayName1, AVATAR1_CX, nameY, '#ffffff');
  drawTextWithGlow(ctx, displayName2, AVATAR2_CX, nameY, '#ffffff');

  // Step 4: Dark overlay strip for bottom text
  const overlayTop = CANVAS_HEIGHT - 280;
  const gradient = ctx.createLinearGradient(0, overlayTop, 0, CANVAS_HEIGHT);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(0.25, 'rgba(0,0,0,0.6)');
  gradient.addColorStop(1, 'rgba(0,0,0,0.9)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, overlayTop, CANVAS_WIDTH, CANVAS_HEIGHT - overlayTop);

  // Step 5: Affinity bar (drawn, not emoji — canvas can't render emoji)
  const barY = 770;
  const barWidth = 340;
  const barHeight = 12;
  const barX = CENTER_X - barWidth / 2;
  const fillWidth = (percent / 100) * barWidth;

  // Dark outline for visibility
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  roundRect(ctx, barX - 2, barY - 2, barWidth + 4, barHeight + 4, 6);
  // Background bar
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  roundRect(ctx, barX, barY, barWidth, barHeight, 5);
  // Filled portion
  ctx.fillStyle = tmpl.barColor;
  if (fillWidth > 0) {
    roundRect(ctx, barX, barY, fillWidth, barHeight, 5);
  }

  // Step 6: Ship name
  if (shipName) {
    ctx.font = 'bold 64px ShipFont';
    drawTextWithShadow(ctx, shipName, CENTER_X, 825, '#ffffff');
  }

  // Percentage and tier on same line
  ctx.font = 'bold 54px ShipFont';
  const statsLine = tierLabel ? `${percent}%  \u00b7  ${tierLabel}` : `${percent}%`;
  drawTextWithShadow(ctx, statsLine, CENTER_X, 900, tmpl.accentColor);

  // Step 7: Verdict text in quotes
  if (verdict) {
    ctx.font = 'bold 34px ShipFont';
    const quotedVerdict = `"${verdict}"`;
    const maxWidth = CANVAS_WIDTH - 60;
    const lines = wrapText(ctx, quotedVerdict, maxWidth);
    const verdictStartY = 965;
    for (let i = 0; i < lines.length && i < 2; i++) {
      drawTextWithShadow(ctx, lines[i] ?? '', CENTER_X, verdictStartY + i * 42, 'rgba(255,255,255,0.85)');
    }
  }

  return canvas.toBuffer('image/png');
}

/**
 * Draw a filled rounded rectangle.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function roundRect(ctx: any, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
}

/**
 * Draw text with a subtle drop shadow.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawTextWithShadow(ctx: any, text: string, x: number, y: number, color: string): void {
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillText(text, x + 2, y + 2);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/**
 * Draw text with a dark glow for readability on busy backgrounds.
 * Draws black text at multiple offsets to create a soft outline/glow.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawTextWithGlow(ctx: any, text: string, x: number, y: number, color: string): void {
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  for (const dx of [-3, -2, -1, 0, 1, 2, 3]) {
    for (const dy of [-2, -1, 0, 1, 2, 3]) {
      ctx.fillText(text, x + dx, y + dy);
    }
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/**
 * Wrap text to fit within maxWidth, returning an array of lines.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapText(ctx: any, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

/**
 * Draw an avatar clipped to a circle.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawCircularAvatar(ctx: any, img: any, cx: number, cy: number, radius: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  if (img) {
    ctx.drawImage(img, cx - radius, cy - radius, radius * 2, radius * 2);
  } else {
    ctx.fillStyle = '#F0D0E0';
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }
  ctx.restore();
}
