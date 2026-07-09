/**
 * parse-docs.ts — converts the game's official `Docs.json` dump into a static,
 * typed Game Dataset (see ADR-0001) written to `packages/game-data/data/1.2.json`,
 * conforming exactly to the {@link DatasetIndex} contract in `src/types.ts`.
 *
 * Run with `bun run parse` from this package. The source dump is UTF-16 LE encoded.
 *
 * Throughput is normalized to items/min for solids and m³/min for fluids. Fluid
 * amounts in the dump are expressed in litres (×1000) and fluid energy values in
 * MJ/litre; both are scaled to m³ here so downstream code reasons in one unit
 * system per form.
 */

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  BELT_CAPACITY_PER_MINUTE,
  PIPE_CAPACITY_PER_MINUTE,
  type Building,
  type DatasetIndex,
  type ExtractorBuilding,
  type ExtractorType,
  type GeneratorBuilding,
  type Item,
  type ItemForm,
  type ManufacturerBuilding,
  type MinerMk,
  type Recipe,
  type RecipeItemRate,
} from "../src/types";

const VERSION = "1.2";
const DOCS_PATH =
  "C:/Program Files (x86)/Steam/steamapps/common/Satisfactory/CommunityResources/Docs/en-US.json";

// ---------------------------------------------------------------------------
// Raw dump access
// ---------------------------------------------------------------------------

interface DumpEntry {
  NativeClass: string;
  Classes: Record<string, unknown>[];
}

/** Content that is not production-relevant and must never enter the dataset. */
const EXCLUDE_RE =
  /FICSMAS|Snow|Candy|Xmas|Christmas|Gift|Firework|Wreath|Fireap/i;

