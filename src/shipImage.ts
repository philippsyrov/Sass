/**
 * shipImage.ts — Generate ship card images using affinity-tiered templates
 *
 * Renders the template as a full background, then draws avatars on top
 * at hardcoded circle positions. All ship info rendered on the card —
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

// How far down we offset the template (negative = shift template up to show the right section)
// We want to show the avatar area (centered ~y=650 in the template) in our cropped canvas
const TEMPLATE_OFFSET_Y = -200;

// Avatar circle positions (relative to the cropped canvas)
const AVATAR1_CX = 178;
const AVATAR1_CY = 650 + TEMPLATE_OFFSET_Y;  // 450 in canvas space
const AVATAR1_RADIUS = 160;
const AVATAR2_CX = 845;
const AVATAR2_CY = 650 + TEMPLATE_OFFSET_Y;  // 450 in canvas space
const AVATAR2_RADIUS = 160;

// Text layout
const CENTER_X = CANVAS_WIDTH / 2;

/**
 * Pick template path based on ship score.
 * Add more tiers here as new templates are created.
 */
function getTemplatePath(score: number): string {
  if (score >= 50) {
    return join(__dirname, '..', 'assets', 'ship-sakura.png');
  }
  return join(__dirname, '..', 'assets', 'ship-storm.png');
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

  const templatePath = getTemplatePath(percent);

  // Load template and avatars in parallel
  const [template, img1, img2] = await Promise.all([
    loadImage(templatePath).catch((err) => { console.error('Template load failed:', (err as Error).message); return null; }),
    loadImage(avatarUrl1).catch((err) => { console.error('Avatar 1 load failed:', (err as Error).message); return null; }),
    loadImage(avatarUrl2).catch((err) => { console.error('Avatar 2 load failed:', (err as Error).message); return null; }),
  ]);

  // Step 1: Draw template shifted up so avatar area is centered in cropped canvas
  if (template) {
    ctx.drawImage(template, 0, TEMPLATE_OFFSET_Y, TEMPLATE_WIDTH, TEMPLATE_HEIGHT);
  } else {
    ctx.fillStyle = '#1a0a12';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  // Step 2: Draw avatars clipped to circles on top of template
  drawCircularAvatar(ctx, img1, AVATAR1_CX, AVATAR1_CY, AVATAR1_RADIUS);
  drawCircularAvatar(ctx, img2, AVATAR2_CX, AVATAR2_CY, AVATAR2_RADIUS);

  // Step 3: User display names under each avatar
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 32px ShipFont';
  drawTextWithShadow(ctx, displayName1, AVATAR1_CX, AVATAR1_CY + AVATAR1_RADIUS + 35, '#ffffff');
  drawTextWithShadow(ctx, displayName2, AVATAR2_CX, AVATAR2_CY + AVATAR2_RADIUS + 35, '#ffffff');

  // Step 4: Dark overlay strip for bottom text
  const overlayTop = CANVAS_HEIGHT - 300;
  const gradient = ctx.createLinearGradient(0, overlayTop, 0, CANVAS_HEIGHT);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(0.25, 'rgba(0,0,0,0.6)');
  gradient.addColorStop(1, 'rgba(0,0,0,0.9)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, overlayTop, CANVAS_WIDTH, CANVAS_HEIGHT - overlayTop);

  // Step 5: Hearts bar
  const heartsY = 800;
  const filledHearts = Math.round(percent / 10);
  const heartsText = '\u2764\uFE0F'.repeat(filledHearts) + '\u{1F5A4}'.repeat(10 - filledHearts);
  ctx.font = '36px serif';
  ctx.textAlign = 'center';
  ctx.fillText(heartsText, CENTER_X, heartsY);

  // Step 6: Ship name + percent
  if (shipName) {
    ctx.font = 'bold 52px ShipFont';
    drawTextWithShadow(ctx, shipName, CENTER_X, 870, '#ffffff');
  }

  // Percentage and tier on same line
  ctx.font = 'bold 44px ShipFont';
  const statsLine = tierLabel ? `${percent}%  \u00b7  ${tierLabel}` : `${percent}%`;
  drawTextWithShadow(ctx, statsLine, CENTER_X, 940, '#ff8fab');

  // Step 7: Verdict text (AI-generated one-liner)
  if (verdict) {
    ctx.font = 'bold 28px ShipFont';
    const maxWidth = CANVAS_WIDTH - 100;
    const lines = wrapText(ctx, verdict, maxWidth);
    const verdictStartY = 1005;
    for (let i = 0; i < lines.length && i < 2; i++) {
      drawTextWithShadow(ctx, lines[i] ?? '', CENTER_X, verdictStartY + i * 36, 'rgba(255,255,255,0.8)');
    }
  }

  return canvas.toBuffer('image/png');
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
