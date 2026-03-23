/**
 * shipImage.ts — Generate ship card images using a template
 *
 * Draws avatars first, then overlays the template image on top.
 * The template has transparent circle cutouts where avatars show through.
 *
 * Visual enhancements:
 * - Dynamic background tint (warm pink for high %, cool blue for low %)
 * - Glow ring around avatars (color matches energy)
 * - Drop shadow on percentage text
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
 * Get the energy color based on ship percentage.
 * High % = warm pink/red, Low % = cool blue/purple.
 */
function getEnergyColor(percent: number): { r: number; g: number; b: number } {
  const t = percent / 100;
  return {
    r: Math.round(107 + (255 - 107) * t),
    g: Math.round(139 + (107 - 139) * t),
    b: Math.round(255 + (157 - 255) * t),
  };
}

/**
 * Generate a ship card by drawing avatars behind the template.
 * Returns a PNG buffer ready to attach to a Discord embed.
 */
export async function generateShipImage(
  avatarUrl1: string,
  avatarUrl2: string,
  percent: number,
): Promise<Buffer> {
  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const ctx = canvas.getContext('2d');

  const [template, img1, img2] = await Promise.all([
    loadImage(TEMPLATE_PATH).catch(() => null),
    loadImage(avatarUrl1).catch(() => null),
    loadImage(avatarUrl2).catch(() => null),
  ]);

  // Step 1: Dynamic background tint
  const energy = getEnergyColor(percent);
  ctx.fillStyle = `rgba(${energy.r}, ${energy.g}, ${energy.b}, 0.35)`;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Step 2: Avatar glow rings
  const glowColor = `rgba(${energy.r}, ${energy.g}, ${energy.b}, 0.6)`;
  drawAvatarGlow(ctx, AVATAR1_CX, AVATAR1_CY, AVATAR1_RADIUS, glowColor);
  drawAvatarGlow(ctx, AVATAR2_CX, AVATAR2_CY, AVATAR2_RADIUS, glowColor);

  // Step 3: Draw avatars (behind template)
  drawCircularAvatar(ctx, img1, AVATAR1_CX, AVATAR1_CY, AVATAR1_RADIUS);
  drawCircularAvatar(ctx, img2, AVATAR2_CX, AVATAR2_CY, AVATAR2_RADIUS);

  // Step 4: Draw template on top — transparent cutouts reveal avatars
  if (template) {
    ctx.drawImage(template, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  // Step 5: Percentage text with drop shadow
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 64px ShipFont';

  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.fillText(`${percent}%`, PERCENT_X + 3, PERCENT_Y + 3);

  const mainColor = `rgb(${Math.round(energy.r * 0.7)}, ${Math.round(energy.g * 0.4)}, ${Math.round(energy.b * 0.5)})`;
  ctx.fillStyle = mainColor;
  ctx.fillText(`${percent}%`, PERCENT_X, PERCENT_Y);

  return canvas.toBuffer('image/png');
}

/**
 * Draw a glowing ring behind an avatar circle.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawAvatarGlow(ctx: any, cx: number, cy: number, radius: number, color: string): void {
  ctx.save();
  const glowRadius = radius + 40;
  const gradient = ctx.createRadialGradient(cx, cy, radius - 5, cx, cy, glowRadius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.5, color.replace('0.6)', '0.3)'));
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
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
