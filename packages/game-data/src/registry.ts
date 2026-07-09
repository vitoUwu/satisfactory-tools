/**
 * Dataset registry — discovers and loads the JSON Game Datasets checked into
 * `packages/game-data/data/`. Each file is named `<version>.json` (e.g.
 * `1.2.json`) and contains exactly one serialized {@link DatasetIndex}.
 *
 * Per ADR-0002 every released version stays available; a Plan pins the version
 * it was built against and loads it by name.
 */

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { DatasetIndex } from "./types";

/** Absolute path to the directory holding `<version>.json` dataset files. */
export const DATA_DIR = fileURLToPath(new URL("../data/", import.meta.url));

/**
 * List the dataset versions available on disk, e.g. `["1.0", "1.1", "1.2"]`.
 * Returns `[]` if the data directory does not yet exist.
 */
export async function listDatasetVersions(): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(DATA_DIR);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .sort();
}

/**
 * Load and parse the dataset for a specific version from
 * `data/<version>.json`. Rejects if the file is missing or malformed.
 */
export async function loadDataset(version: string): Promise<DatasetIndex> {
  const path = fileURLToPath(new URL(`../data/${version}.json`, import.meta.url));
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as DatasetIndex;
}
