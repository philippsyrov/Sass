/**
 * shipImage.ts — Generate ship card images using a template
 *
 * Draws avatars first, then overlays the template image on top.
 * The template has transparent circle cutouts where avatars show through.
 * Percentage text rendered below the heart in the center.
 *
 * Enhancements:
 * - Dynamic background tint (warm pink for high %, cool blue for low %)
 * - Glow/border around avatars (warm glow high %, cold glow low %)
 * - Ship name overlaid centered above the heart
 * - Icons/effects between avatars based on percentage
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
const CENTER_X = 724;
const CENTER_Y = 200; // heart area center

/**
 * Get the energy color based on ship percentage.
 * High % = warm pink/red, Low % = cool blue/purple.
 */
function getEnergyColor(percent: number): { r: number; g: number; b: number } {
  // Warm (high): #FF6B9D (255, 107, 157)
  // Cold (low):  #6B8BFF (107, 139, 255)
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
  shipName?: string,
): Promise<Buffer> {
  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const ctx = canvas.getContext('2d');

  // Load template and avatars in parallel
  const [template, img1, img2] = await Promise.all([
    loadImage(TEMPLATE_PATH).catch(() => null),
    loadImage(avatarUrl1).catch(() => null),
    loadImage(avatarUrl2).catch(() => null),
  ]);

  // --- Step 1: Dynamic background tint ---
  drawBackgroundTint(ctx, percent);

  // --- Step 2: Avatar glow rings ---
  const energy = getEnergyColor(percent);
  const glowColor = `rgba(${energy.r}, ${energy.g}, ${energy.b}, 0.6)`;
  drawAvatarGlow(ctx, AVATAR1_CX, AVATAR1_CY, AVATAR1_RADIUS, glowColor);
  drawAvatarGlow(ctx, AVATAR2_CX, AVATAR2_CY, AVATAR2_RADIUS, glowColor);

  // --- Step 3: Draw avatars (behind template) ---
  drawCircularAvatar(ctx, img1, AVATAR1_CX, AVATAR1_CY, AVATAR1_RADIUS);
  drawCircularAvatar(ctx, img2, AVATAR2_CX, AVATAR2_CY, AVATAR2_RADIUS);

  // --- Step 4: Draw template on top ---
  if (template) {
    ctx.drawImage(template, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  // --- Step 5: Center effects/icons ---
  drawCenterEffects(ctx, percent);

  // --- Step 6: Ship name overlay ---
  if (shipName) {
    drawShipName(ctx, shipName);
  }

  // --- Step 7: Percentage text with drop shadow ---
  drawPercentageText(ctx, percent);

  return canvas.toBuffer('image/png');
}

/**
 * Draw a subtle background tint before the template.
 * Warm pink for high scores, cool blue for low scores.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawBackgroundTint(ctx: any, percent: number): void {
  const energy = getEnergyColor(percent);
  ctx.fillStyle = `rgba(${energy.r}, ${energy.g}, ${energy.b}, 0.15)`;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
}

/**
 * Draw a glowing ring behind an avatar circle.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawAvatarGlow(ctx: any, cx: number, cy: number, radius: number, color: string): void {
  ctx.save();
  const glowRadius = radius + 18;
  const gradient = ctx.createRadialGradient(cx, cy, radius - 2, cx, cy, glowRadius);
  gradient.addColorStop(0, color);
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

/**
 * Draw effects between the avatars based on percentage.
 * 80%+: sparkles, 50-79%: small hearts, 20-49%: question marks, <20%: broken heart
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawCenterEffects(ctx: any, percent: number): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (percent >= 80) {
    // Sparkles scattered around the heart area
    drawSparkles(ctx, CENTER_X, CENTER_Y, percent);
  } else if (percent < 20) {
    // Broken heart / crack effect
    drawCrackEffect(ctx, CENTER_X, CENTER_Y);
  }
  // 20-79%: no extra effects — the heart template + glow is enough

  ctx.restore();
}

/**
 * Draw sparkle stars around the center area.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawSparkles(ctx: any, cx: number, cy: number, percent: number): void {
  const sparklePositions = [
    { x: cx - 90, y: cy - 60, size: 8 },
    { x: cx + 85, y: cy - 50, size: 6 },
    { x: cx - 70, y: cy + 40, size: 5 },
    { x: cx + 95, y: cy + 45, size: 7 },
    { x: cx - 30, y: cy - 80, size: 5 },
    { x: cx + 40, y: cy + 70, size: 6 },
  ];

  // More sparkles for higher percentages
  const count = percent >= 95 ? 6 : 4;
  const alpha = percent >= 95 ? 0.9 : 0.7;

  for (let i = 0; i < count; i++) {
    const sp = sparklePositions[i];
    if (!sp) continue;
    drawStar(ctx, sp.x, sp.y, sp.size, `rgba(255, 255, 255, ${alpha})`);
  }
}

/**
 * Draw a 4-point star (sparkle).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawStar(ctx: any, x: number, y: number, size: number, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  // 4-point star shape
  ctx.moveTo(x, y - size);
  ctx.quadraticCurveTo(x + size * 0.3, y - size * 0.3, x + size, y);
  ctx.quadraticCurveTo(x + size * 0.3, y + size * 0.3, x, y + size);
  ctx.quadraticCurveTo(x - size * 0.3, y + size * 0.3, x - size, y);
  ctx.quadraticCurveTo(x - size * 0.3, y - size * 0.3, x, y - size);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Draw crack lines emanating from center for very low percentages.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawCrackEffect(ctx: any, cx: number, cy: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(100, 130, 200, 0.5)';
  ctx.lineWidth = 2;

  // Jagged crack lines
  const cracks = [
    [{ x: cx - 15, y: cy + 30 }, { x: cx - 25, y: cy + 55 }, { x: cx - 18, y: cy + 75 }],
    [{ x: cx + 12, y: cy + 28 }, { x: cx + 22, y: cy + 50 }, { x: cx + 30, y: cy + 70 }],
  ];

  for (const crack of cracks) {
    const start = crack[0];
    if (!start) continue;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    for (let i = 1; i < crack.length; i++) {
      const pt = crack[i];
      if (!pt) continue;
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Draw the ship name centered above the heart.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawShipName(ctx: any, name: string): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const y = 440; // below percentage, near bottom
  const fontSize = 32;

  // Drop shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.font = `bold ${fontSize}px ShipFont`;
  ctx.fillText(name, CENTER_X, y + 2);

  // Main text — soft white with slight transparency
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.fillText(name, CENTER_X, y);

  ctx.restore();
}

/**
 * Draw percentage text with a drop shadow for better readability.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawPercentageText(ctx: any, percent: number): void {
  const energy = getEnergyColor(percent);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 64px ShipFont';

  // Drop shadow (darker, offset down-right)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.fillText(`${percent}%`, PERCENT_X + 3, PERCENT_Y + 3);

  // Main text — tinted by energy color
  const mainColor = `rgb(${Math.round(energy.r * 0.7)}, ${Math.round(energy.g * 0.4)}, ${Math.round(energy.b * 0.5)})`;
  ctx.fillStyle = mainColor;
  ctx.fillText(`${percent}%`, PERCENT_X, PERCENT_Y);
}
