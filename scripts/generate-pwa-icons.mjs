// One-off asset pipeline: takes the official ELIZA app icon (a single
// high-res square source image) and derives every PWA icon size + iOS splash
// screen the manifest/index.html reference. Re-run after the source art
// changes; nothing else in the build depends on this script executing.
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'public/brand/eliza-app-icon-1024.png');
const ICONS_DIR = path.join(ROOT, 'public/icons');
const SPLASH_DIR = path.join(ROOT, 'public/splash');

// Brand background behind the icon — matches --color-next-bg-deep in
// index.css. Used wherever a platform (iOS home screen, Android maskable
// safe zone, splash screens) requires a solid backdrop instead of
// transparency.
const BG = '#07050c';

if (!fs.existsSync(SOURCE)) {
  console.error(`[icons] Missing source file: ${SOURCE}`);
  console.error('[icons] Save the official 1024x1024 ELIZA app icon there first.');
  process.exit(1);
}

fs.mkdirSync(ICONS_DIR, { recursive: true });
fs.mkdirSync(SPLASH_DIR, { recursive: true });

// Standard "any" icons: flush square, transparent-safe (source already has
// no transparency at the edges, but resize preserves alpha if present).
const PLAIN_SIZES = [16, 32, 48, 72, 96, 128, 144, 152, 180, 192, 256, 384, 512];

// Maskable icons need the visual content inside the inner ~80% "safe zone"
// so Android's circle/squircle/rounded-square masks never clip the logo.
// We pad the source onto a BG-colored canvas at 512 with ~10% margin per
// side (512 * 0.8 = ~410px content area).
const MASKABLE_SIZE = 512;
const MASKABLE_CONTENT = Math.round(MASKABLE_SIZE * 0.8);

// iOS home screen + splash devices (portrait logical CSS px * devicePixelRatio).
// Covers the device families Apple's own HIG splash table lists — from the
// smallest still-supported iPhone SE up through the 13" iPad Pro — so the
// branded splash is used instead of a blank white flash on first paint.
const IOS_SPLASH_SCREENS = [
  { name: 'iphone-se', width: 640, height: 1136, dpr: 2 },
  { name: 'iphone-8', width: 750, height: 1334, dpr: 2 },
  { name: 'iphone-8-plus', width: 1242, height: 2208, dpr: 3 },
  { name: 'iphone-x', width: 1125, height: 2436, dpr: 3 },
  { name: 'iphone-xr', width: 828, height: 1792, dpr: 2 },
  { name: 'iphone-11-pro-max', width: 1242, height: 2688, dpr: 3 },
  { name: 'iphone-12-13-mini', width: 1080, height: 2340, dpr: 3 },
  { name: 'iphone-12-13', width: 1170, height: 2532, dpr: 3 },
  { name: 'iphone-12-13-pro-max', width: 1284, height: 2778, dpr: 3 },
  { name: 'iphone-14-pro', width: 1179, height: 2556, dpr: 3 },
  { name: 'iphone-14-pro-max', width: 1290, height: 2796, dpr: 3 },
  { name: 'iphone-15-16-pro-max', width: 1320, height: 2868, dpr: 3 },
  { name: 'ipad-9.7', width: 1536, height: 2048, dpr: 2 },
  { name: 'ipad-10.5', width: 1668, height: 2224, dpr: 2 },
  { name: 'ipad-pro-11', width: 1668, height: 2388, dpr: 2 },
  { name: 'ipad-pro-12.9', width: 2048, height: 2732, dpr: 2 },
];

async function run() {
  const source = sharp(SOURCE).ensureAlpha();
  const meta = await source.metadata();
  console.log(`[icons] Source: ${SOURCE} (${meta.width}x${meta.height})`);

  // 1) Plain square "any"-purpose icons, straight resize of the source
  //    (source is already a clean rounded-square app-icon composition).
  for (const size of PLAIN_SIZES) {
    const out = path.join(ICONS_DIR, `icon-${size}.png`);
    await sharp(SOURCE).resize(size, size, { fit: 'cover' }).png().toFile(out);
  }
  console.log(`[icons] Wrote ${PLAIN_SIZES.length} plain icon sizes to ${ICONS_DIR}`);

  // 2) Maskable icon: BG canvas + source scaled into the 80% safe zone.
  const maskableContent = await sharp(SOURCE)
    .resize(MASKABLE_CONTENT, MASKABLE_CONTENT, { fit: 'cover' })
    .toBuffer();
  await sharp({
    create: {
      width: MASKABLE_SIZE,
      height: MASKABLE_SIZE,
      channels: 4,
      background: BG,
    },
  })
    .composite([{ input: maskableContent, gravity: 'center' }])
    .png()
    .toFile(path.join(ICONS_DIR, 'icon-512-maskable.png'));
  console.log('[icons] Wrote maskable 512 icon');

  // 3) Apple touch icon: iOS ignores alpha and paints transparent pixels
  //    black, so flatten onto the brand background at 180 (device-optimal)
  //    and also keep a 1024 "master" for App Store/Smart App Banner use.
  await sharp(SOURCE)
    .resize(180, 180, { fit: 'cover' })
    .flatten({ background: BG })
    .png()
    .toFile(path.join(ICONS_DIR, 'apple-touch-icon.png'));
  await sharp(SOURCE)
    .resize(1024, 1024, { fit: 'cover' })
    .flatten({ background: BG })
    .png()
    .toFile(path.join(ICONS_DIR, 'apple-touch-icon-1024.png'));
  console.log('[icons] Wrote apple-touch-icon (180 + 1024)');

  // 4) Favicons (browser tab / bookmarks).
  await sharp(SOURCE).resize(32, 32, { fit: 'cover' }).png().toFile(path.join(ROOT, 'public/favicon-32.png'));
  await sharp(SOURCE).resize(16, 16, { fit: 'cover' }).png().toFile(path.join(ROOT, 'public/favicon-16.png'));
  console.log('[icons] Wrote favicons');

  // 5) Notification badge (small monochrome-friendly, used by Android
  //    notification tray when push is wired up later).
  await sharp(SOURCE).resize(96, 96, { fit: 'cover' }).png().toFile(path.join(ICONS_DIR, 'badge-96.png'));

  // 6) iOS splash screens: BG canvas at exact device pixel resolution with
  //    the icon centered at ~28% of the shorter edge — matches the
  //    proportions iOS's own auto-generated splash uses.
  for (const screen of IOS_SPLASH_SCREENS) {
    const w = screen.width;
    const h = screen.height;
    const iconSize = Math.round(Math.min(w, h) * 0.28);
    const iconBuf = await sharp(SOURCE).resize(iconSize, iconSize, { fit: 'cover' }).toBuffer();
    const outName = `${screen.name}-${w}x${h}.png`;
    await sharp({
      create: { width: w, height: h, channels: 4, background: BG },
    })
      .composite([{ input: iconBuf, gravity: 'center' }])
      .png()
      .toFile(path.join(SPLASH_DIR, outName));
  }
  console.log(`[icons] Wrote ${IOS_SPLASH_SCREENS.length} iOS splash screens to ${SPLASH_DIR}`);

  console.log('[icons] Done.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
