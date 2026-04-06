/**
 * shipImage.ts — Generate ship card images using affinity-tiered templates
 *
 * Renders the template as a full background, then draws avatars on top
 * at hardcoded circle positions. No alpha channel dependency.
 * Text (ship name, %, tier) is rendered over the dark bottom section.
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

// Canvas dimensions — must match template files exactly
const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 1536;

// Avatar circle positions (measured from template)
const AVATAR1_CX = 210;
const AVATAR1_CY = 490;
const AVATAR1_RADIUS = 145;
const AVATAR2_CX = 814;
const AVATAR2_CY = 490;
const AVATAR2_RADIUS = 145;

// Text zone — rendered over the dark bottom section
const SHIP_NAME_X = CANVAS_WIDTH / 2;
const SHIP_NAME_Y = 1290;
const STATS_Y = 1390;

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

/**
 * Generate a ship card. Template is drawn as background, avatars clipped
 * on top at fixed positions, text overlaid on the dark bottom section.
 * Returns a PNG buffer ready to attach to a Discord embed.
 */
export async function generateShipImage(
  avatarUrl1: string,
  avatarUrl2: string,
  percent: number,
  shipName?: string,
  tierLabel?: string,
): Promise<Buffer> {
  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const ctx = canvas.getContext('2d');

  const templatePath = getTemplatePath(percent);

  // Load template and avatars in parallel
  const [template, img1, img2] = await Promise.all([
    loadImage(templatePath).catch((err) => { console.error('Template load failed:', (err as Error).message); return null; }),
    loadImage(avatarUrl1).catch((err) => { console.error('Avatar 1 load failed:', (err as Error).message); return null; }),
    loadImage(avatarUrl2).catch((err) => { console.error('Avatar 2 load failed:', (err as Error).message); return null; }),
  ]);

  // Step 1: Draw template as full background
  if (template) {
    ctx.drawImage(template, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  } else {
    // Fallback background if template fails
    ctx.fillStyle = '#1a0a12';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  // Step 2: Draw avatars clipped to circles on top of template
  drawCircularAvatar(ctx, img1, AVATAR1_CX, AVATAR1_CY, AVATAR1_RADIUS);
  drawCircularAvatar(ctx, img2, AVATAR2_CX, AVATAR2_CY, AVATAR2_RADIUS);

  // Step 3: Dark overlay strip for text legibility
  const overlayTop = CANVAS_HEIGHT - 320;
  const gradient = ctx.createLinearGradient(0, overlayTop, 0, CANVAS_HEIGHT);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(0.3, 'rgba(0,0,0,0.65)');
  gradient.addColorStop(1, 'rgba(0,0,0,0.85)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, overlayTop, CANVAS_WIDTH, CANVAS_HEIGHT - overlayTop);

  // Step 4: Text rendering
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (shipName) {
    // Ship name
    ctx.font = 'bold 52px ShipFont';
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillText(shipName, SHIP_NAME_X + 2, SHIP_NAME_Y + 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(shipName, SHIP_NAME_X, SHIP_NAME_Y);
  }

  // Percentage (left) and tier label (right)
  ctx.font = 'bold 46px ShipFont';
  const percentX = CANVAS_WIDTH / 2 - (tierLabel ? 130 : 0);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillText(`${percent}%`, percentX + 2, STATS_Y + 2);
  ctx.fillStyle = '#ff8fab';
  ctx.fillText(`${percent}%`, percentX, STATS_Y);

  if (tierLabel) {
    ctx.font = 'bold 36px ShipFont';
    const tierX = CANVAS_WIDTH / 2 + 130;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillText(tierLabel, tierX + 2, STATS_Y + 2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(tierLabel, tierX, STATS_Y);
  }

  return canvas.toBuffer('image/png');
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
