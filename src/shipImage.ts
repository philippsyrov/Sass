/**
 * shipImage.ts — Generate ship card images using a template
 *
 * Draws avatars first, then overlays the template image on top.
 * The template has transparent circle cutouts where avatars show through.
 * Percentage text rendered below the heart in the center.
 */

import { createCanvas, loadImage, registerFont } from 'canvas';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(__dirname, '..', 'assets', 'ship-template.png');

// Register bundled font before any canvas creation
const fontPath = join(__dirname, '..', 'assets', 'fonts', 'Nunito-Bold.ttf');
try {
  registerFont(fontPath, { family: 'ShipFont' });
} catch (err) {
  console.error('Font registration failed:', (err as Error).message);
}

// Template dimensions and circle positions (measured from template)
const CANVAS_WIDTH = 1440;
const CANVAS_HEIGHT = 474;
const AVATAR1_CX = 284;
const AVATAR1_CY = 231;
const AVATAR1_RADIUS = 165;
const AVATAR2_CX = 1165;
const AVATAR2_CY = 231;
const AVATAR2_RADIUS = 162;
const PERCENT_X = 724;
const PERCENT_Y = 370;

/**
 * Generate a ship card by drawing avatars behind the template.
 * Returns a PNG buffer ready to attach to a Discord embed.
 */
export async function generateShipImage(avatarUrl1: string, avatarUrl2: string, percent: number): Promise<Buffer> {
  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const ctx = canvas.getContext('2d');

  // Load template and avatars in parallel
  const [template, img1, img2] = await Promise.all([
    loadImage(TEMPLATE_PATH).catch(() => null),
    loadImage(avatarUrl1).catch(() => null),
    loadImage(avatarUrl2).catch(() => null),
  ]);

  // Step 1: Draw avatars first (they go behind the template)
  drawCircularAvatar(ctx, img1, AVATAR1_CX, AVATAR1_CY, AVATAR1_RADIUS);
  drawCircularAvatar(ctx, img2, AVATAR2_CX, AVATAR2_CY, AVATAR2_RADIUS);

  // Step 2: Draw template on top — transparent cutouts reveal avatars
  if (template) {
    ctx.drawImage(template, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  // Step 3: Percentage text below the heart
  ctx.fillStyle = '#C44078';
  ctx.font = 'bold 64px ShipFont';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${percent}%`, PERCENT_X, PERCENT_Y);

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
