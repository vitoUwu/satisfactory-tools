/**
 * Minimal inline {@link DatasetIndex} + {@link PlanGraph} builders for the solver
 * tests. These are hand-authored fixtures (not the pinned 1.2 dataset) so the engine
 * package tests never depend on `packages/game-data/data/1.2.json` existing.
 */

import {
  BELT_CAPACITY_PER_MINUTE,
  PIPE_CAPACITY_PER_MINUTE,
} from "@satisfactory-tools/game-data";
import type {
  Building,
  DatasetIndex,
  Item,
  MinerMk,
  Recipe,
} from "@satisfactory-tools/game-data";

import type { PlanEdge, PlanGraph, PlanNode } from "./graph";

const POWER_EXP = 1.321928;

const items: Item[] = [
  { className: "Desc_OreIron_C", displayName: "Iron Ore", form: "solid", isRawResource: true },
  { className: "Desc_IronIngot_C", displayName: "Iron Ingot", form: "solid", isRawResource: false },
  { className: "Desc_IronPlate_C", displayName: "Iron Plate", form: "solid", isRawResource: false },
  { className: "Desc_Rubber_C", displayName: "Rubber", form: "solid", isRawResource: false },
  { className: "Desc_Plastic_C", displayName: "Plastic", form: "solid", isRawResource: false },
  { className: "Desc_Water_C", displayName: "Water", form: "liquid", isRawResource: true },
  { className: "Desc_Coal_C", displayName: "Coal", form: "solid", isRawResource: true, energyMJ: 300 },
];

const buildings: Building[] = [
  {
    className: "Build_MinerMk1_C",
    displayName: "Miner Mk.1",
    kind: "extractor",
    extractorType: "miner",
    allowedResources: ["Desc_OreIron_C"],
    baseRatePerMinute: 60,
    mk: 1,
    basePowerMW: 5,
    powerConsumptionExponent: POWER_EXP,
  },
  {
    className: "Build_SmelterMk1_C",
    displayName: "Smelter",
    kind: "manufacturer",
    somersloopSlots: 1,
    basePowerMW: 4,
    powerConsumptionExponent: POWER_EXP,
  },
  {
    className: "Build_ConstructorMk1_C",
    displayName: "Constructor",
    kind: "manufacturer",
    somersloopSlots: 1,
    basePowerMW: 4,
    powerConsumptionExponent: POWER_EXP,
  },
  {
    className: "Build_RefineryMk1_C",
    displayName: "Refinery",
    kind: "manufacturer",
    somersloopSlots: 2,
    basePowerMW: 30,
    powerConsumptionExponent: POWER_EXP,
  },
  { className: "Build_Splitter_C", displayName: "Splitter", kind: "splitter", smart: false },
  { className: "Build_Merger_C", displayName: "Merger", kind: "merger" },
  {
    className: "Build_GeneratorCoal_C",
    displayName: "Coal Generator",
    kind: "generator",
    fuelClasses: ["Desc_Coal_C"],
    powerProductionMW: 75,
  },
];

const recipes: Recipe[] = [
  {
    className: "Recipe_IronIngot_C",
    displayName: "Iron Ingot",
    ingredients: [{ item: "Desc_OreIron_C", amountPerCraft: 1, ratePerMinute: 30 }],
    products: [{ item: "Desc_IronIngot_C", amountPerCraft: 1, ratePerMinute: 30 }],
    producedIn: "Build_SmelterMk1_C",
    durationSeconds: 2,
    isAlternate: false,
  },
  {
    className: "Recipe_IronPlate_C",
    displayName: "Iron Plate",
    ingredients: [{ item: "Desc_IronIngot_C", amountPerCraft: 3, ratePerMinute: 30 }],
    products: [{ item: "Desc_IronPlate_C", amountPerCraft: 2, ratePerMinute: 20 }],
    producedIn: "Build_ConstructorMk1_C",
    durationSeconds: 6,
    isAlternate: false,
  },
  {
    // Alternate Iron Ingot recipe (produced in a Smelter) — used to test that the
    // Solver Assist honors a Recipe Preference instead of the standard recipe.
    className: "Recipe_Alternate_IronIngot_C",
    displayName: "Pure Iron Ingot",
    ingredients: [{ item: "Desc_OreIron_C", amountPerCraft: 2, ratePerMinute: 40 }],
    products: [{ item: "Desc_IronIngot_C", amountPerCraft: 3, ratePerMinute: 60 }],
    producedIn: "Build_SmelterMk1_C",
    durationSeconds: 3,
    isAlternate: true,
  },
  {
    // A refinery recipe that consumes water and returns some water — a fluid loop.
    className: "Recipe_WaterLoop_C",
    displayName: "Water Loop",
    ingredients: [
      { item: "Desc_Rubber_C", amountPerCraft: 1, ratePerMinute: 10 },
      { item: "Desc_Water_C", amountPerCraft: 1, ratePerMinute: 10 },
    ],
    products: [
      { item: "Desc_Plastic_C", amountPerCraft: 1, ratePerMinute: 10 },
      { item: "Desc_Water_C", amountPerCraft: 1, ratePerMinute: 2 },
    ],
    producedIn: "Build_RefineryMk1_C",
    durationSeconds: 6,
    isAlternate: false,
  },
];

