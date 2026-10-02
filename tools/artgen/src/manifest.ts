// Asset manifest (doc 03 §3) — single source of truth for the pixel-art pack.
// Drives tools/artgen CLI and the in-app admin regen tool.
//
// Style: post-apocalyptic dark fantasy wasteland, 16-bit, muted ash/rust base
// with saturated faction accents, limited palette, no text in art.

export interface AssetSlot {
  id: string;
  group: "style_master" | "survivor" | "role" | "faction" | "card_basic" | "card_tactic" | "card_equipment" | "frame" | "background" | "ui" | "prop";
  prompt: string;
  width: number;
  height: number;
  noBackground?: boolean;
  /** reuse the style-master seed for consistency */
  styleSeeded?: boolean;
  file: string;
}

const STYLE = "pixel art, post-apocalyptic dark fantasy wasteland, 16-bit style, muted ash-grey and rust-brown palette, dusty atmosphere, limited 32-color palette, crisp pixels, no text, game asset";

const FACTION_CUE: Record<string, string> = {
  syndicate: "cybernetic implants, cables, chrome and steel blue accents, machine-worship banners",
  verdant: "plant-mutant features, vines, thorns, glowing green spores",
  tide: "ash-scarred skin, fire and ember motifs, salvaged naval plate, red accents",
  walker: "rags, dust mask, mismatched scavenged gear, bone and grey tones",
  ascendant: "mythic radiant being, golden glow, pre-collapse relics",
};

// ---------------------------------------------------------------------------
// Survivors (25 standard + 2 ascendant) — prompt per character concept
// ---------------------------------------------------------------------------

interface SurvivorArt {
  id: string;
  faction: keyof typeof FACTION_CUE;
  subject: string;
}

const SURVIVOR_ART: SurvivorArt[] = [
  { id: "baron_kaine", faction: "syndicate", subject: "stern middle-aged warlord baron with cybernetic jaw and polished chrome armor, architect of machines, commanding presence" },
  { id: "vex", faction: "syndicate", subject: "thin hooded hacker assassin with glowing eye implant, daggers, whisper-quiet stance" },
  { id: "oracle", faction: "syndicate", subject: "blind seer with cracked visor showing data-streams, cables into skull, prophetic pose" },
  { id: "grim_one_eye", faction: "syndicate", subject: "scarred one-eyed berserker soldier with eyepatch, heavy plating, vengeful glare" },
  { id: "marauder_kesh", faction: "syndicate", subject: "raider captain with grappling hooks and stolen gear trophies, predatory grin" },
  { id: "brute_barehide", faction: "syndicate", subject: "massive shirtless chem-fueled bruiser with piston gauntlets, veins glowing" },
  { id: "bastion", faction: "syndicate", subject: "heavily armored bunker defender with tower shield, immobile fortress stance" },
  { id: "matriarch_vala", faction: "verdant", subject: "wise matriarch druid with bark-skin and flowering vines, maternal authority" },
  { id: "ronan_crimson_blade", faction: "verdant", subject: "red-armored warrior saint with a giant crimson blade, righteous fury" },
  { id: "grog_thunderlung", faction: "verdant", subject: "huge shouting warrior with mutated lungs and war paint, bellowing pose" },
  { id: "wraith_white_ghost", faction: "verdant", subject: "pale silent spear fighter in white tattered cloak, ghost-like agility" },
  { id: "rider_kaan", faction: "verdant", subject: "mutant beast-rider charging on a armored war-steed, lance lowered" },
  { id: "old_eye_hale", faction: "verdant", subject: "elderly sharpshooter with mutated hawk-eye, long weathered rifle" },
  { id: "sage_aldric", faction: "verdant", subject: "old hermit sage with scavenged drone companions, knowing half-smile, staff" },
  { id: "tide_lord_soran", faction: "tide", subject: "corsair lord with harpoon and burning tide crown, sea-king authority" },
  { id: "ember_sage_ryn", faction: "tide", subject: "young quiet ash-mage with smoldering embers orbiting, serene expression" },
  { id: "vesper_blade_dancer", faction: "tide", subject: "agile female blade dancer with twin curved swords, flowing scarves" },
  { id: "corsair_bell", faction: "tide", subject: "grinning pirate raider with boarding axe and bell trophy, wild hair" },
  { id: "quartermaster_orlo", faction: "tide", subject: "burly quartermaster with supply crates and ledger, pragmatic expression" },
  { id: "siren_lyra", faction: "tide", subject: "enchanting siren with coral adornments and hypnotic gaze, song pose" },
  { id: "nyx_the_veil", faction: "tide", subject: "shadowy veiled woman with mirror-shards deflecting blows, mysterious" },
  { id: "warlord_karn", faction: "walker", subject: "towering warlord in spiked scrap armor with chained hounds, unstoppable menace" },
  { id: "femme_black_widow", faction: "walker", subject: "seductive assassin in black widow silk with poisoned daggers, dangerous smile" },
  { id: "doc_mort", faction: "walker", subject: "grim field surgeon with plague-mask and bone saw tools, stained apron" },
  { id: "baron_howl", faction: "walker", subject: "wild artillery baron with mortar tubes on his back, howling at the sky" },
  { id: "crimson_judge", faction: "ascendant", subject: "mythic golden judge spirit with crimson blade and scales of souls, radiant" },
  { id: "hollow_king", faction: "ascendant", subject: "hollow crowned giant of void and gold light, draining presence, mythic" },
];

