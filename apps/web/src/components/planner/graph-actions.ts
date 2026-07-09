/**
 * Pure reducer over a {@link PlanGraph}. The Planner keeps a single PlanGraph as
 * source of truth; every canvas edit (drag, connect, inspector change) is one of
 * these actions. Positions are updated in place so autosave persists layout, but
 * the flow solver only re-runs on structural changes (see {@link structuralKey}).
 */

import type {
  PlanEdge,
  PlanGraph,
  PlanNode,
  Position,
} from "@satisfactory-tools/planner-engine";

export type GraphAction =
  | { type: "addNode"; node: PlanNode }
  | { type: "moveNode"; id: string; position: Position }
  | { type: "removeNode"; id: string }
  | { type: "updateNode"; id: string; patch: Partial<PlanNode> }
  | { type: "addEdge"; edge: PlanEdge }
  | { type: "removeEdge"; id: string }
  | { type: "updateEdge"; id: string; patch: Partial<PlanEdge> }
  | { type: "setGraph"; graph: PlanGraph };

export function graphReducer(state: PlanGraph, action: GraphAction): PlanGraph {
  switch (action.type) {
    case "setGraph":
      return action.graph;

    case "addNode":
      return { ...state, nodes: [...state.nodes, action.node] };

    case "moveNode":
      return {
        ...state,
        nodes: state.nodes.map((n) =>
          n.id === action.id ? { ...n, position: action.position } : n,
        ),
      };

    case "removeNode":
      return {
        ...state,
        nodes: state.nodes.filter((n) => n.id !== action.id),
        edges: state.edges.filter(
          (e) => e.source !== action.id && e.target !== action.id,
        ),
      };

    case "updateNode":
      return {
        ...state,
        nodes: state.nodes.map((n) =>
          n.id === action.id ? ({ ...n, ...action.patch } as PlanNode) : n,
        ),
      };

    case "addEdge":
      return { ...state, edges: [...state.edges, action.edge] };

    case "removeEdge":
      return {
        ...state,
        edges: state.edges.filter((e) => e.id !== action.id),
      };

    case "updateEdge":
      return {
        ...state,
        edges: state.edges.map((e) =>
          e.id === action.id ? ({ ...e, ...action.patch } as PlanEdge) : e,
        ),
      };
  }
}

/**
 * A key that changes only when the graph's *topology or parameters* change, not
 * when a node merely moves. Used to memoize expensive flow recomputation.
 */
export function structuralKey(graph: PlanGraph): string {
  const nodes = graph.nodes.map(({ position: _pos, ...rest }) => rest);
  return JSON.stringify({ nodes, edges: graph.edges });
}