export function makeDataset(): DatasetIndex {
  return {
    version: "test",
    items: Object.fromEntries(items.map((i) => [i.className, i])),
    recipes: Object.fromEntries(recipes.map((r) => [r.className, r])),
    buildings: Object.fromEntries(buildings.map((b) => [b.className, b])),
    beltCapacity: { ...BELT_CAPACITY_PER_MINUTE },
    pipeCapacity: { ...PIPE_CAPACITY_PER_MINUTE },
  };
}

// --- Graph construction helpers --------------------------------------------

let seq = 0;
const nid = () => `n${seq++}`;
const eid = () => `e${seq++}`;

export function resetIds(): void {
  seq = 0;
}

export function graph(nodes: PlanNode[], edges: PlanEdge[]): PlanGraph {
  return { schemaVersion: 1, nodes, edges };
}

const pos = { x: 0, y: 0 };

export function planInput(itemClass: string, ratePerMinute: number): PlanNode {
  return { id: nid(), kind: "planInput", position: pos, itemClass, ratePerMinute };
}

export function planOutput(itemClass: string, ratePerMinute: number): PlanNode {
  return { id: nid(), kind: "planOutput", position: pos, itemClass, ratePerMinute };
}

export function machine(
  buildingClass: string,
  recipeClass: string,
  opts: { clockSpeed?: number; somersloops?: number } = {},
): PlanNode {
  return {
    id: nid(),
    kind: "machine",
    position: pos,
    buildingClass,
    recipeClass,
    clockSpeed: opts.clockSpeed ?? 100,
    somersloops: opts.somersloops ?? 0,
  };
}

export function generator(buildingClass: string, opts: { clockSpeed?: number } = {}): PlanNode {
  return {
    id: nid(),
    kind: "machine",
    position: pos,
    buildingClass,
    clockSpeed: opts.clockSpeed ?? 100,
    somersloops: 0,
  };
}

export function extractor(
  buildingClass: string,
  resourceClass: string,
  opts: { clockSpeed?: number; purity?: "impure" | "normal" | "pure"; mk?: MinerMk } = {},
): PlanNode {
  return {
    id: nid(),
    kind: "extractor",
    position: pos,
    buildingClass,
    resourceClass,
    clockSpeed: opts.clockSpeed ?? 100,
    purity: opts.purity ?? "normal",
    mk: opts.mk,
  };
}

export function splitter(): PlanNode {
  return { id: nid(), kind: "splitter", position: pos, buildingClass: "Build_Splitter_C" };
}

export function merger(): PlanNode {
  return { id: nid(), kind: "merger", position: pos, buildingClass: "Build_Merger_C" };
}

export function belt(
  source: PlanNode,
  target: PlanNode,
  mk: 1 | 2 | 3 | 4 | 5 | 6 = 3,
  handles: { sourceHandle?: string; targetHandle?: string } = {},
): PlanEdge {
  return {
    id: eid(),
    kind: "belt",
    mk,
    source: source.id,
    sourceHandle: handles.sourceHandle ?? "out",
    target: target.id,
    targetHandle: handles.targetHandle ?? "in",
  };
}

export function pipe(
  source: PlanNode,
  target: PlanNode,
  mk: 1 | 2 = 2,
  handles: { sourceHandle?: string; targetHandle?: string } = {},
): PlanEdge {
  return {
    id: eid(),
    kind: "pipe",
    mk,
    source: source.id,
    sourceHandle: handles.sourceHandle ?? "out",
    target: target.id,
    targetHandle: handles.targetHandle ?? "in",
  };
}