async function loadDump(): Promise<Map<string, Record<string, unknown>[]>> {
  const buf = await Bun.file(DOCS_PATH).arrayBuffer();
  const text = new TextDecoder("utf-16le").decode(buf);
  const dump = JSON.parse(text) as DumpEntry[];
  const byNative = new Map<string, Record<string, unknown>[]>();
  for (const group of dump) {
    const m = group.NativeClass.match(/FactoryGame\.(\w+)'?$/);
    byNative.set(m ? m[1]! : group.NativeClass, group.Classes);
  }
  return byNative;
}

// ---------------------------------------------------------------------------
// Small parsing helpers over the dump's stringly-typed values
// ---------------------------------------------------------------------------

const num = (v: unknown): number => Number.parseFloat(String(v ?? "0")) || 0;
const str = (v: unknown): string => String(v ?? "");

/** Extract every `Desc_*_C` / `Build_*_C` class token from a blob of text. */
function classTokens(v: unknown, prefix: "Desc" | "Build"): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\.(${prefix}_[A-Za-z0-9_]+_C)`, "g");
  let m: RegExpExecArray | null;
  const s = str(v);
  while ((m = re.exec(s))) out.push(m[1]!);
  return [...new Set(out)];
}

const FORM: Record<string, ItemForm> = {
  RF_SOLID: "solid",
  RF_LIQUID: "liquid",
  RF_GAS: "gas",
};

const isFluidForm = (f: ItemForm): boolean => f === "liquid" || f === "gas";

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/** Native-class groups whose entries are production-relevant item descriptors. */
const ITEM_GROUPS = [
  "FGItemDescriptor",
  "FGResourceDescriptor",
  "FGItemDescriptorNuclearFuel",
  "FGItemDescriptorBiomass",
  "FGItemDescriptorPowerBoosterFuel",
  "FGConsumableDescriptor",
  "FGPowerShardDescriptor",
  "FGAmmoTypeProjectile",
  "FGAmmoTypeInstantHit",
  "FGAmmoTypeSpreadshot",
  "FGEquipmentDescriptor",
];

function buildItems(byNative: Map<string, Record<string, unknown>[]>): {
  items: Record<string, Item>;
  rawResources: Set<string>;
} {
  const items: Record<string, Item> = {};
  const rawResources = new Set<string>();
  for (const group of ITEM_GROUPS) {
    const isResourceGroup = group === "FGResourceDescriptor";
    for (const c of byNative.get(group) ?? []) {
      const className = str(c.ClassName);
      if (!className || EXCLUDE_RE.test(className)) continue;
      const form = FORM[str(c.mForm)] ?? "solid";
      const fluid = isFluidForm(form);
      const rawEnergy = num(c.mEnergyValue);
      const energyMJ = rawEnergy > 0 ? (fluid ? rawEnergy * 1000 : rawEnergy) : undefined;
      const sink = num(c.mResourceSinkPoints);
      const item: Item = {
        className,
        displayName: str(c.mDisplayName),
        form,
        isRawResource: isResourceGroup,
      };
      const desc = str(c.mDescription).trim();
      if (desc) item.description = desc;
      if (!fluid) {
        const stack = num(c.mCachedStackSize);
        if (stack > 0) item.stackSize = stack;
      }
      if (energyMJ !== undefined) item.energyMJ = energyMJ;
      if (sink > 0) item.sinkPoints = sink;
      items[className] = item;
      if (isResourceGroup) rawResources.add(className);
    }
  }
  return { items, rawResources };
}

// ---------------------------------------------------------------------------
// Buildings — manufacturers, extractors, generators, splitters, mergers
// ---------------------------------------------------------------------------

const EXPONENT = (c: Record<string, unknown>) =>
  num(c.mPowerConsumptionExponent) || 1.321929;

function variablePower(c: Record<string, unknown>): number {
  const min = num(c.mEstimatedMininumPowerConsumption);
  const max = num(c.mEstimatedMaximumPowerConsumption);
  return (min + max) / 2;
}

function buildManufacturers(
  byNative: Map<string, Record<string, unknown>[]>,
): { list: ManufacturerBuilding[]; classes: Set<string> } {
  const list: ManufacturerBuilding[] = [];
  const classes = new Set<string>();
  for (const group of ["FGBuildableManufacturer", "FGBuildableManufacturerVariablePower"]) {
    for (const c of byNative.get(group) ?? []) {
      const className = str(c.ClassName);
      if (!className) continue;
      const fixedPower = num(c.mPowerConsumption);
      list.push({
        className,
        displayName: str(c.mDisplayName),
        kind: "manufacturer",
        somersloopSlots: num(c.mProductionShardSlotSize),
        basePowerMW: fixedPower > 0 ? fixedPower : variablePower(c),
        powerConsumptionExponent: EXPONENT(c),
      });
      classes.add(className);
    }
  }
  return { list, classes };
}

const MINER_MK: Record<string, MinerMk> = {
  Build_MinerMk1_C: 1,
  Build_MinerMk2_C: 2,
  Build_MinerMk3_C: 3,
};

function extractorRate(c: Record<string, unknown>, form: ItemForm): number {
  const perCycle = num(c.mItemsPerCycle);
  const cycle = num(c.mExtractCycleTime) || 1;
  const rate = (perCycle * 60) / cycle;
  return isFluidForm(form) ? rate / 1000 : rate;
}

function buildExtractors(
  byNative: Map<string, Record<string, unknown>[]>,
  rawResources: Set<string>,
): ExtractorBuilding[] {
  const list: ExtractorBuilding[] = [];
  const solidResources = [...rawResources].filter(
    (r) => str((byNative.get("FGResourceDescriptor") ?? []).find((c) => str(c.ClassName) === r)?.mForm) === "RF_SOLID",
  );

  const push = (
    c: Record<string, unknown>,
    type: ExtractorType,
    form: ItemForm,
    allowed: string[],
    mk?: MinerMk,
  ) => {
    const b: ExtractorBuilding = {
      className: str(c.ClassName),
      displayName: str(c.mDisplayName),
      kind: "extractor",
      extractorType: type,
      allowedResources: allowed,
      baseRatePerMinute: extractorRate(c, form),
      basePowerMW: num(c.mPowerConsumption),
      powerConsumptionExponent: EXPONENT(c),
    };
    if (mk !== undefined) b.mk = mk;
    list.push(b);
  };

  for (const c of byNative.get("FGBuildableResourceExtractor") ?? []) {
    const className = str(c.ClassName);
    if (className in MINER_MK) {
      // Solid miners: allowedResources empty in dump ⇒ any solid resource node.
      push(c, "miner", "solid", solidResources, MINER_MK[className]);
    } else {
      // Oil Extractor (fixed liquid extractor).
      push(c, "oilExtractor", "liquid", classTokens(c.mAllowedResources, "Desc"));
    }
  }
  for (const c of byNative.get("FGBuildableWaterPump") ?? []) {
    push(c, "waterExtractor", "liquid", classTokens(c.mAllowedResources, "Desc"));
  }
  for (const c of byNative.get("FGBuildableFrackingExtractor") ?? []) {
    // Resource Well Extractor: per-satellite base rate; supports liquid + gas.
    push(c, "resourceWell", "liquid", classTokens(c.mAllowedResources, "Desc"));
  }
  return list;
}

function buildGenerators(
  byNative: Map<string, Record<string, unknown>[]>,
  items: Record<string, Item>,
): GeneratorBuilding[] {
  const list: GeneratorBuilding[] = [];

  const fromFuelGen = (c: Record<string, unknown>): GeneratorBuilding => {
    const power = num(c.mPowerProduction);
    const fuelEntries = Array.isArray(c.mFuel)
      ? (c.mFuel as Record<string, unknown>[])
      : [];
    const fuelClasses = classTokens(c.mDefaultFuelClasses, "Desc").filter(
      (f) => f in items,
    );
    const g: GeneratorBuilding = {
      className: str(c.ClassName),
      displayName: str(c.mDisplayName),
      kind: "generator",
      fuelClasses,
      powerProductionMW: power,
    };
    // Supplemental resource (e.g. Water) — rate = power · ratio, litres→m³, per min.
    if (str(c.mRequiresSupplementalResource) === "True") {
      const supp = fuelEntries.find((f) => str(f.mSupplementalResourceClass));
      const suppClass = supp ? str(supp.mSupplementalResourceClass) : "";
      const ratio = num(c.mSupplementalToPowerRatio);
      if (suppClass) {
        g.supplementalResource = suppClass;
        g.supplementalRatePerMinute = (power * ratio * 60) / 1000;
      }
    }
    // Byproduct (e.g. Nuclear Waste) computed for the primary fuel that has one.
    const byFuel = fuelEntries.find((f) => str(f.mByproduct));
    if (byFuel) {
      const fuelItem = items[str(byFuel.mFuelClass)];
      const amount = num(byFuel.mByproductAmount);
      if (fuelItem?.energyMJ && amount > 0) {
        g.byproduct = {
          item: str(byFuel.mByproduct),
          ratePerMinute: ((power * 60) / fuelItem.energyMJ) * amount,
        };
      }
    }
    return g;
  };

  for (const group of [
    "FGBuildableGeneratorFuel",
    "FGBuildableGeneratorNuclear",
  ]) {
    for (const c of byNative.get(group) ?? []) list.push(fromFuelGen(c));
  }
  // Geothermal: fuel-less, variable output; nominal = its production factor.
  for (const c of byNative.get("FGBuildableGeneratorGeoThermal") ?? []) {
    list.push({
      className: str(c.ClassName),
      displayName: str(c.mDisplayName),
      kind: "generator",
      fuelClasses: [],
      powerProductionMW: num(c.mVariablePowerProductionFactor),
    });
  }
  return list;
}

function buildLogistics(
  byNative: Map<string, Record<string, unknown>[]>,
): Building[] {
  const out: Building[] = [];
  for (const group of ["FGBuildableSplitterSmart", "FGBuildableAttachmentSplitter"]) {
    for (const c of byNative.get(group) ?? []) {
      out.push({
        className: str(c.ClassName),
        displayName: str(c.mDisplayName),
        kind: "splitter",
        smart: group === "FGBuildableSplitterSmart",
      });
    }
  }
  for (const group of ["FGBuildableAttachmentMerger", "FGBuildableMergerPriority"]) {
    for (const c of byNative.get(group) ?? []) {
      out.push({
        className: str(c.ClassName),
        displayName: str(c.mDisplayName),
        kind: "merger",
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

/** Parse a `((ItemClass="…Desc_X_C'",Amount=N),…)` stack list. */
function parseStacks(
  raw: string,
  items: Record<string, Item>,
): RecipeItemRate[] | null {
  const re = /ItemClass="[^"]*\.([A-Za-z0-9_]+_C)'?",Amount=([0-9.]+)/g;
  const stacks: RecipeItemRate[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const item = m[1]!;
    const meta = items[item];
    if (!meta) return null; // references an excluded/unknown item ⇒ drop recipe
    const amt = Number.parseFloat(m[2]!);
    const amountPerCraft = isFluidForm(meta.form) ? amt / 1000 : amt;
    stacks.push({ item, amountPerCraft, ratePerMinute: 0 });
  }
  return stacks;
}

function buildRecipes(
  byNative: Map<string, Record<string, unknown>[]>,
  items: Record<string, Item>,
  manufacturerClasses: Set<string>,
): Recipe[] {
  const recipes: Recipe[] = [];
  for (const c of byNative.get("FGRecipe") ?? []) {
    const className = str(c.ClassName);
    if (!className || EXCLUDE_RE.test(className)) continue;

    // Only automatable recipes: produced in a real manufacturer building.
    const producedIn = classTokens(c.mProducedIn, "Build").find((b) =>
      manufacturerClasses.has(b),
    );
    if (!producedIn) continue;

    const ingredients = parseStacks(str(c.mIngredients), items);
    const products = parseStacks(str(c.mProduct), items);
    if (!ingredients || !products || products.length === 0) continue;

    const duration = num(c.mManufactoringDuration) || 1;
    const perMin = (amount: number) => (amount * 60) / duration;
    for (const s of ingredients) s.ratePerMinute = perMin(s.amountPerCraft);
    for (const s of products) s.ratePerMinute = perMin(s.amountPerCraft);

    const displayName = str(c.mDisplayName);
    recipes.push({
      className,
      displayName,
      ingredients,
      products,
      producedIn,
      durationSeconds: duration,
      isAlternate:
        className.startsWith("Recipe_Alternate_") ||
        displayName.startsWith("Alternate:"),
    });
  }
  return recipes;
}

// ---------------------------------------------------------------------------
// Assemble & emit
// ---------------------------------------------------------------------------

async function main() {
  const byNative = await loadDump();

  const { items, rawResources } = buildItems(byNative);
  const { list: manufacturers, classes: manufacturerClasses } =
    buildManufacturers(byNative);
  const extractors = buildExtractors(byNative, rawResources);
  const generators = buildGenerators(byNative, items);
  const logistics = buildLogistics(byNative);
  const recipes = buildRecipes(byNative, items, manufacturerClasses);

  const buildings: Record<string, Building> = {};
  for (const b of [...manufacturers, ...extractors, ...generators, ...logistics]) {
    buildings[b.className] = b;
  }

  // Prune items never referenced by a recipe or generator and not raw resources,
  // keeping the dataset to production-relevant parts.
  const referenced = new Set<string>(rawResources);
  for (const r of recipes)
    for (const s of [...r.ingredients, ...r.products]) referenced.add(s.item);
  for (const g of generators) {
    for (const f of g.fuelClasses) referenced.add(f);
    if (g.supplementalResource) referenced.add(g.supplementalResource);
    if (g.byproduct) referenced.add(g.byproduct.item);
  }
  const prunedItems: Record<string, Item> = {};
  for (const [k, v] of Object.entries(items))
    if (referenced.has(k)) prunedItems[k] = v;

  const recipeIndex: Record<string, Recipe> = {};
  for (const r of recipes) recipeIndex[r.className] = r;

  const dataset: DatasetIndex = {
    version: VERSION,
    items: prunedItems,
    recipes: recipeIndex,
    buildings,
    beltCapacity: { ...BELT_CAPACITY_PER_MINUTE },
    pipeCapacity: { ...PIPE_CAPACITY_PER_MINUTE },
  };

  const outPath = fileURLToPath(
    new URL(`../data/${VERSION}.json`, import.meta.url),
  );
  await writeFile(outPath, JSON.stringify(dataset, null, 2), "utf8");

  // ---- summary ----------------------------------------------------------
  const counts = {
    items: Object.keys(prunedItems).length,
    recipes: recipes.length,
    "  alternates": recipes.filter((r) => r.isAlternate).length,
    manufacturers: manufacturers.length,
    extractors: extractors.length,
    generators: generators.length,
    splitters: logistics.filter((b) => b.kind === "splitter").length,
    mergers: logistics.filter((b) => b.kind === "merger").length,
  };
  console.log(`Game Dataset ${VERSION} written to ${outPath}`);
  for (const [k, v] of Object.entries(counts)) {
    console.log(`  ${k.padEnd(14)} ${v}`);
  }
}

await main();
