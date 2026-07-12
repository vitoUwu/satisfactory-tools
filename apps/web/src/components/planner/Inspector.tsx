/**
 * Right-hand Inspector for the selected node: full editable properties (recipe,
 * clock, Somersloops, purity, Mk, item/rate) plus the node's computed steady-state
 * flows (efficiency, actual inputs/outputs, power) when available.
 */

import type { ExtractorBuilding, Purity } from "@satisfactory-tools/game-data";
import {
  getBuilding,
  getItem,
  isManufacturer,
  recipesProducedIn,
} from "@satisfactory-tools/game-data";
import { Button } from "@satisfactory-tools/ui/components/button";
import { Separator } from "@satisfactory-tools/ui/components/separator";
import type { ItemRate, PlanNode } from "@satisfactory-tools/planner-engine";
import { Copy, Trash2, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";

import {
  ClockSpeedControl,
  RateInput,
  SimpleSelect,
  SomersloopToggles,
} from "./controls";
import { fmtEfficiency, fmtPower, fmtRate } from "./format";
import { ItemIcon } from "./ItemIcon";
import { usePlanner } from "./PlannerContext";

const PURITY_OPTIONS: { value: Purity; label: string }[] = [
  { value: "impure", label: "Impure (x0.5)" },
  { value: "normal", label: "Normal (x1)" },
  { value: "pure", label: "Pure (x2)" },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function RateList({ title, rates }: { title: string; rates: ItemRate[] }) {
  const { dataset } = usePlanner();
  if (rates.length === 0) return null;
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <ul className="flex flex-col gap-1">
        {rates.map((r) => (
          <li key={r.itemClass} className="flex items-center gap-2 text-xs">
            <ItemIcon slug={r.itemClass} className="size-4 shrink-0" />
            <span className="flex-1 truncate">
              {getItem(dataset, r.itemClass)?.displayName ?? r.itemClass}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {fmtRate(r.ratePerMinute)}/min
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Inspector() {
  const {
    graph,
    dataset,
    flow,
    selectedNodeIds,
    selectedNodeId,
    deleteNodes,
    duplicateNodes,
  } = usePlanner();

  // A marquee of several nodes shows a group summary instead of a per-node
  // editor — editing heterogeneous nodes at once is ambiguous.
  if (selectedNodeIds.size > 1) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 border-l border-border bg-sidebar p-4 text-center">
        <div className="text-sm font-semibold uppercase tracking-wide">
          {selectedNodeIds.size} nodes selected
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => duplicateNodes(selectedNodeIds)}
          >
            <Copy className="size-4" /> Duplicate
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-destructive"
            onClick={() => deleteNodes(selectedNodeIds)}
          >
            <Trash2 className="size-4" /> Delete
          </Button>
        </div>
      </div>
    );
  }

  const node = graph.nodes.find((n) => n.id === selectedNodeId) ?? null;

  if (!node) {
    return (
      <div className="flex h-full items-center justify-center border-l border-border bg-sidebar p-4 text-center text-xs text-muted-foreground">
        Select a node to edit its properties.
      </div>
    );
  }

  const nodeFlow = flow?.perNode[node.id];

  return (
    <div className="flex h-full flex-col border-l border-border bg-sidebar">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <NodeIcon node={node} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold uppercase tracking-wide">
            {nodeTitle(node, dataset)}
          </div>
          <div className="text-[10px] text-muted-foreground">{node.kind}</div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => duplicateNodes([node.id])}
          aria-label="Duplicate node"
        >
          <Copy className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => deleteNodes([node.id])}
          aria-label="Delete node"
        >
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
        <NodeEditor node={node} />

        {node.kind === "machine" && node.recipeClass && (
          <ExpandInputsButton nodeId={node.id} />
        )}

        {nodeFlow && (
          <>
            <Separator />
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold uppercase tracking-wider text-muted-foreground">
                Efficiency
              </span>
              <span className="tabular-nums">
                {fmtEfficiency(nodeFlow.efficiency)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold uppercase tracking-wider text-muted-foreground">
                Power
              </span>
              <span className="tabular-nums">{fmtPower(nodeFlow.powerMW)}</span>
            </div>
            <RateList title="Inputs" rates={nodeFlow.actualInputs} />
            <RateList title="Outputs" rates={nodeFlow.actualOutputs} />
          </>
        )}
      </div>
    </div>
  );
}

function NodeIcon({ node }: { node: PlanNode }) {
  const slug =
    node.kind === "planInput" || node.kind === "planOutput"
      ? node.itemClass
      : "buildingClass" in node
        ? node.buildingClass
        : "";
  return <ItemIcon slug={slug} className="size-7 shrink-0" />;
}

function nodeTitle(
  node: PlanNode,
  dataset: ReturnType<typeof usePlanner>["dataset"],
): string {
  if (node.kind === "planInput") return "Plan Input";
  if (node.kind === "planOutput") return "Plan Output";
  return getBuilding(dataset, node.buildingClass)?.displayName ?? node.buildingClass;
}

/** Solver Assist trigger: expands the selected Machine's upstream ingredient chain. */
function ExpandInputsButton({ nodeId }: { nodeId: string }) {
  const { expandInputs } = usePlanner();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full gap-1.5"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void expandInputs(nodeId).finally(() => setBusy(false));
      }}
    >
      <Wand2 className="size-3.5" />
      {busy ? "Expanding…" : "Expand inputs"}
    </Button>
  );
}

