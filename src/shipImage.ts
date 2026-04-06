/**
 * shipImage.ts — Generate ship card images using 5 affinity-tiered templates
 *
 * Renders the template as a full background, draws avatars on top
 * at per-template circle positions, and renders percentage text.
 * All other ship info (names, verdict, tier) lives in the embed text.
 *
 * Templates are ~1392×768 JPGs with checkered circles marking avatar spots.
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

// Canvas matches template native size
const CANVAS_WIDTH = 1392;
const CANVAS_HEIGHT = 768;
const CENTER_X = CANVAS_WIDTH / 2;

/**
 * Per-template configuration — avatar positions differ slightly between templates.
 */
interface TemplateConfig {
  path: string;
  avatar1Cx: number;
  avatar2Cx: number;
  avatarCy: number;
  avatarRadius: number;
  accentColor: string;    // Percentage text color
  embedColor: number;     // Discord embed sidebar color
  borderEmoji: string;    // Decorative border for embed text
}

const TEMPLATES: Record<string, TemplateConfig> = {
  dark_storm: {
    path: join(__dirname, '..', 'assets', 'dark_storm_clouds.jpg'),
    avatar1Cx: 300,
    avatar2Cx: 1090,
    avatarCy: 300,
    avatarRadius: 158,
    accentColor: '#8bb8d0',
    embedColor: 0x2a3040,
    borderEmoji: '\u26C8\uFE0F\u{1F5A4}\u26C8\uFE0F\u{1F5A4}\u26C8\uFE0F\u{1F5A4}\u26C8\uFE0F\u{1F5A4}\u26C8\uFE0F\u{1F5A4}\u26C8\uFE0F\u{1F5A4}\u26C8\uFE0F\u{1F5A4}\u26C8\uFE0F\u{1F5A4}\u26C8\uFE0F\u{1F5A4}\u26C8\uFE0F\u{1F5A4}\u26C8\uFE0F\u{1F5A4}\u26C8\uFE0F',
  },
  overcast: {
    path: join(__dirname, '..', 'assets', 'overcast_dusk.jpg'),
    avatar1Cx: 300,
    avatar2Cx: 1090,
    avatarCy: 300,
    avatarRadius: 158,
    accentColor: '#b0c4de',
    embedColor: 0x4A6FA5,
    borderEmoji: '\u{1F32B}\uFE0F\u{1F48E}\u{1F32B}\uFE0F\u{1F48E}\u{1F32B}\uFE0F\u{1F48E}\u{1F32B}\uFE0F\u{1F48E}\u{1F32B}\uFE0F\u{1F48E}\u{1F32B}\uFE0F\u{1F48E}\u{1F32B}\uFE0F\u{1F48E}\u{1F32B}\uFE0F\u{1F48E}\u{1F32B}\uFE0F\u{1F48E}\u{1F32B}\uFE0F\u{1F48E}\u{1F32B}\uFE0F\u{1F48E}\u{1F32B}\uFE0F',
  },
  sunset: {
    path: join(__dirname, '..', 'assets', 'warm_sunset.jpg'),
    avatar1Cx: 300,
    avatar2Cx: 1090,
    avatarCy: 300,
    avatarRadius: 158,
    accentColor: '#f0a868',
    embedColor: 0xD4764E,
    borderEmoji: '\u{1F305}\u2728\u{1F305}\u2728\u{1F305}\u2728\u{1F305}\u2728\u{1F305}\u2728\u{1F305}\u2728\u{1F305}\u2728\u{1F305}\u2728\u{1F305}\u2728\u{1F305}\u2728\u{1F305}\u2728\u{1F305}',
  },
  light_sakura: {
    path: join(__dirname, '..', 'assets', 'light_sakura.jpg'),
    avatar1Cx: 320,
    avatar2Cx: 1070,
    avatarCy: 300,
    avatarRadius: 150,
    accentColor: '#e8a0b8',
    embedColor: 0xE8A0B8,
    borderEmoji: '\u{1F338}\u{1F497}\u{1F338}\u{1F497}\u{1F338}\u{1F497}\u{1F338}\u{1F497}\u{1F338}\u{1F497}\u{1F338}\u{1F497}\u{1F338}\u{1F497}\u{1F338}\u{1F497}\u{1F338}\u{1F497}\u{1F338}\u{1F497}\u{1F338}\u{1F497}\u{1F338}',
  },
  full_sakura: {
    path: join(__dirname, '..', 'assets', 'full_sakura_bloom.jpg'),
    avatar1Cx: 340,
    avatar2Cx: 1050,
    avatarCy: 300,
    avatarRadius: 145,
    accentColor: '#ff8fab',
    embedColor: 0xFF4D6D,
    borderEmoji: '\u{1F338}\u273F\u{1F338}\u273F\u{1F338}\u273F\u{1F338}\u273F\u{1F338}\u273F\u{1F338}\u273F\u{1F338}\u273F\u{1F338}\u273F\u{1F338}\u273F\u{1F338}\u273F\u{1F338}\u273F\u{1F338}\u273F\u{1F338}\u273F\u{1F338}',
  },
};

export type TemplateTier = 'dark_storm' | 'overcast' | 'sunset' | 'light_sakura' | 'full_sakura';

export function getTemplateTier(score: number): TemplateTier {
  if (score >= 85) return 'full_sakura';
  if (score >= 60) return 'light_sakura';
  if (score >= 30) return 'sunset';
  if (score >= 15) return 'overcast';
  return 'dark_storm';
}

export function getTemplateConfig(tier: TemplateTier): TemplateConfig {
  const config = TEMPLATES[tier];
  if (!config) throw new Error(`Missing template config for tier: ${tier}`);
  return config;
}

/**
 * Generate a ship card image with avatars and percentage.
 * Returns a PNG buffer ready to attach to a Discord embed.
 */
export async function generateShipImage(
  avatarUrl1: string,
  avatarUrl2: string,
  percent: number,
): Promise<Buffer> {
  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const ctx = canvas.getContext('2d');

  const tier = getTemplateTier(percent);
  const tmpl = getTemplateConfig(tier);

  // Load template and avatars in parallel
  const [template, img1, img2] = await Promise.all([
    loadImage(tmpl.path).catch((err) => { console.error('Template load failed:', (err as Error).message); return null; }),
    loadImage(avatarUrl1).catch((err) => { console.error('Avatar 1 load failed:', (err as Error).message); return null; }),
    loadImage(avatarUrl2).catch((err) => { console.error('Avatar 2 load failed:', (err as Error).message); return null; }),
  ]);

  // Step 1: Draw template as full background
  if (template) {
    ctx.drawImage(template, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  } else {
    ctx.fillStyle = '#1a0a12';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  // Step 2: Draw avatars clipped to circles on top of template
  drawCircularAvatar(ctx, img1, tmpl.avatar1Cx, tmpl.avatarCy, tmpl.avatarRadius);
  drawCircularAvatar(ctx, img2, tmpl.avatar2Cx, tmpl.avatarCy, tmpl.avatarRadius);

  // Step 3: Percentage text centered below the heart
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 64px ShipFont';

  const percentY = CANVAS_HEIGHT - 60;

  // Dark shadow for readability
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillText(`${percent}%`, CENTER_X + 3, percentY + 3);
  // Accent color
  ctx.fillStyle = tmpl.accentColor;
  ctx.fillText(`${percent}%`, CENTER_X, percentY);

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
