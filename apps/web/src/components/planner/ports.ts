/**
 * Port derivation and connection typing for the Planner canvas.
 *
 * Every node exposes named input/output ports (React Flow "handles"). A machine's
 * ports come from its selected recipe (one per distinct ingredient / product); an
 * extractor has a single output for its resource; logistics and boundary nodes have
 * fixed ports. Each port carries the {@link ItemForm} of the item it moves, which
 * decides whether it may be wired with a Belt (solids) or a Pipe (fluids).
 */

import type {
  BeltMk,
  DatasetIndex,
  ItemForm,
  PipeMk,
} from "@satisfactory-tools/game-data";
import {
  getBuilding,
  getItem,
  getRecipe,
  isManufacturer,
  PURITY_MULTIPLIER,
} from "@satisfactory-tools/game-data";
import type { EdgeKind, PlanNode } from "@satisfactory-tools/planner-engine";

/** A single input or output port on a node. */
export interface PortSpec {
  /** Handle id, unique within the node (e.g. "in::Desc_IronOre_C", "out0"). */
  id: string;
  /** className of the item that flows through this port, if statically known. */
  itemClass?: string;
  /** Physical form; undefined for logistics passthrough (unknown until wired). */
  form?: ItemForm;
  /** Short human label for the port. */
  label: string;
}

/** The connection type a port can carry, or "any" when the form is unknown. */
export type PortMedium = "belt" | "pipe" | "any";

/** Belt for solids, Pipe for fluids (liquid | gas). */
export function mediumForForm(form: ItemForm | undefined): PortMedium {
  if (form === undefined) return "any";
  return form === "solid" ? "belt" : "pipe";
}

/** Default {@link EdgeKind} for a resolved pair of port media. */
export function edgeKindForMedia(a: PortMedium, b: PortMedium): EdgeKind {
  if (a === "pipe" || b === "pipe") return "pipe";
  return "belt";
}

function itemForm(
  dataset: DatasetIndex,
  itemClass: string,
): ItemForm | undefined {
  return getItem(dataset, itemClass)?.form;
}

function itemLabel(dataset: DatasetIndex, itemClass: string): string {
  return getItem(dataset, itemClass)?.displayName ?? itemClass;
}

function port(dataset: DatasetIndex, prefix: "in" | "out", itemClass: string): PortSpec {
  return {
    id: `${prefix}::${itemClass}`,
    itemClass,
    form: itemForm(dataset, itemClass),
    label: itemLabel(dataset, itemClass),
  };
}

/** Input ports for a node given the current dataset. */
export function inputPorts(node: PlanNode, dataset: DatasetIndex): PortSpec[] {
  switch (node.kind) {
    case "machine": {
      const building = getBuilding(dataset, node.buildingClass);
      if (building?.kind === "generator") {
        const ports: PortSpec[] = [{ id: "in::fuel", label: "Fuel" }];
        if (building.supplementalResource) {
          ports.push(port(dataset, "in", building.supplementalResource));
        }
        return ports;
      }
      const recipe = node.recipeClass
        ? getRecipe(dataset, node.recipeClass)
        : undefined;
      if (!recipe) return [];
      return recipe.ingredients.map((i) => port(dataset, "in", i.item));
    }
    case "extractor":
      return [];
    case "splitter":
      return [{ id: "in", label: "In" }];
    case "merger":
      return [
        { id: "in0", label: "In 1" },
        { id: "in1", label: "In 2" },
        { id: "in2", label: "In 3" },
      ];
    case "planInput":
      return [];
    case "planOutput":
      return [port(dataset, "in", node.itemClass)];
  }
}

/** Output ports for a node given the current dataset. */
export function outputPorts(node: PlanNode, dataset: DatasetIndex): PortSpec[] {
  switch (node.kind) {
    case "machine": {
      const building = getBuilding(dataset, node.buildingClass);
      if (building?.kind === "generator") {
        return building.byproduct
          ? [port(dataset, "out", building.byproduct.item)]
          : [];
      }
      const recipe = node.recipeClass
        ? getRecipe(dataset, node.recipeClass)
        : undefined;
      if (!recipe) return [];
      return recipe.products.map((p) => port(dataset, "out", p.item));
    }
    case "extractor":
      return [port(dataset, "out", node.resourceClass)];
    case "splitter":
      return [
        { id: "out0", label: "Out 1" },
        { id: "out1", label: "Out 2" },
        { id: "out2", label: "Out 3" },
      ];
    case "merger":
      return [{ id: "out", label: "Out" }];
    case "planInput":
      return [port(dataset, "out", node.itemClass)];
    case "planOutput":
      return [];
  }
}

