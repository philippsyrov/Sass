/**
 * shipImage.ts — Generate ship card images for /ship
 *
 * Pastel pink background, circular avatars, percentage as plain text.
 * Bundled font registered before any canvas creation.
 */

import { createCanvas, loadImage, registerFont } from 'canvas';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Register font BEFORE creating any canvas
const fontPath = join(__dirname, '..', 'assets', 'fonts', 'Nunito-Bold.ttf');
try {
  registerFont(fontPath, { family: 'ShipFont' });
} catch (err) {
  console.error('Font registration failed:', (err as Error).message);
}

const CANVAS_WIDTH = 500;
const CANVAS_HEIGHT = 200;
const AVATAR_RADIUS = 55;
const AVATAR_Y = CANVAS_HEIGHT / 2;
const AVATAR1_X = 110;
const AVATAR2_X = 390;

export async function generateShipImage(avatarUrl1: string, avatarUrl2: string, percent: number): Promise<Buffer> {
  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const ctx = canvas.getContext('2d');

  // Background — pastel pink/lavender gradient
  const bg = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  bg.addColorStop(0, '#FFE4EC');
  bg.addColorStop(0.5, '#E8D5F5');
  bg.addColorStop(1, '#FFE4EC');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Load avatars
  const [img1, img2] = await Promise.all([
    loadImage(avatarUrl1).catch(() => null),
    loadImage(avatarUrl2).catch(() => null),
  ]);

  // Draw avatars with pink glow border
  drawAvatar(ctx, img1, AVATAR1_X, AVATAR_Y, AVATAR_RADIUS);
  drawAvatar(ctx, img2, AVATAR2_X, AVATAR_Y, AVATAR_RADIUS);

  // Percentage — try registered font, fall back to default
  ctx.fillStyle = '#D4487A';
  ctx.font = 'bold 28px ShipFont';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${percent}%`, CANVAS_WIDTH / 2, AVATAR_Y);

  return canvas.toBuffer('image/png');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawAvatar(ctx: any, img: any, cx: number, cy: number, radius: number): void {
  // Glow border
  ctx.save();
  ctx.shadowColor = 'rgba(255, 105, 140, 0.5)';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
  ctx.fillStyle = '#FF8FAB';
  ctx.fill();
  ctx.restore();

  // Avatar clipped to circle
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
