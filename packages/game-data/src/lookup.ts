/**
 * Pure lookup helpers over a loaded {@link DatasetIndex}. These are the canonical
 * accessors the app, engine, and Solver Assist use instead of reaching into the
 * raw records directly.
 */

import type {
  Building,
  DatasetIndex,
  ExtractorBuilding,
  GeneratorBuilding,
  Item,
  ManufacturerBuilding,
  Recipe,
} from "./types";

/** Get an {@link Item} by className, or undefined if not present. */
export function getItem(
  index: DatasetIndex,
  className: string,
): Item | undefined {
  return index.items[className];
}

/** Get a {@link Recipe} by className, or undefined if not present. */
export function getRecipe(
  index: DatasetIndex,
  className: string,
): Recipe | undefined {
  return index.recipes[className];
}

/** Get a {@link Building} by className, or undefined if not present. */
export function getBuilding(
  index: DatasetIndex,
  className: string,
): Building | undefined {
  return index.buildings[className];
}

/** All recipes that output the given item className (standard + alternates). */
export function recipesForProduct(
  index: DatasetIndex,
  itemClassName: string,
): Recipe[] {
  return Object.values(index.recipes).filter((r) =>
    r.products.some((p) => p.item === itemClassName),
  );
}

/** All recipes that consume the given item className as an ingredient. */
export function recipesUsingIngredient(
  index: DatasetIndex,
  itemClassName: string,
): Recipe[] {
  return Object.values(index.recipes).filter((r) =>
    r.ingredients.some((i) => i.item === itemClassName),
  );
}

/** All recipes runnable in the given building className. */
export function recipesProducedIn(
  index: DatasetIndex,
  buildingClassName: string,
): Recipe[] {
  return Object.values(index.recipes).filter(
    (r) => r.producedIn === buildingClassName,
  );
}

/**
 * The standard (non-alternate) recipe producing the given item, if one exists.
 * This is the default consulted by a Plan's Recipe Preferences.
 */
export function standardRecipeFor(
  index: DatasetIndex,
  itemClassName: string,
): Recipe | undefined {
  return recipesForProduct(index, itemClassName).find((r) => !r.isAlternate);
}

// --- Narrowing helpers over the Building union -----------------------------

export function isManufacturer(b: Building): b is ManufacturerBuilding {
  return b.kind === "manufacturer";
}

export function isExtractor(b: Building): b is ExtractorBuilding {
  return b.kind === "extractor";
}

export function isGenerator(b: Building): b is GeneratorBuilding {
  return b.kind === "generator";
}
