/**
 * shipImage.ts — Generate merged avatar images for /ship
 *
 * Takes two Discord user avatars, splits them in half,
 * and merges them into a single image with a heart divider.
 * Zero API cost — all local canvas manipulation.
 */

import { createCanvas, loadImage } from 'canvas';

const CANVAS_WIDTH = 256;
const CANVAS_HEIGHT = 128;
const AVATAR_SIZE = 128;

/**
 * Generate a merged ship avatar from two Discord avatar URLs.
 * Returns a PNG buffer ready to attach to a Discord embed.
 */
export async function generateShipImage(avatarUrl1: string, avatarUrl2: string): Promise<Buffer> {
  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const ctx = canvas.getContext('2d');

  // Load both avatars
  const [img1, img2] = await Promise.all([
    loadImage(avatarUrl1).catch(() => null),
    loadImage(avatarUrl2).catch(() => null),
  ]);

  // Draw left half of avatar 1
  if (img1) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, CANVAS_WIDTH / 2, CANVAS_HEIGHT);
    ctx.clip();
    ctx.drawImage(img1, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    ctx.restore();
  } else {
    ctx.fillStyle = '#FF4D6D';
    ctx.fillRect(0, 0, CANVAS_WIDTH / 2, CANVAS_HEIGHT);
  }

  // Draw right half of avatar 2
  if (img2) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(CANVAS_WIDTH / 2, 0, CANVAS_WIDTH / 2, CANVAS_HEIGHT);
    ctx.clip();
    ctx.drawImage(img2, CANVAS_WIDTH / 2 - AVATAR_SIZE, 0, AVATAR_SIZE, AVATAR_SIZE);
    ctx.restore();
  } else {
    ctx.fillStyle = '#4D6DFF';
    ctx.fillRect(CANVAS_WIDTH / 2, 0, CANVAS_WIDTH / 2, CANVAS_HEIGHT);
  }

  // Draw divider line with gradient blend
  const gradient = ctx.createLinearGradient(CANVAS_WIDTH / 2 - 8, 0, CANVAS_WIDTH / 2 + 8, 0);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
  gradient.addColorStop(0.4, 'rgba(255, 77, 109, 0.6)');
  gradient.addColorStop(0.5, 'rgba(255, 77, 109, 0.8)');
  gradient.addColorStop(0.6, 'rgba(255, 77, 109, 0.6)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(CANVAS_WIDTH / 2 - 8, 0, 16, CANVAS_HEIGHT);

  // Draw heart in the center
  drawHeart(ctx, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, 14);

  return canvas.toBuffer('image/png');
}

/**
 * Draw a filled heart shape at the given center position.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawHeart(ctx: any, cx: number, cy: number, size: number): void {
  ctx.save();
  ctx.fillStyle = '#FF4D6D';
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2;
  ctx.beginPath();
  const topCurveHeight = size * 0.3;
  ctx.moveTo(cx, cy + size * 0.35);
  // Left curve
  ctx.bezierCurveTo(cx, cy, cx - size, cy - topCurveHeight, cx, cy - size * 0.7);
  // Right curve
  ctx.bezierCurveTo(cx + size, cy - topCurveHeight, cx, cy, cx, cy + size * 0.35);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
