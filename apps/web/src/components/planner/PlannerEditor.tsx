/**
 * Top-level Planner editor: owns the live {@link PlanGraph}, recomputes steady-state
 * flows on every structural change (ADR-0004), autosaves on a 1s debounce, and lays
 * out the palette, canvas, inspector and totals bar. Everything below the toolbar is
 * client-only because the canvas depends on the DOM.
 */

import type { DatasetIndex } from "@satisfactory-tools/game-data";
import type {
  Bottleneck,
  PlanGraph,
  PlanNode,
  RecipePreferences,
} from "@satisfactory-tools/planner-engine";
import { computeFlows, expandChain } from "@satisfactory-tools/planner-engine";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { savePlanGraph } from "@/functions/plans";

import { ClientOnly } from "./ClientOnly";
import { newId } from "./factory";
import { graphReducer, structuralKey } from "./graph-actions";
import { Inspector } from "./Inspector";
import { layoutExpansion } from "./layout";
import { Palette } from "./Palette";
import { PlannerCanvas } from "./PlannerCanvas";
import { PlannerContext, type PlannerContextValue } from "./PlannerContext";
import { RecipePreferencesDialog } from "./RecipePreferencesDialog";
import { TotalsBar } from "./TotalsBar";

type SaveStatus = "idle" | "saving" | "saved";

