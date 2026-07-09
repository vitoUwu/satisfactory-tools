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
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type IsValidConnection,
  type Node,
  type NodeChange,
} from "@xyflow/react";
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

const DEFAULT_BELT_MK = 5;
const DEFAULT_PIPE_MK = 2;

function CanvasInner() {
  const {
    graph,
    dataset,
    dispatch,
    selectedNodeId,
    setSelectedNodeId,
  } = usePlanner();
  const { screenToFlowPosition } = useReactFlow();

  // React Flow owns node positions locally while a drag is in flight; the graph
  // (context) is only updated at drag end. Rebuilding every RF node object per
  // drag tick made React Flow re-render every node ~60x/s — visible flashing.
  const [rfNodes, setRfNodes] = useState<Node[]>(() =>
    graph.nodes.map((n) => ({
      id: n.id,
      type: n.kind,
      position: n.position,
      data: {},
      selected: n.id === selectedNodeId,
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
        const selected = n.id === selectedNodeId;
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
  }, [graph.nodes, selectedNodeId]);

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
      for (const c of changes) {
        if (c.type === "position" && !c.dragging && c.position) {
          // Commit the position to the graph only at drag end; intermediate
          // ticks live in local RF state.
          dispatch({ type: "moveNode", id: c.id, position: c.position });
        } else if (c.type === "remove") {
          dispatch({ type: "removeNode", id: c.id });
        } else if (c.type === "select") {
          if (c.selected) setSelectedNodeId(c.id);
          else if (selectedNodeId === c.id) setSelectedNodeId(null);
        }
      }
    },
    [dispatch, selectedNodeId, setSelectedNodeId],
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
      // Size the connection to what will actually flow through it: the smaller
      // of what the source port pushes and what the target port pulls.
      const rate = Math.min(
        outputPortRate(source, conn.sourceHandle, dataset) ?? Infinity,
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
    [graph.nodes, dataset, dispatch],
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

  return (
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
      onPaneClick={() => setSelectedNodeId(null)}
      minZoom={0.1}
      maxZoom={2.5}
      fitView
      proOptions={{ hideAttribution: true }}
      className="bg-background"
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <MiniMap pannable zoomable className="!bg-card" />
      <Controls />
    </ReactFlow>
  );
}

export function PlannerCanvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