function NodeEditor({ node }: { node: PlanNode }) {
  const { dataset, dispatch } = usePlanner();
  const id = node.id;

  const itemOptions = useMemo(
    () =>
      Object.values(dataset.items)
        .map((it) => ({ value: it.className, label: it.displayName }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [dataset],
  );

  switch (node.kind) {
    case "machine": {
      const building = getBuilding(dataset, node.buildingClass);
      const slots = building && isManufacturer(building) ? building.somersloopSlots : 0;
      const recipeOptions = building
        ? recipesProducedIn(dataset, building.className).map((r) => ({
            value: r.className,
            label: r.isAlternate ? `Alt: ${r.displayName}` : r.displayName,
          }))
        : [];
      return (
        <div className="flex flex-col gap-4">
          {recipeOptions.length > 0 && (
            <Field label="Recipe">
              <SimpleSelect
                value={node.recipeClass}
                onValueChange={(recipeClass) =>
                  dispatch({ type: "updateNode", id, patch: { recipeClass } })
                }
                options={recipeOptions}
                placeholder="Select recipe"
              />
            </Field>
          )}
          <Field label="Clock speed">
            <ClockSpeedControl
              value={node.clockSpeed}
              onChange={(clockSpeed) =>
                dispatch({ type: "updateNode", id, patch: { clockSpeed } })
              }
            />
          </Field>
          {slots > 0 && (
            <Field label="Somersloops">
              <SomersloopToggles
                slots={slots}
                value={node.somersloops}
                onChange={(somersloops) =>
                  dispatch({ type: "updateNode", id, patch: { somersloops } })
                }
              />
            </Field>
          )}
        </div>
      );
    }
    case "extractor": {
      const building = getBuilding(dataset, node.buildingClass) as
        | ExtractorBuilding
        | undefined;
      const resourceOptions = (building?.allowedResources ?? []).map((r) => ({
        value: r,
        label: getItem(dataset, r)?.displayName ?? r,
      }));
      return (
        <div className="flex flex-col gap-4">
          <Field label="Resource">
            <SimpleSelect
              value={node.resourceClass}
              onValueChange={(resourceClass) =>
                dispatch({ type: "updateNode", id, patch: { resourceClass } })
              }
              options={resourceOptions}
            />
          </Field>
          <Field label="Purity">
            <SimpleSelect
              value={node.purity}
              onValueChange={(p) =>
                dispatch({ type: "updateNode", id, patch: { purity: p as Purity } })
              }
              options={PURITY_OPTIONS}
            />
          </Field>
          <Field label="Clock speed">
            <ClockSpeedControl
              value={node.clockSpeed}
              onChange={(clockSpeed) =>
                dispatch({ type: "updateNode", id, patch: { clockSpeed } })
              }
            />
          </Field>
        </div>
      );
    }
    case "planInput":
    case "planOutput":
      return (
        <div className="flex flex-col gap-4">
          <Field label="Item">
            <SimpleSelect
              value={node.itemClass}
              onValueChange={(itemClass) =>
                dispatch({ type: "updateNode", id, patch: { itemClass } })
              }
              options={itemOptions}
            />
          </Field>
          <Field label="Rate">
            <RateInput
              value={node.ratePerMinute}
              onChange={(ratePerMinute) =>
                dispatch({ type: "updateNode", id, patch: { ratePerMinute } })
              }
            />
          </Field>
        </div>
      );
    case "splitter":
    case "merger":
      return (
        <p className="text-xs text-muted-foreground">
          Logistics node — no properties to configure.
        </p>
      );
  }
}