export const SURVIVOR_SLOTS: AssetSlot[] = SURVIVOR_ART.map((s) => ({
  id: `survivor.${s.id}`,
  group: "survivor",
  prompt: `${s.subject}, ${FACTION_CUE[s.faction]}, single character centered, portrait bust, ${STYLE}`,
  width: 128,
  height: 128,
  styleSeeded: true,
  file: `survivors/${s.id}.png`,
}));

// ---------------------------------------------------------------------------
// Roles & factions
// ---------------------------------------------------------------------------

export const ROLE_SLOTS: AssetSlot[] = [
  { id: "role.sovereign", group: "role", prompt: `emblem badge icon, tarnished golden crown over citadel gate, sovereign ruler sigil, ${STYLE}`, width: 64, height: 64, noBackground: true, styleSeeded: true, file: "roles/sovereign.png" },
  { id: "role.warden", group: "role", prompt: `emblem badge icon, green shield with watchtower, guardian defender sigil, ${STYLE}`, width: 64, height: 64, noBackground: true, styleSeeded: true, file: "roles/warden.png" },
  { id: "role.raider", group: "role", prompt: `emblem badge icon, red crossed machetes over flame, raider attacker sigil, ${STYLE}`, width: 64, height: 64, noBackground: true, styleSeeded: true, file: "roles/raider.png" },
  { id: "role.phantom", group: "role", prompt: `emblem badge icon, blue ghost mask in shadow, lone phantom sigil, ${STYLE}`, width: 64, height: 64, noBackground: true, styleSeeded: true, file: "roles/phantom.png" },
];

export const FACTION_SLOTS: AssetSlot[] = [
  { id: "faction.syndicate", group: "faction", prompt: `faction crest emblem, iron gear skull with chrome wings, steel blue, techno-cult banner, ${STYLE}`, width: 64, height: 64, noBackground: true, styleSeeded: true, file: "factions/syndicate.png" },
  { id: "faction.verdant", group: "faction", prompt: `faction crest emblem, thorned vine wreath with glowing spores, toxic green, mutant-druid banner, ${STYLE}`, width: 64, height: 64, noBackground: true, styleSeeded: true, file: "factions/verdant.png" },
  { id: "faction.tide", group: "faction", prompt: `faction crest emblem, burning wave with harpoon, ember red, corsair clan banner, ${STYLE}`, width: 64, height: 64, noBackground: true, styleSeeded: true, file: "factions/tide.png" },
  { id: "faction.walker", group: "faction", prompt: `faction crest emblem, dust mask with crossed rebar, ash grey, drifter mercenary banner, ${STYLE}`, width: 64, height: 64, noBackground: true, styleSeeded: true, file: "factions/walker.png" },
  { id: "faction.ascendant", group: "faction", prompt: `faction crest emblem, radiant golden eye above ruins, mythic ascendant banner, ${STYLE}`, width: 64, height: 64, noBackground: true, styleSeeded: true, file: "factions/ascendant.png" },
];

