// Build a contact-sheet HTML from the generated art for visual approval.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ALL_SLOTS } from "./manifest.js";

const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const OUT_DIR = process.env.ARTGEN_OUT ?? join(ROOT, "tools/artgen/work");
const SHEET = join(ROOT, "tools/artgen/contact-sheet.html");

const rows = ALL_SLOTS.map((slot) => {
  const p = join(OUT_DIR, slot.file);
  if (!existsSync(p)) return null;
  const b64 = readFileSync(p).toString("base64");
  return {
    id: slot.id,
    group: slot.group,
    width: slot.width,
    height: slot.height,
    src: `data:image/png;base64,${b64}`,
  };
}).filter(Boolean) as { id: string; group: string; width: number; height: number; src: string }[];

const GROUP_LABEL: Record<string, string> = {
  style_master: "Style Master",
  survivor: "Survivors (27)",
  role: "Role Badges (4)",
  faction: "Faction Crests (5)",
  card_basic: "Basic Cards (4)",
  card_tactic: "Tactics + Delayed (12)",
  card_equipment: "Equipment (8)",
  background: "Backgrounds (2)",
  ui: "UI Icons (6)",
  prop: "Props (3)",
};

const groups = Object.keys(GROUP_LABEL)
  .map((g) => ({ g, items: rows.filter((r) => r.group === g) }))
  .filter((x) => x.items.length > 0);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ASHFALL — Pixel Art Pack (${rows.length}/${ALL_SLOTS.length})</title>
<style>
  body { background: #14100c; color: #e8e0cf; font-family: monospace; padding: 1.5rem; }
  h1 { color: #e8c547; letter-spacing: 0.2em; }
  h2 { color: #b0a899; margin: 1.5rem 0 0.5rem; border-bottom: 1px solid #3a3226; padding-bottom: 0.3rem; }
  .grid { display: flex; flex-wrap: wrap; gap: 0.8rem; }
  .tile {
    background: #221d17; border: 1px solid #3a3226; padding: 0.5rem;
    text-align: center; width: 150px;
  }
  .tile img { image-rendering: pixelated; image-rendering: crisp-edges; max-width: 100%; }
  .tile .id { font-size: 0.65rem; color: #9a917f; word-break: break-all; }
  .tile .dim { font-size: 0.6rem; color: #6b6357; }
  .bad { border-color: #c8402f; }
</style>
</head>
<body>
<h1>⚡ ASHFALL — Pixel Art Pack</h1>
<p>${rows.length} generated · style master + 27 survivors + 4 roles + 5 factions + 24 cards + ui/props</p>
${groups.map(({ g, items }) => `
  <h2>${GROUP_LABEL[g]}</h2>
  <div class="grid">
    ${items.map((t) => `
      <div class="tile" title="${t.id}">
        <img src="${t.src}" width="${Math.min(160, t.width * 2)}" height="${Math.min(160, t.height * 2)}" alt="${t.id}" />
        <div class="id">${t.id}</div>
        <div class="dim">${t.width}×${t.height}</div>
      </div>`).join("")}
  </div>`).join("")}
</body>
</html>`;

mkdirSync(join(ROOT, "tools/artgen"), { recursive: true });
writeFileSync(SHEET, html);
console.log(`contact sheet: ${SHEET} (${rows.length} assets)`);