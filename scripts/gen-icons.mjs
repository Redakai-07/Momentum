/**
 * Generates the PWA raster icons from the app mark (src/app/momentum.png).
 * Run: node scripts/gen-icons.mjs   (sharp is a devDependency)
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import sharp from "sharp";

const OUT = "public/icons";
const ANDROID_RES = "android/app/src/main/res";
const mark = await readFile("src/app/momentum.png");

await mkdir(OUT, { recursive: true });

const jobs = [
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
  { name: "icon-maskable-512.png", size: 512 },
  { name: "apple-touch-icon.png", size: 180 },
];

for (const { name, size } of jobs) {
  const png = await sharp(mark).resize(size, size, { fit: "cover" }).png().toBuffer();
  await writeFile(`${OUT}/${name}`, png);
  console.log(`✓ ${OUT}/${name} (${size}×${size})`);
}

const launcherSizes = {
  "mipmap-mdpi": 48,
  "mipmap-hdpi": 72,
  "mipmap-xhdpi": 96,
  "mipmap-xxhdpi": 144,
  "mipmap-xxxhdpi": 192,
};

for (const [directory, size] of Object.entries(launcherSizes)) {
  const launcher = await sharp(mark).resize(size, size, { fit: "cover" }).png().toBuffer();
  const foreground = await sharp(mark).resize(size * 2, size * 2, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
  await writeFile(`${ANDROID_RES}/${directory}/ic_launcher.png`, launcher);
  await writeFile(`${ANDROID_RES}/${directory}/ic_launcher_round.png`, launcher);
  await writeFile(`${ANDROID_RES}/${directory}/ic_launcher_foreground.png`, foreground);
  console.log(`✓ ${ANDROID_RES}/${directory} launcher assets`);
}

const splashFiles = [
  "drawable-land-hdpi/splash.png",
  "drawable-land-mdpi/splash.png",
  "drawable-land-xhdpi/splash.png",
  "drawable-land-xxhdpi/splash.png",
  "drawable-land-xxxhdpi/splash.png",
  "drawable-port-hdpi/splash.png",
  "drawable-port-mdpi/splash.png",
  "drawable-port-xhdpi/splash.png",
  "drawable-port-xxhdpi/splash.png",
  "drawable-port-xxxhdpi/splash.png",
];

for (const relativePath of splashFiles) {
  const sourcePath = `${ANDROID_RES}/${relativePath}`;
  const { data, info } = await sharp(sourcePath).raw().toBuffer({ resolveWithObject: true });
  const splash = await sharp(mark)
    .resize(info.width, info.height, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toBuffer();
  await writeFile(sourcePath, splash);
  console.log(`✓ ${sourcePath}`);
}
