// Client asset loader — maps generated pixel-art files to bundled URLs.
// Generated assets live in src/assets/generated/ (approved by tools/artgen).
// import.meta.glob eager-imports them so Vite bundles + hashes them into dist.
// Every lookup falls back to a placeholder gracefully (art is optional data).

const generated = import.meta.glob("../assets/generated/**/*", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

/** Resolve a generated asset by its manifest file path ("survivors/baron_kaine.png").
 *  Returns undefined when the asset isn't approved/bundled yet → callers fall back. */
export function assetUrl(file: string): string | undefined {
  const key = `../assets/generated/${file}`;
  return generated[key] ?? generated[`./assets/generated/${file}`];
}

/** Survivor portrait by survivor id (e.g. "baron_kaine"); falls back to undefined. */
export function survivorPortrait(id: string): string | undefined {
  return assetUrl(`survivors/${id}.png`);
}

/** Card art by defId (e.g. "strike"); falls back to undefined. */
export function cardArt(defId: string): string | undefined {
  return assetUrl(`cards/${defId}.png`);
}

/** Background art (table / lobby). */
export function backgroundArt(kind: "table" | "lobby"): string | undefined {
  return assetUrl(`backgrounds/${kind}.png`);
}

/** Role badge (sovereign / warden / raider / phantom). */
export function roleBadge(role: string): string | undefined {
  return assetUrl(`roles/${role}.png`);
}

/** Faction crest (syndicate / verdant / tide / walker / ascendant). */
export function factionCrest(faction: string): string | undefined {
  return assetUrl(`factions/${faction}.png`);
}