/**
 * Nominal rate an output port pushes (items or m³/min), clock/Somersloop
 * adjusted; undefined when not statically known (logistics passthrough).
 */
export function outputPortRate(
  node: PlanNode,
  handleId: string | null | undefined,
  dataset: DatasetIndex,
): number | undefined {
  switch (node.kind) {
    case "extractor": {
      const building = getBuilding(dataset, node.buildingClass);
      if (building?.kind !== "extractor") return undefined;
      return (
        building.baseRatePerMinute *
        PURITY_MULTIPLIER[node.purity] *
        (node.clockSpeed / 100)
      );
    }
    case "planInput":
      return node.ratePerMinute;
    case "machine": {
      const building = getBuilding(dataset, node.buildingClass);
      if (building?.kind === "generator") {
        return building.byproduct && handleId === `out::${building.byproduct.item}`
          ? building.byproduct.ratePerMinute * (node.clockSpeed / 100)
          : undefined;
      }
      const recipe = node.recipeClass
        ? getRecipe(dataset, node.recipeClass)
        : undefined;
      const product = recipe?.products.find((p) => `out::${p.item}` === handleId);
      if (!product) return undefined;
      const slots =
        building && isManufacturer(building) ? building.somersloopSlots : 0;
      const sloopMult = slots > 0 ? 1 + node.somersloops / slots : 1;
      return product.ratePerMinute * (node.clockSpeed / 100) * sloopMult;
    }
    default:
      return undefined;
  }
}

/**
 * Nominal rate an input port pulls (items or m³/min), clock adjusted; undefined
 * when not statically known (logistics passthrough, generator fuel — its rate
 * depends on which fuel item ends up wired in).
 */
export function inputPortRate(
  node: PlanNode,
  handleId: string | null | undefined,
  dataset: DatasetIndex,
): number | undefined {
  switch (node.kind) {
    case "planOutput":
      return node.ratePerMinute;
    case "machine": {
      const building = getBuilding(dataset, node.buildingClass);
      if (building?.kind === "generator") {
        if (
          building.supplementalResource &&
          building.supplementalRatePerMinute &&
          handleId === `in::${building.supplementalResource}`
        ) {
          return building.supplementalRatePerMinute * (node.clockSpeed / 100);
        }
        return undefined;
      }
      const recipe = node.recipeClass
        ? getRecipe(dataset, node.recipeClass)
        : undefined;
      const ingredient = recipe?.ingredients.find(
        (i) => `in::${i.item}` === handleId,
      );
      return ingredient
        ? ingredient.ratePerMinute * (node.clockSpeed / 100)
        : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Smallest Belt/Pipe Mk whose capacity covers `rate`, mirroring the Solver
 * Assist's sizing rule; `fallback` when the rate is unknown (Infinity).
 */
export function smallestMkFor(
  kind: EdgeKind,
  rate: number,
  dataset: DatasetIndex,
  fallback: BeltMk | PipeMk,
): BeltMk | PipeMk {
  if (!Number.isFinite(rate)) return fallback;
  if (kind === "belt") {
    for (const mk of [1, 2, 3, 4, 5, 6] as BeltMk[]) {
      if ((dataset.beltCapacity[mk] ?? 0) >= rate - 1e-6) return mk;
    }
    return 6;
  }
  for (const mk of [1, 2] as PipeMk[]) {
    if ((dataset.pipeCapacity[mk] ?? 0) >= rate - 1e-6) return mk;
  }
  return 2;
}

/** Look up an output port's medium on a node, defaulting to "any". */
export function outputMedium(
  node: PlanNode,
  handleId: string | null | undefined,
  dataset: DatasetIndex,
): PortMedium {
  const p = outputPorts(node, dataset).find((x) => x.id === handleId);
  return mediumForForm(p?.form);
}

/** Look up an input port's medium on a node, defaulting to "any". */
export function inputMedium(
  node: PlanNode,
  handleId: string | null | undefined,
  dataset: DatasetIndex,
): PortMedium {
  const p = inputPorts(node, dataset).find((x) => x.id === handleId);
  return mediumForForm(p?.form);
}
