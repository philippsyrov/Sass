/**
 * shipImage.ts — Generate ship card images for /ship
 *
 * Two circular avatars side by side with a heart between them.
 * Clean matchmaking card look. Zero API cost.
 */

import { createCanvas, loadImage } from 'canvas';

const CANVAS_WIDTH = 400;
const CANVAS_HEIGHT = 160;
const AVATAR_RADIUS = 50;
const AVATAR_Y = CANVAS_HEIGHT / 2;
const AVATAR1_X = 100;
const AVATAR2_X = 300;

/**
 * Generate a ship card from two Discord avatar URLs.
 * Returns a PNG buffer ready to attach to a Discord embed.
 */
export async function generateShipImage(avatarUrl1: string, avatarUrl2: string, percent: number): Promise<Buffer> {
  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const ctx = canvas.getContext('2d');

  // Background — dark with subtle gradient
  const bg = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, 0);
  bg.addColorStop(0, '#1a1a2e');
  bg.addColorStop(0.5, '#16213e');
  bg.addColorStop(1, '#1a1a2e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Load both avatars
  const [img1, img2] = await Promise.all([
    loadImage(avatarUrl1).catch(() => null),
    loadImage(avatarUrl2).catch(() => null),
  ]);

  // Draw circular avatar 1
  drawCircularAvatar(ctx, img1, AVATAR1_X, AVATAR_Y, AVATAR_RADIUS, '#FF4D6D');

  // Draw circular avatar 2
  drawCircularAvatar(ctx, img2, AVATAR2_X, AVATAR_Y, AVATAR_RADIUS, '#FF4D6D');

  // Draw heart in the center
  drawHeart(ctx, CANVAS_WIDTH / 2, AVATAR_Y - 5, 18);

  // Draw percentage below heart
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${percent}%`, CANVAS_WIDTH / 2, AVATAR_Y + 25);

  // Draw connection line between avatars (behind heart)
  ctx.save();
  ctx.globalCompositeOperation = 'destination-over';
  const lineGrad = ctx.createLinearGradient(AVATAR1_X + AVATAR_RADIUS, 0, AVATAR2_X - AVATAR_RADIUS, 0);
  lineGrad.addColorStop(0, 'rgba(255, 77, 109, 0.3)');
  lineGrad.addColorStop(0.5, 'rgba(255, 77, 109, 0.6)');
  lineGrad.addColorStop(1, 'rgba(255, 77, 109, 0.3)');
  ctx.strokeStyle = lineGrad;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(AVATAR1_X + AVATAR_RADIUS + 5, AVATAR_Y);
  ctx.lineTo(AVATAR2_X - AVATAR_RADIUS - 5, AVATAR_Y);
  ctx.stroke();
  ctx.restore();

  return canvas.toBuffer('image/png');
}

/**
 * Draw a circular avatar with a colored border ring.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawCircularAvatar(ctx: any, img: any, cx: number, cy: number, radius: number, borderColor: string): void {
  // Border ring
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
  ctx.fillStyle = borderColor;
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
    ctx.fillStyle = '#2a2a4a';
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }
  ctx.restore();
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
  ctx.bezierCurveTo(cx, cy, cx - size, cy - topCurveHeight, cx, cy - size * 0.7);
  ctx.bezierCurveTo(cx + size, cy - topCurveHeight, cx, cy, cx, cy + size * 0.35);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
