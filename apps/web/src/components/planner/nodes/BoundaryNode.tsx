/**
 * Plan Input / Plan Output boundary nodes (ADR-0004): abstract factory edges that
 * declare an item entering or leaving the Plan at a fixed rate, without modeling
 * where it comes from or goes. Each has an item selector and a rate field.
 */

import { getItem } from "@satisfactory-tools/game-data";
import { cn } from "@satisfactory-tools/ui/lib/utils";
import type { NodeProps } from "@xyflow/react";
import { LogIn, LogOut } from "lucide-react";
import { useMemo } from "react";

import { RateInput, SimpleSelect } from "../controls";
import { usePlanner } from "../PlannerContext";
import { inputPorts, outputPorts } from "../ports";
import { ItemIcon } from "../ItemIcon";
import { PortHandles } from "./PortHandles";

export function PlanInputNode({ id, selected }: NodeProps) {
  return <BoundaryNode id={id} selected={selected} kind="planInput" />;
}

export function PlanOutputNode({ id, selected }: NodeProps) {
  return <BoundaryNode id={id} selected={selected} kind="planOutput" />;
}

function BoundaryNode({
  id,
  selected,
  kind,
}: {
  id: string;
  selected: NodeProps["selected"];
  kind: "planInput" | "planOutput";
}) {
  const { graph, dataset, dispatch, highlightedNodeIds, brokenNodeIds } =
    usePlanner();
  const node = graph.nodes.find((n) => n.id === id);

  const itemOptions = useMemo(
    () =>
      Object.values(dataset.items)
        .map((it) => ({ value: it.className, label: it.displayName }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [dataset],
  );

  if (!node || node.kind !== kind) return null;
  const isInput = kind === "planInput";
  const Icon = isInput ? LogIn : LogOut;

  return (
    <div
      style={{ width: 220 }}
      className={cn(
        "relative border-2 border-dashed bg-card/80 text-card-foreground shadow-sm",
        selected ? "border-primary ring-1 ring-primary" : "border-border",
        brokenNodeIds.has(id) && "border-destructive ring-1 ring-destructive",
        highlightedNodeIds.has(id) && "ring-2 ring-destructive animate-pulse",
      )}
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
        <Icon className="size-4 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wide">
          {isInput ? "Plan Input" : "Plan Output"}
        </span>
      </div>
      <div className="flex flex-col gap-2 px-3 py-2">
        <div className="flex items-center gap-2">
          <ItemIcon slug={node.itemClass} className="size-6 shrink-0" />
          <SimpleSelect
            value={node.itemClass}
            onValueChange={(itemClass) =>
              dispatch({ type: "updateNode", id, patch: { itemClass } })
            }
            options={itemOptions}
            placeholder="Select item"
          />
        </div>
        <RateInput
          value={node.ratePerMinute}
          onChange={(ratePerMinute) =>
            dispatch({ type: "updateNode", id, patch: { ratePerMinute } })
          }
        />
        <span className="text-[10px] text-muted-foreground">
          {getItem(dataset, node.itemClass)?.form === "solid"
            ? "Solid · Belt"
            : getItem(dataset, node.itemClass)
              ? "Fluid · Pipe"
              : ""}
        </span>
      </div>
      <PortHandles
        nodeId={id}
        inputs={inputPorts(node, dataset)}
        outputs={outputPorts(node, dataset)}
      />
    </div>
  );
}
