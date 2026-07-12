/**
 * The React Flow canvas (ADR-0003). Rendered client-only — React Flow needs the
 * DOM to measure nodes. The {@link PlanGraph} in context is the single source of
 * truth: RF nodes/edges are derived from it each render and every change is routed
 * back through the graph reducer. Connection validity enforces port media (Belts
 * carry solids, Pipes carry fluids).
 */

import "@xyflow/react/dist/style.css";

import type { PlanEdge } from "@satisfactory-tools/planner-engine";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type IsValidConnection,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { Copy, Trash2, Unlink } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { edgeTypes } from "./edges";
import { defaultNodeForBuilding, defaultPlanInput, defaultPlanOutput, newId } from "./factory";
import { nodeTypes } from "./nodes";
import { PALETTE_MIME, type PaletteDrag } from "./Palette";
import { usePlanner } from "./PlannerContext";
import {
  edgeKindForMedia,
  inputMedium,
  inputPortRate,
  outputMedium,
  outputPortRate,
  smallestMkFor,
} from "./ports";

// Fallback Mk when a connection's rate can't be inferred (nothing has flowed
// through it yet). Start small: an undersized belt self-corrects — it flags as
// over capacity (turns red) — whereas an oversized belt gives no signal.
const DEFAULT_BELT_MK = 1;
const DEFAULT_PIPE_MK = 2;

// Nodes snap to this grid so layouts stay aligned; the background dots share it
// so the grid the nodes snap to is the one you see.
const GRID_SIZE = 20;

