/**
 * elkjs-based auto-layout for a freshly expanded ingredient chain (Solver Assist).
 *
 * {@link layoutExpansion} runs a layered, left-to-right ELK layout over ONLY the
 * newly added nodes plus the expansion's target (as a fixed anchor), then translates
 * the result so the target keeps its current canvas position and every new node lands
 * to its left. Existing, untouched nodes are never moved.
 */

import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkNode } from "elkjs/lib/elk-api";
import type { PlanEdge, PlanNode, Position } from "@satisfactory-tools/planner-engine";

const elk = new ELK();

/** Estimated on-canvas footprint per node kind (px), used before RF measures them. */
function sizeFor(node: PlanNode): { width: number; height: number } {
  switch (node.kind) {
    case "machine":
    case "extractor":
      return { width: 240, height: 200 };
    case "planInput":
    case "planOutput":
      return { width: 190, height: 120 };
    case "splitter":
    case "merger":
      return { width: 140, height: 80 };
  }
}

const LAYOUT_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.layered.spacing.nodeNodeBetweenLayers": "90",
  "elk.spacing.nodeNode": "48",
} as const;

/**
 * Lay out `newNodes` to the left of `target`, returning the new canvas positions
 * keyed by node id. `target` itself is not included in the result (it stays put).
 */
export async function layoutExpansion(
  target: PlanNode,
  newNodes: PlanNode[],
  newEdges: PlanEdge[],
): Promise<Map<string, Position>> {
  const ids = new Set(newNodes.map((n) => n.id));
  ids.add(target.id);

  const children: ElkNode["children"] = [target, ...newNodes].map((n) => ({
    id: n.id,
    ...sizeFor(n),
  }));
  const edges = newEdges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] }));

  const laidOut = await elk.layout({
    id: "root",
    layoutOptions: LAYOUT_OPTIONS,
    children,
    edges,
  });

  const laid = new Map<string, Position>();
  for (const c of laidOut.children ?? []) {
    laid.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 });
  }

  const anchor = laid.get(target.id) ?? { x: 0, y: 0 };
  const dx = target.position.x - anchor.x;
  const dy = target.position.y - anchor.y;

  const result = new Map<string, Position>();
  for (const n of newNodes) {
    const p = laid.get(n.id);
    if (p) result.set(n.id, { x: p.x + dx, y: p.y + dy });
  }
  return result;
}