// ---------------------------------------------------------------------------
// Card art
// ---------------------------------------------------------------------------

interface CardArt { id: string; group: AssetSlot["group"]; subject: string }

const CARD_ART: CardArt[] = [
  { id: "strike", group: "card_basic", subject: "a rusted machete slashing through dust, motion streak, aggressive strike" },
  { id: "evade", group: "card_basic", subject: "a scavenger dodging sideways under a blow, motion blur, agile evade" },
  { id: "stim", group: "card_basic", subject: "a glowing green syringe stim-pack with cross emblem, healing" },
  { id: "chem_brew", group: "card_basic", subject: "a bubbling orange chem vial with skull label, dangerous brew" },
  { id: "scavenge", group: "card_tactic", subject: "a gloved hand snatching scrap metal from a crate, theft" },
  { id: "sabotage", group: "card_tactic", subject: "an exploding fuel drum with cut cables, sabotage destruction" },
  { id: "proxy_war", group: "card_tactic", subject: "a puppet-master hand moving an armed fighter like a puppet, manipulation" },
  { id: "standoff", group: "card_tactic", subject: "two gunslingers facing off at dusk, Mexican standoff tension" },
  { id: "supply_drop", group: "card_tactic", subject: "a parachute supply crate descending over ruins, salvage hope" },
  { id: "mortar_rain", group: "card_tactic", subject: "mortar shells raining from a dark sky onto a camp, artillery barrage" },
  { id: "mutant_horde", group: "card_tactic", subject: "a charging horde of mutated beasts with glowing eyes, swarm attack" },
  { id: "field_clinic", group: "card_tactic", subject: "a makeshift medical tent with bandaged survivors, field hospital" },
  { id: "signal_jam", group: "card_tactic", subject: "a broken radio tower emitting crackling static waves, signal jamming" },
  { id: "ion_storm", group: "card_tactic", subject: "a violent purple ion storm with lightning striking a radio mast" },
  { id: "ration_cut", group: "card_tactic", subject: "an empty ration tin with a red X slash mark, starvation" },
  { id: "lockdown", group: "card_tactic", subject: "a heavy blast door sealing shut with warning lights, quarantine lockdown" },
  { id: "auto_rifle", group: "card_equipment", subject: "a scrap-built automatic rifle with drum magazine, weapon" },
  { id: "plasma_cutter", group: "card_equipment", subject: "a glowing plasma cutting torch weapon, blue-hot blade" },
  { id: "scrap_launcher", group: "card_equipment", subject: "a jury-rigged junk launcher cannon made of pipes, weapon" },
  { id: "railgun", group: "card_equipment", subject: "a long electromagnetic railgun with capacitors, sniper weapon" },
  { id: "holo_barrier", group: "card_equipment", subject: "a hexagonal holographic energy shield projecting from a bracer" },
  { id: "kevlar_mesh", group: "card_equipment", subject: "a patched kevlar vest armor with ceramic plates" },
  { id: "bulwark_rig", group: "card_equipment", subject: "an armored bulldozer-rig vehicle with welded plates, fortress car" },
  { id: "scout_bike", group: "card_equipment", subject: "a fast dirt scout motorbike with spiked tires, vehicle" },
];

export const CARD_SLOTS: AssetSlot[] = CARD_ART.map((c) => ({
  id: `card.${c.id}`,
  group: c.group,
  prompt: `${c.subject}, ${STYLE}`,
  width: 96,
  height: 96,
  styleSeeded: true,
  file: `cards/${c.id}.png`,
}));

