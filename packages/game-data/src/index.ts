export * from "./types";
export * from "./lookup";
// NOTE: `./registry` (loadDataset/listDatasetVersions) reads the dataset files
// from disk via `node:fs` and is intentionally NOT re-exported here — importing
// any value from this barrel must stay safe for the client bundle. Server code
// imports those helpers from "@satisfactory-tools/game-data/registry" directly.
