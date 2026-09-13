/**
 * Generates the PWA raster icons from the app mark (src/app/momentum.png).
 * Run: node scripts/gen-icons.mjs   (sharp is a devDependency)
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import sharp from "sharp";

const OUT = "public/icons";
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