function CanvasInner() {
  const {
    graph,
    dataset,
    dispatch,
    flow,
    selectedNodeIds,
    setSelectedNodeIds,
    deleteNodes,
    duplicateNodes,
  } = usePlanner();
  const { screenToFlowPosition } = useReactFlow();

  const [menu, setMenu] = useState<
    | { x: number; y: number; kind: "node"; ids: string[] }
    | { x: number; y: number; kind: "edge"; id: string }
    | null
  >(null);

  // React Flow owns node positions locally while a drag is in flight; the graph
  // (context) is only updated at drag end. Rebuilding every RF node object per
  // drag tick made React Flow re-render every node ~60x/s — visible flashing.
  const [rfNodes, setRfNodes] = useState<Node[]>(() =>
    graph.nodes.map((n) => ({
      id: n.id,
      type: n.kind,
      position: n.position,
      data: {},
      selected: selectedNodeIds.has(n.id),
    })),
  );

  // Re-sync local RF nodes from the graph (source of truth) on structural or
  // selection changes, preserving object identity for untouched nodes so React
  // Flow skips re-rendering them. A node mid-drag keeps its live position.
  useEffect(() => {
    setRfNodes((prev) => {
      const prevById = new Map(prev.map((p) => [p.id, p]));
      const next = graph.nodes.map<Node>((n) => {
        const existing = prevById.get(n.id);
        const selected = selectedNodeIds.has(n.id);
        const position = existing?.dragging ? existing.position : n.position;
        if (
          existing &&
          existing.type === n.kind &&
          existing.selected === selected &&
          existing.position.x === position.x &&
          existing.position.y === position.y
        ) {
          return existing;
        }
        return {
          ...(existing ?? { data: {} }),
          id: n.id,
          type: n.kind,
          position,
          selected,
        };
      });
      const changed =
        next.length !== prev.length || next.some((n, i) => n !== prev[i]);
      return changed ? next : prev;
    });
  }, [graph.nodes, selectedNodeIds]);

  const rfEdges = useMemo<Edge[]>(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        type: "beltPipe",
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
      })),
    [graph.edges],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setRfNodes((prev) => applyNodeChanges(changes, prev));
      // React Flow owns the live selected set; mirror its select/remove changes
      // into the context so the Inspector and context menu see the same thing.
      let selChanged = false;
      const nextSel = new Set(selectedNodeIds);
      for (const c of changes) {
        if (c.type === "position" && !c.dragging && c.position) {
          // Commit the position to the graph only at drag end; intermediate
          // ticks live in local RF state.
          dispatch({ type: "moveNode", id: c.id, position: c.position });
        } else if (c.type === "remove") {
          dispatch({ type: "removeNode", id: c.id });
          if (nextSel.delete(c.id)) selChanged = true;
        } else if (c.type === "select") {
          selChanged = true;
          if (c.selected) nextSel.add(c.id);
          else nextSel.delete(c.id);
        }
      }
      if (selChanged) setSelectedNodeIds(nextSel);
    },
    [dispatch, selectedNodeIds, setSelectedNodeIds],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const c of changes) {
        if (c.type === "remove") {
          dispatch({ type: "removeEdge", id: c.id });
        }
      }
    },
    [dispatch],
  );

  const isValidConnection = useCallback<IsValidConnection>(
    (conn) => {
      if (!conn.source || !conn.target || conn.source === conn.target) {
        return false;
      }
      const source = graph.nodes.find((n) => n.id === conn.source);
      const target = graph.nodes.find((n) => n.id === conn.target);
      if (!source || !target) return false;
      const srcMedium = outputMedium(source, conn.sourceHandle, dataset);
      const tgtMedium = inputMedium(target, conn.targetHandle, dataset);
      if (srcMedium !== "any" && tgtMedium !== "any" && srcMedium !== tgtMedium) {
        return false;
      }
      return true;
    },
    [graph.nodes, dataset],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      const source = graph.nodes.find((n) => n.id === conn.source);
      const target = graph.nodes.find((n) => n.id === conn.target);
      if (!source || !target) return;
      const srcMedium = outputMedium(source, conn.sourceHandle, dataset);
      const tgtMedium = inputMedium(target, conn.targetHandle, dataset);
      const kind = edgeKindForMedia(srcMedium, tgtMedium);
      // Total rate currently entering a node in the last solve — the best sizing
      // hint for a logistics node (splitter/merger), which has no static port rate.
      const inboundThroughput = (nodeId: string): number | undefined => {
        if (!flow) return undefined;
        let sum = 0;
        let found = false;
        for (const e of graph.edges) {
          if (e.target !== nodeId) continue;
          const f = flow.perEdge[e.id];
          if (f) {
            sum += f.actualRatePerMinute;
            found = true;
          }
        }
        return found ? sum : undefined;
      };
      // Size the connection to what will actually flow through it: the smaller of
      // what the source pushes and what the target pulls. When a passthrough node
      // has no static port rate, fall back to its measured inbound throughput so a
      // splitter fed by a 60/min miner sizes its onward belt to 60, not the max Mk.
      const rate = Math.min(
        outputPortRate(source, conn.sourceHandle, dataset) ??
          inboundThroughput(source.id) ??
          Infinity,
        inputPortRate(target, conn.targetHandle, dataset) ?? Infinity,
      );
      const edge: PlanEdge = {
        id: newId("e"),
        kind,
        mk: smallestMkFor(
          kind,
          rate,
          dataset,
          kind === "pipe" ? DEFAULT_PIPE_MK : DEFAULT_BELT_MK,
        ),
        source: conn.source,
        target: conn.target,
        sourceHandle: conn.sourceHandle ?? "",
        targetHandle: conn.targetHandle ?? "",
      };
      dispatch({ type: "addEdge", edge });
    },
    [graph.nodes, graph.edges, flow, dataset, dispatch],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData(PALETTE_MIME);
      if (!raw) return;
      let payload: PaletteDrag;
      try {
        payload = JSON.parse(raw) as PaletteDrag;
      } catch {
        return;
      }
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      if (payload.kind === "planInput") {
        dispatch({ type: "addNode", node: defaultPlanInput(dataset, position) });
      } else if (payload.kind === "planOutput") {
        dispatch({ type: "addNode", node: defaultPlanOutput(dataset, position) });
      } else {
        const building = dataset.buildings[payload.className];
        if (!building) return;
        dispatch({
          type: "addNode",
          node: defaultNodeForBuilding(building, dataset, position),
        });
      }
    },
    [dataset, dispatch, screenToFlowPosition],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onCanvasContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const target = event.target as HTMLElement;

      const nodeEl = target.closest<HTMLElement>(".react-flow__node");
      if (nodeEl?.dataset.id) {
        const id = nodeEl.dataset.id;
        const inSelection = selectedNodeIds.has(id);
        const ids =
          inSelection && selectedNodeIds.size > 1 ? [...selectedNodeIds] : [id];
        if (!inSelection) {
          setSelectedNodeIds(new Set([id]));
          setRfNodes((prev) =>
            prev.map((n) =>
              n.selected === (n.id === id) ? n : { ...n, selected: n.id === id },
            ),
          );
        }
        setMenu({ x: event.clientX, y: event.clientY, kind: "node", ids });
        return;
      }

      const edgeEl = target.closest<HTMLElement>(".react-flow__edge");
      if (edgeEl?.dataset.id) {
        setMenu({
          x: event.clientX,
          y: event.clientY,
          kind: "edge",
          id: edgeEl.dataset.id,
        });
        return;
      }

      setMenu(null);
    },
    [selectedNodeIds, setSelectedNodeIds],
  );

  // Dismiss the context menu on any outside click or Escape.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  return (
    <div className="h-full w-full" onContextMenu={onCanvasContextMenu}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onPaneClick={() => setMenu(null)}
        // Figma-style: left-drag marquee-selects; pan with middle-mouse or
        // Space+drag. Right-mouse is reserved for the context menu.
        selectionOnDrag
        panOnDrag={[1]}
        selectionMode={SelectionMode.Partial}
        snapToGrid
        snapGrid={[GRID_SIZE, GRID_SIZE]}
        deleteKeyCode={["Backspace", "Delete"]}
        minZoom={0.1}
        maxZoom={2.5}
        fitView
        proOptions={{ hideAttribution: true }}
        className="bg-background"
      >
        <Background variant={BackgroundVariant.Dots} gap={GRID_SIZE} size={1} />
        <MiniMap pannable zoomable className="!bg-card" />
        <Controls />
      </ReactFlow>
      {menu && (
        <div
          className="fixed z-50 min-w-40 border border-border bg-card py-1 text-xs shadow-md"
          style={{ left: menu.x, top: menu.y }}
          // Keep clicks inside the menu from bubbling to the window closer.
          onClick={(e) => e.stopPropagation()}
        >
          {menu.kind === "node" ? (
            <>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent"
                onClick={() => {
                  duplicateNodes(menu.ids);
                  setMenu(null);
                }}
              >
                <Copy className="size-3.5" />
                Duplicate
                {menu.ids.length > 1 ? ` ${menu.ids.length} nodes` : ""}
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-destructive hover:bg-accent"
                onClick={() => {
                  deleteNodes(menu.ids);
                  setMenu(null);
                }}
              >
                <Trash2 className="size-3.5" />
                Delete
                {menu.ids.length > 1 ? ` ${menu.ids.length} nodes` : ""}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-destructive hover:bg-accent"
              onClick={() => {
                dispatch({ type: "removeEdge", id: menu.id });
                setMenu(null);
              }}
            >
              <Unlink className="size-3.5" />
              Disconnect
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function PlannerCanvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
