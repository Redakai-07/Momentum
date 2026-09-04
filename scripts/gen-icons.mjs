/**
 * Generates the PWA raster icons from the app mark (src/app/icon.svg).
 * Run: node scripts/gen-icons.mjs   (sharp is a devDependency)
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import sharp from "sharp";

const OUT = "public/icons";
const mark = await readFile("src/app/icon.svg", "utf8");

/**
 * Maskable icons need a full-bleed background and artwork inside the inner
 * ~80% safe circle. The mark is re-emitted with a square (rx=0) backdrop and
 * a slightly inset ring so nothing gets clipped by the platform mask.
 */
const maskable = mark
  .replace('rx="14"', 'rx="0"')
  .replace('cx="32" cy="32" r="17"', 'cx="32" cy="32" r="16"')
  .replace('cx="32" cy="32" r="8"', 'cx="32" cy="32" r="7.5"');

await mkdir(OUT, { recursive: true });

const jobs = [
  { name: "icon-192.png", svg: mark, size: 192 },
  { name: "icon-512.png", svg: mark, size: 512 },
  { name: "icon-maskable-512.png", svg: maskable, size: 512 },
  { name: "apple-touch-icon.png", svg: maskable, size: 180 },
];

for (const { name, svg, size } of jobs) {
  const png = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  await writeFile(`${OUT}/${name}`, png);
  console.log(`✓ ${OUT}/${name} (${size}×${size})`);
}
