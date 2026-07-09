/**
 * Game Dataset types — the static, typed set of items, recipes, and buildings
 * parsed from the game's official `Docs.json` dump for one specific game release
 * (see ADR-0001). These types describe the *serializable* shape stored in
 * `packages/game-data/data/<version>.json`; the parser (written by another agent)
 * produces exactly this shape.
 *
 * Conventions:
 * - `className` is the game's stable native class identifier (e.g.
 *   "Desc_IronIngot_C", "Recipe_IngotIron_C", "Build_ConstructorMk1_C"). It is the
 *   primary key used across all cross-references in the dataset and in Plans.
 * - All throughput is normalized to **items per minute** (fluids are m³/min) so
 *   downstream code never has to reason about per-craft durations.
 */

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/** Physical form of an item — determines whether it travels on Belts or Pipes. */
export type ItemForm = "solid" | "liquid" | "gas";

/** A single item/resource/fluid in the game. */
export interface Item {
  /** Stable native class id, e.g. "Desc_IronIngot_C". Primary key. */
  className: string;
  /** Human-readable name, e.g. "Iron Ingot". */
  displayName: string;
  /** Flavor/description text from the dump, if present. */
  description?: string;
  /** solid / liquid / gas. Fluids (liquid|gas) must be carried by Pipes. */
  form: ItemForm;
  /** Inventory stack size for solids; undefined for fluids. */
  stackSize?: number;
  /** Energy value in MJ when burned as fuel; undefined for non-fuel items. */
  energyMJ?: number;
  /** AWESOME Sink point value, if the item is sinkable. */
  sinkPoints?: number;
  /** Whether the item is a raw resource extracted from the world. */
  isRawResource: boolean;
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

/**
 * One item stack within a recipe, given both as the raw per-craft amount and as
 * the normalized rate per minute at 100% clock speed (no Somersloops).
 */
export interface RecipeItemRate {
  /** className of the {@link Item}. */
  item: string;
  /** Amount produced/consumed per single craft cycle. */
  amountPerCraft: number;
  /** Normalized throughput at 100% clock, no Somersloops (items or m³ / min). */
  ratePerMinute: number;
}

/** A production recipe (standard or alternate). */
export interface Recipe {
  /** Stable native class id, e.g. "Recipe_IngotIron_C". Primary key. */
  className: string;
  /** Human-readable name, e.g. "Iron Ingot". */
  displayName: string;
  /** Input item stacks. */
  ingredients: RecipeItemRate[];
  /** Output item stacks (>1 for recipes with byproducts). */
  products: RecipeItemRate[];
  /** className of the {@link Building} (Manufacturer/Extractor) that runs it. */
  producedIn: string;
  /** Craft duration in seconds at 100% clock speed. */
  durationSeconds: number;
  /** True for Alternate recipes; false for the standard recipe. */
  isAlternate: boolean;
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

/** Discriminant for the {@link Building} union. */
export type BuildingKind =
  | "manufacturer"
  | "extractor"
  | "generator"
  | "splitter"
  | "merger";

interface BuildingBase {
  /** Stable native class id, e.g. "Build_ConstructorMk1_C". Primary key. */
  className: string;
  /** Human-readable name, e.g. "Constructor". */
  displayName: string;
  description?: string;
}

/**
 * A recipe-running production building (Constructor, Assembler, Refinery,
 * Manufacturer, Blender, Particle Accelerator, Packager, Foundry, Smelter, ...).
 * Generators are modeled separately (see {@link GeneratorBuilding}).
 */
export interface ManufacturerBuilding extends BuildingBase {
  kind: "manufacturer";
  /** Number of Somersloop slots; a fully slotted machine doubles output. */
  somersloopSlots: number;
  /** Power draw in MW at 100% clock, no Somersloops. */
  basePowerMW: number;
  /**
   * Exponent of the clock-speed power curve (power scales as
   * clock^exponent). ~1.321928 in-game; carried per-building for accuracy.
   */
  powerConsumptionExponent: number;
}

/** Extractor sub-type; also implies which resource-node/fluid it works with. */
export type ExtractorType =
  | "miner"
  | "waterExtractor"
  | "oilExtractor"
  | "resourceWell";

/**
 * A building that pulls raw resources from the world. Miners have an Mk variant
 * and sit on a resource node whose Purity multiplies the rate; Water/Oil
 * extractors have a fixed rate.
 */
export interface ExtractorBuilding extends BuildingBase {
  kind: "extractor";
  extractorType: ExtractorType;
  /** className list of {@link Item}s this extractor may pull (raw resources). */
  allowedResources: string[];
  /**
   * Base extraction rate per minute at 100% clock, Normal purity. Multiply by
   * the Purity multiplier and clock fraction to get the actual rate.
   */
  baseRatePerMinute: number;
  /** Mk variant for Miners (1–3); undefined for non-Mk extractors. */
  mk?: MinerMk;
  /** Power draw in MW at 100% clock. */
  basePowerMW: number;
  /** Clock-speed power-curve exponent. */
  powerConsumptionExponent: number;
}

/**
 * A power-producing building that consumes fuel items via normal flow (Coal/Fuel/
 * Nuclear/Biomass generators). Contributes MW to the Plan's Power Balance.
 */
export interface GeneratorBuilding extends BuildingBase {
  kind: "generator";
  /** className list of {@link Item}s usable as fuel. */
  fuelClasses: string[];
  /** Power produced in MW at 100% clock. */
  powerProductionMW: number;
  /**
   * className of a supplemental resource consumed alongside fuel (e.g. Water for
   * Coal/Fuel generators), if any.
   */
  supplementalResource?: string;
  /** Supplemental resource consumption in m³/min at 100% clock, if any. */
  supplementalRatePerMinute?: number;
  /**
   * className of the byproduct produced (e.g. Nuclear Waste), if any, with its
   * production rate per minute at 100% clock.
   */
  byproduct?: { item: string; ratePerMinute: number };
}

/** A Splitter logistics building (1 input → up to 3 outputs). */
export interface SplitterBuilding extends BuildingBase {
  kind: "splitter";
  /** True for a Programmable/Smart splitter (routing rules); false otherwise. */
  smart: boolean;
}

/** A Merger logistics building (up to 3 inputs → 1 output). */
export interface MergerBuilding extends BuildingBase {
  kind: "merger";
}

/** All building descriptors, discriminated on {@link BuildingKind}. */
export type Building =
  | ManufacturerBuilding
  | ExtractorBuilding
  | GeneratorBuilding
  | SplitterBuilding
  | MergerBuilding;

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

/** Resource-node richness an Extractor sits on. */
export type Purity = "impure" | "normal" | "pure";

/** Rate multipliers by {@link Purity}. */
export const PURITY_MULTIPLIER: Record<Purity, number> = {
  impure: 0.5,
  normal: 1,
  pure: 2,
};

// ---------------------------------------------------------------------------
// Belt / Pipe capacity tables
// ---------------------------------------------------------------------------

/** Belt Mk variant (Mk1–Mk6). */
export type BeltMk = 1 | 2 | 3 | 4 | 5 | 6;

/** Pipe Mk variant (Mk1–Mk2). */
export type PipeMk = 1 | 2;

/** Miner Mk variant (Mk1–Mk3). */
export type MinerMk = 1 | 2 | 3;

/** Maximum Belt throughput in items/min by Mk (game 1.2). */
export const BELT_CAPACITY_PER_MINUTE: Record<BeltMk, number> = {
  1: 60,
  2: 120,
  3: 270,
  4: 480,
  5: 780,
  6: 1200,
};

/** Maximum Pipe throughput in m³/min by Mk (game 1.2). */
export const PIPE_CAPACITY_PER_MINUTE: Record<PipeMk, number> = {
  1: 300,
  2: 600,
};

// ---------------------------------------------------------------------------
// Dataset index
// ---------------------------------------------------------------------------

/**
 * A fully-loaded Game Dataset for one game version: the serializable content of
 * `data/<version>.json`. Records are keyed by `className` for O(1) lookup.
 */
export interface DatasetIndex {
  /** Game release this dataset was parsed from, e.g. "1.2". */
  version: string;
  items: Record<string, Item>;
  recipes: Record<string, Recipe>;
  buildings: Record<string, Building>;
  /** Belt capacity table (mirrors {@link BELT_CAPACITY_PER_MINUTE}). */
  beltCapacity: Record<BeltMk, number>;
  /** Pipe capacity table (mirrors {@link PIPE_CAPACITY_PER_MINUTE}). */
  pipeCapacity: Record<PipeMk, number>;
}