// ---------------------------------------------------------------------------
// Backgrounds, UI, props
// ---------------------------------------------------------------------------

export const ENV_SLOTS: AssetSlot[] = [
  { id: "bg.table", group: "background", prompt: `top-down view of a war-table made of scrap metal and maps in a ruined citadel interior, candle light, empty center space for cards, ${STYLE}`, width: 400, height: 224, styleSeeded: true, file: "backgrounds/table.png" },
  { id: "bg.lobby", group: "background", prompt: `vast wasteland horizon at dusk with a distant fortified citadel and broken highway, ash clouds, ${STYLE}`, width: 400, height: 224, styleSeeded: true, file: "backgrounds/lobby.png" },
  { id: "ui.hp_orb", group: "ui", prompt: `bio-monitor HP orb icon, cracked glass sphere with red liquid, ${STYLE}`, width: 32, height: 32, noBackground: true, styleSeeded: true, file: "ui/hp_orb.png" },
  { id: "ui.fate_banner", group: "ui", prompt: `ornate metal banner frame for a fate card reveal, chains and rivets, ${STYLE}`, width: 160, height: 96, styleSeeded: true, file: "ui/fate_banner.png" },
  { id: "ui.turn_arrow", group: "ui", prompt: `glowing golden turn indicator arrow icon, ${STYLE}`, width: 32, height: 32, noBackground: true, styleSeeded: true, file: "ui/turn_arrow.png" },
  { id: "ui.tether", group: "ui", prompt: `neural tether chain link icon, sparking cable shackle, ${STYLE}`, width: 32, height: 32, noBackground: true, styleSeeded: true, file: "ui/tether.png" },
  { id: "ui.dying_skull", group: "ui", prompt: `cracked skull icon with red glow, dying state marker, ${STYLE}`, width: 32, height: 32, noBackground: true, styleSeeded: true, file: "ui/dying_skull.png" },
  { id: "ui.chem_vial", group: "ui", prompt: `small orange chem vial buff icon, ${STYLE}`, width: 32, height: 32, noBackground: true, styleSeeded: true, file: "ui/chem_vial.png" },
  { id: "prop.card_back", group: "prop", prompt: `card back design, rift sigil emblem on weathered metal plate, ominous purple glow, ${STYLE}`, width: 96, height: 128, styleSeeded: true, file: "props/card_back.png" },
  { id: "prop.deck_pile", group: "prop", prompt: `a stack pile of weathered playing cards bound with leather strap, ${STYLE}`, width: 64, height: 64, noBackground: true, styleSeeded: true, file: "props/deck_pile.png" },
  { id: "prop.discard_pile", group: "prop", prompt: `a scattered messy pile of discarded used cards, ${STYLE}`, width: 64, height: 64, noBackground: true, styleSeeded: true, file: "props/discard_pile.png" },
];

// ---------------------------------------------------------------------------
// Style master — generated FIRST; its seed guides the rest of the pack
// ---------------------------------------------------------------------------

export const STYLE_MASTER: AssetSlot = {
  id: "style.master",
  group: "style_master",
  prompt: `${STYLE}, lone survivor silhouette overlooking a ruined citadel at dusk, four faction banners (steel blue, toxic green, ember red, ash grey) on poles, radioactive green and ember orange glow accents, cracked concrete and scrap-metal textures, establishing key art`,
  width: 256,
  height: 256,
  file: "style_master.png",
};

export const ALL_SLOTS: AssetSlot[] = [STYLE_MASTER, ...SURVIVOR_SLOTS, ...ROLE_SLOTS, ...FACTION_SLOTS, ...CARD_SLOTS, ...ENV_SLOTS];

// 1 style master + 27 survivors + 4 roles + 5 factions + 24 cards + 11 env/ui/props = 82 slots
export const ASSET_COUNT = ALL_SLOTS.length;
