/**
 * Palette metadata and factory helpers: how buildings are grouped in the left
 * palette, and how a fresh {@link PlanNode} is constructed when a building is
 * dropped onto the canvas.
 */

import type {
  Building,
  DatasetIndex,
  ExtractorBuilding,
} from "@satisfactory-tools/game-data";
import { recipesProducedIn } from "@satisfactory-tools/game-data";
import type { PlanNode, Position } from "@satisfactory-tools/planner-engine";

/** Palette category for a building. */
export function buildingCategory(building: Building): string {
  switch (building.kind) {
    case "manufacturer":
      return "Production";
    case "extractor":
      return "Extraction";
    case "generator":
      return "Power";
    case "splitter":
    case "merger":
      return "Logistics";
  }
}

/** Stable ordering of categories in the palette. */
export const CATEGORY_ORDER = [
  "Production",
  "Extraction",
  "Power",
  "Logistics",
  "Boundary",
] as const;

let seq = 0;
/** Client-side unique id for a freshly created node/edge. */
export function newId(prefix = "n"): string {
  seq += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${seq}_${rand}`;
}

/** All Miner extractor buildings, ordered by Mk. */
export function minerVariants(dataset: DatasetIndex): ExtractorBuilding[] {
  return Object.values(dataset.buildings)
    .filter(
      (b): b is ExtractorBuilding =>
        b.kind === "extractor" && b.extractorType === "miner",
    )
    .sort((a, b) => (a.mk ?? 0) - (b.mk ?? 0));
}

/** Construct a default {@link PlanNode} for a dropped building. */
export function defaultNodeForBuilding(
  building: Building,
  dataset: DatasetIndex,
  position: Position,
): PlanNode {
  const id = newId();
  switch (building.kind) {
    case "manufacturer": {
      const recipe = recipesProducedIn(dataset, building.className).find(
        (r) => !r.isAlternate,
      ) ?? recipesProducedIn(dataset, building.className)[0];
      return {
        id,
        kind: "machine",
        position,
        buildingClass: building.className,
        recipeClass: recipe?.className,
        clockSpeed: 100,
        somersloops: 0,
      };
    }
    case "generator":
      return {
        id,
        kind: "machine",
        position,
        buildingClass: building.className,
        recipeClass: undefined,
        clockSpeed: 100,
        somersloops: 0,
      };
    case "extractor": {
      const resource = building.allowedResources[0] ?? "";
      return {
        id,
        kind: "extractor",
        position,
        buildingClass: building.className,
        resourceClass: resource,
        mk: building.mk,
        clockSpeed: 100,
        purity: "normal",
      };
    }
    case "splitter":
      return { id, kind: "splitter", position, buildingClass: building.className };
    case "merger":
      return { id, kind: "merger", position, buildingClass: building.className };
  }
}

/** Construct a Plan Input boundary node for the first available item. */
export function defaultPlanInput(
  dataset: DatasetIndex,
  position: Position,
): PlanNode {
  const first = Object.values(dataset.items)[0];
  return {
    id: newId(),
    kind: "planInput",
    position,
    itemClass: first?.className ?? "",
    ratePerMinute: 60,
  };
}

/** Construct a Plan Output boundary node for the first available item. */
export function defaultPlanOutput(
  dataset: DatasetIndex,
  position: Position,
): PlanNode {
  const first = Object.values(dataset.items)[0];
  return {
    id: newId(),
    kind: "planOutput",
    position,
    itemClass: first?.className ?? "",
    ratePerMinute: 60,
  };
}