export function PlannerEditor({
  planId,
  planName,
  dataset,
  initialGraph,
  recipePreferences,
}: {
  planId: string;
  planName: string;
  dataset: DatasetIndex;
  initialGraph: PlanGraph;
  recipePreferences: RecipePreferences;
}) {
  const [graph, dispatch] = useReducer(graphReducer, initialGraph);
  const [prefs, setPrefs] = useState<RecipePreferences>(recipePreferences);
  const [selectedNodeIds, setSelectedNodeIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [hoveredBottleneck, setHoveredBottleneck] = useState<Bottleneck | null>(
    null,
  );
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  // The live graph is read inside the async expand handler without making it a
  // dependency (which would re-run mid-expansion); a ref keeps it current.
  const graphRef = useRef(graph);
  graphRef.current = graph;

  const expandInputs = useCallback(
    async (nodeId: string): Promise<number> => {
      const current = graphRef.current;
      const target = current.nodes.find((n) => n.id === nodeId);
      if (!target) return 0;
      const exp = expandChain(current, nodeId, dataset, prefs);
      if (exp.nodes.length === 0 && exp.edges.length === 0) return 0;
      let positions;
      try {
        positions = await layoutExpansion(target, exp.nodes, exp.edges);
      } catch {
        positions = new Map<string, { x: number; y: number }>();
      }
      for (const n of exp.nodes) {
        dispatch({
          type: "addNode",
          node: { ...n, position: positions.get(n.id) ?? n.position },
        });
      }
      for (const e of exp.edges) dispatch({ type: "addEdge", edge: e });
      return exp.nodes.length;
    },
    [dataset, prefs],
  );

  const structKey = structuralKey(graph);
  const { flow, flowError } = useMemo(() => {
    try {
      return { flow: computeFlows(graph, dataset), flowError: null };
    } catch (err) {
      return {
        flow: null,
        flowError: err instanceof Error ? err.message : String(err),
      };
    }
    // Recompute only when topology/parameters change, not on mere moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structKey, dataset]);

  const brokenNodeIds = useMemo(() => {
    const set = new Set<string>();
    for (const b of flow?.diagnostics.brokenReferences ?? []) set.add(b.nodeId);
    return set;
  }, [flow]);

  const highlightedNodeIds = useMemo(() => {
    const set = new Set<string>();
    if (!hoveredBottleneck) return set;
    if (hoveredBottleneck.nodeId) set.add(hoveredBottleneck.nodeId);
    if (hoveredBottleneck.edgeId) {
      const e = graph.edges.find((x) => x.id === hoveredBottleneck.edgeId);
      if (e) {
        set.add(e.source);
        set.add(e.target);
      }
    }
    return set;
  }, [hoveredBottleneck, graph.edges]);

  // Debounced autosave (1s) on any graph change, skipping the initial mount.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setSaveStatus("saving");
    const timer = setTimeout(() => {
      void savePlanGraph({
        data: {
          id: planId,
          graph,
          recipePreferences: prefs,
        },
      })
        .then(() => setSaveStatus("saved"))
        .catch(() => setSaveStatus("idle"));
    }, 1000);
    return () => clearTimeout(timer);
  }, [graph, planId, prefs]);

  // The Inspector edits one node at a time; it only engages when the selection
  // is exactly one node (a marquee of many shows a summary instead).
  const selectedNodeId =
    selectedNodeIds.size === 1
      ? (selectedNodeIds.values().next().value ?? null)
      : null;

  const deleteNodes = useCallback((ids: Iterable<string>) => {
    for (const id of ids) dispatch({ type: "removeNode", id });
    setSelectedNodeIds(new Set());
  }, [dispatch]);

  const duplicateNodes = useCallback((ids: Iterable<string>) => {
    const idSet = new Set(ids);
    if (idSet.size === 0) return;
    const current = graphRef.current;
    const OFFSET = 48;
    // old id -> new id, so edges wholly inside the selection can be re-wired.
    const idMap = new Map<string, string>();
    const clones: PlanNode[] = [];
    for (const n of current.nodes) {
      if (!idSet.has(n.id)) continue;
      const cloneId = newId();
      idMap.set(n.id, cloneId);
      clones.push({
        ...n,
        id: cloneId,
        position: { x: n.position.x + OFFSET, y: n.position.y + OFFSET },
      });
    }
    if (clones.length === 0) return;
    for (const n of clones) dispatch({ type: "addNode", node: n });
    for (const e of current.edges) {
      const source = idMap.get(e.source);
      const target = idMap.get(e.target);
      if (!source || !target) continue; // only edges with both ends duplicated
      dispatch({ type: "addEdge", edge: { ...e, id: newId("e"), source, target } });
    }
    setSelectedNodeIds(new Set(idMap.values()));
  }, [dispatch]);

  // Memoized so renders that don't touch planner state (e.g. the save
  // indicator flipping) don't re-render every context consumer.
  const ctx = useMemo<PlannerContextValue>(
    () => ({
      dataset,
      graph,
      dispatch,
      flow,
      flowError,
      selectedNodeIds,
      setSelectedNodeIds,
      selectedNodeId,
      deleteNodes,
      duplicateNodes,
      highlightedNodeIds,
      setHoveredBottleneck,
      brokenNodeIds,
      recipePreferences: prefs,
      setRecipePreferences: setPrefs,
      expandInputs,
    }),
    [
      dataset,
      graph,
      flow,
      flowError,
      selectedNodeIds,
      selectedNodeId,
      deleteNodes,
      duplicateNodes,
      highlightedNodeIds,
      brokenNodeIds,
      prefs,
      expandInputs,
    ],
  );

  return (
    <PlannerContext.Provider value={ctx}>
      <div className="flex h-full flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-sidebar px-3">
          <Link
            to="/plans"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Plans
          </Link>
          <div className="h-5 w-px bg-border" />
          <span className="text-sm font-semibold uppercase tracking-wide">
            {planName}
          </span>
          <span className="ml-1 border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {dataset.version}
          </span>
          <div className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
            <RecipePreferencesDialog
              dataset={dataset}
              value={prefs}
              onChange={setPrefs}
            />
            <SaveIndicator status={saveStatus} />
          </div>
        </header>

        <ClientOnly
          fallback={
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" /> Loading canvas…
            </div>
          }
        >
          <div className="flex min-h-0 flex-1">
            <div className="w-60 shrink-0">
              <Palette />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="relative min-h-0 flex-1">
                <PlannerCanvas />
              </div>
              <div className="h-40 shrink-0">
                <TotalsBar />
              </div>
            </div>
            <div className="w-80 shrink-0">
              <Inspector />
            </div>
          </div>
        </ClientOnly>
      </div>
    </PlannerContext.Provider>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "saving") {
    return (
      <>
        <Loader2 className="size-3.5 animate-spin" /> Saving…
      </>
    );
  }
  if (status === "saved") {
    return (
      <>
        <Check className="size-3.5 text-primary" /> Saved
      </>
    );
  }
  return null;
}
