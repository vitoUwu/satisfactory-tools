/**
 * Server functions that load a pinned Game Dataset (ADR-0002) for the Planner
 * canvas. The dataset lives in `packages/game-data/data/<version>.json` and is
 * read from disk with Node APIs, so it must only ever run on the server — hence
 * `loadDataset` is imported dynamically inside the handler and never leaks into
 * the client bundle.
 */

import type { DatasetIndex } from "@satisfactory-tools/game-data";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Load the full {@link DatasetIndex} for a specific game version. */
export const loadDatasetFn = createServerFn({ method: "GET" })
  .validator(z.object({ version: z.string().min(1) }))
  .handler(async ({ data }): Promise<DatasetIndex> => {
    const { loadDataset } = await import(
      "@satisfactory-tools/game-data/registry"
    );
    return loadDataset(data.version);
  });

/** List the Game Dataset versions available on disk, newest last. */
export const listDatasetVersionsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<string[]> => {
    const { listDatasetVersions } = await import(
      "@satisfactory-tools/game-data/registry"
    );
    return listDatasetVersions();
  },
);
