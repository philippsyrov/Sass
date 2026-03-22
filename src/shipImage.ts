/**
 * shipImage.ts — Generate kawaii ship card images for /ship
 *
 * Pastel pink/lavender background with cherry blossom petals,
 * circular avatars with glow borders, big heart, sparkle dots.
 * Bundled font so text renders on Railway's minimal Linux.
 */

import { createCanvas, loadImage, registerFont } from 'canvas';
import { join, dirname } from 'path';
import { fileURLToPath, URL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Register bundled font so text renders on Railway (no system fonts)
try {
  registerFont(join(__dirname, '..', 'assets', 'fonts', 'Nunito-Bold.ttf'), { family: 'Nunito', weight: 'bold' });
} catch (err) {
  console.error('Failed to register Nunito font:', (err as Error).message);
}

const CANVAS_WIDTH = 500;
const CANVAS_HEIGHT = 200;
const AVATAR_RADIUS = 55;
const AVATAR_Y = CANVAS_HEIGHT / 2 - 5;
const AVATAR1_X = 110;
const AVATAR2_X = 390;

// Seeded random for deterministic petal/sparkle placement per render
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

/**
 * Generate a kawaii ship card from two Discord avatar URLs.
 * Returns a PNG buffer ready to attach to a Discord embed.
 */
export async function generateShipImage(avatarUrl1: string, avatarUrl2: string, percent: number): Promise<Buffer> {
  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const ctx = canvas.getContext('2d');

  // Use percent as seed so same % always looks the same
  const rand = seededRandom(percent * 137 + 42);

  // --- Background: pastel pink → lavender gradient ---
  const bg = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  bg.addColorStop(0, '#FFE4EC');
  bg.addColorStop(0.4, '#F5D5E8');
  bg.addColorStop(0.6, '#E8D5F5');
  bg.addColorStop(1, '#FFE4EC');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // --- Cherry blossom petals (scattered) ---
  for (let i = 0; i < 10; i++) {
    const x = rand() * CANVAS_WIDTH;
    const y = rand() * CANVAS_HEIGHT;
    const size = 6 + rand() * 10;
    const alpha = 0.15 + rand() * 0.2;
    const rotation = rand() * Math.PI * 2;
    drawCherryBlossom(ctx, x, y, size, alpha, rotation);
  }

  // --- Sparkle dots ---
  for (let i = 0; i < 15; i++) {
    const x = rand() * CANVAS_WIDTH;
    const y = rand() * CANVAS_HEIGHT;
    const size = 1 + rand() * 2.5;
    const alpha = 0.3 + rand() * 0.5;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.fill();
  }

  // --- Trail of mini hearts between avatars ---
  const trailY = AVATAR_Y;
  const startX = AVATAR1_X + AVATAR_RADIUS + 15;
  const endX = AVATAR2_X - AVATAR_RADIUS - 15;
  const heartCount = 5;
  for (let i = 0; i < heartCount; i++) {
    const t = (i + 1) / (heartCount + 1);
    const x = startX + (endX - startX) * t;
    const wobble = (rand() - 0.5) * 8;
    const size = 4 + rand() * 3;
    const alpha = 0.2 + t * 0.3;
    drawMiniHeart(ctx, x, trailY + wobble, size, `rgba(255, 105, 140, ${alpha})`);
  }

  // --- Load both avatars ---
  const [img1, img2] = await Promise.all([
    loadImage(new URL(avatarUrl1).href).catch(() => null),
    loadImage(new URL(avatarUrl2).href).catch(() => null),
  ]);

  // --- Draw circular avatars with glow border ---
  drawGlowAvatar(ctx, img1, AVATAR1_X, AVATAR_Y, AVATAR_RADIUS);
  drawGlowAvatar(ctx, img2, AVATAR2_X, AVATAR_Y, AVATAR_RADIUS);

  // --- Big heart in the center with glow ---
  const heartX = CANVAS_WIDTH / 2;
  const heartY = AVATAR_Y - 12;
  const heartSize = 22;

  // Glow behind heart
  ctx.save();
  ctx.shadowColor = '#FF6B8A';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  drawHeart(ctx, heartX, heartY, heartSize, '#FF4D6D');
  ctx.restore();

  // Heart again without shadow (crisper)
  drawHeart(ctx, heartX, heartY, heartSize, '#FF4D6D');

  // --- Percentage text below heart ---
  ctx.fillStyle = '#D4487A';
  ctx.font = 'bold 22px Nunito, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`${percent}%`, heartX, heartY + heartSize + 8);

  return canvas.toBuffer('image/png');
}

/**
 * Draw a circular avatar with a soft pink glow border.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawGlowAvatar(ctx: any, img: any, cx: number, cy: number, radius: number): void {
  // Outer glow
  ctx.save();
  ctx.shadowColor = 'rgba(255, 105, 140, 0.5)';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
  const borderGrad = ctx.createRadialGradient(cx, cy, radius, cx, cy, radius + 5);
  borderGrad.addColorStop(0, '#FF8FAB');
  borderGrad.addColorStop(1, '#FFB3C6');
  ctx.fillStyle = borderGrad;
  ctx.fill();
  ctx.restore();

  // Clip to circle and draw avatar
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
 * Draw a cherry blossom petal (5 petals in a circle).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawCherryBlossom(ctx: any, cx: number, cy: number, size: number, alpha: number, rotation: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.globalAlpha = alpha;

  for (let i = 0; i < 5; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI * 2) / 5);
    ctx.beginPath();
    ctx.ellipse(0, -size * 0.5, size * 0.3, size * 0.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#FFB7C5';
    ctx.fill();
    ctx.restore();
  }

  // Center dot
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.15, 0, Math.PI * 2);
  ctx.fillStyle = '#FFDA9E';
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.restore();
}

/**
 * Draw a filled heart shape.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawHeart(ctx: any, cx: number, cy: number, size: number, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  const topCurveHeight = size * 0.3;
  ctx.moveTo(cx, cy + size * 0.35);
  ctx.bezierCurveTo(cx, cy, cx - size, cy - topCurveHeight, cx, cy - size * 0.7);
  ctx.bezierCurveTo(cx + size, cy - topCurveHeight, cx, cy, cx, cy + size * 0.35);
  ctx.fill();
  ctx.restore();
}

/**
 * Draw a tiny heart for the trail between avatars.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawMiniHeart(ctx: any, cx: number, cy: number, size: number, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  const topCurveHeight = size * 0.3;
  ctx.moveTo(cx, cy + size * 0.35);
  ctx.bezierCurveTo(cx, cy, cx - size, cy - topCurveHeight, cx, cy - size * 0.7);
  ctx.bezierCurveTo(cx + size, cy - topCurveHeight, cx, cy, cx, cy + size * 0.35);
  ctx.fill();
  ctx.restore();
}
