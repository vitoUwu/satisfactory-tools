/**
 * Machine card (Manufacturer or Generator). Shows the building icon, a recipe
 * selector (Manufacturers only), clock-speed slider + numeric input, Somersloop
 * slot toggles, an efficiency badge and the power draw. Generators render their
 * fuel/byproduct ports but have no recipe.
 */

import {
  getBuilding,
  isManufacturer,
  recipesProducedIn,
} from "@satisfactory-tools/game-data";
import { Button } from "@satisfactory-tools/ui/components/button";
import { cn } from "@satisfactory-tools/ui/lib/utils";
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type NodeProps,
} from "@xyflow/react";
import { Wand2 } from "lucide-react";
import { useEffect, useState } from "react";

import { ClockSpeedControl, SimpleSelect, SomersloopToggles } from "../controls";
import { fmtRate } from "../format";
import { ItemIcon } from "../ItemIcon";
import { usePlanner } from "../PlannerContext";
import {
  inputPortRate,
  inputPorts,
  outputPortRate,
  outputPorts,
  type PortSpec,
} from "../ports";
import { NodeShell } from "./NodeShell";
import { mediumClass } from "./PortHandles";

export function MachineNode({ id, selected }: NodeProps) {
  const { graph, dataset, dispatch, flow, highlightedNodeIds, brokenNodeIds, expandInputs } =
    usePlanner();
  const [expanding, setExpanding] = useState(false);
  const updateNodeInternals = useUpdateNodeInternals();

  const node = graph.nodes.find((n) => n.id === id);
  const machineNode = node?.kind === "machine" ? node : null;

  const portSig = machineNode
    ? `${inputPorts(machineNode, dataset)
        .map((p) => p.id)
        .join(",")}|${outputPorts(machineNode, dataset)
        .map((p) => p.id)
        .join(",")}`
    : "";
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, portSig, updateNodeInternals]);

  if (!node || node.kind !== "machine") return null;

  const building = getBuilding(dataset, node.buildingClass);
  const isGen = building?.kind === "generator";
  const slots =
    building && isManufacturer(building) ? building.somersloopSlots : 0;
  const nodeFlow = flow?.perNode[id];

  const recipeOptions = building
    ? recipesProducedIn(dataset, building.className).map((r) => ({
        value: r.className,
        label: r.isAlternate ? `Alt: ${r.displayName}` : r.displayName,
      }))
    : [];

  const inputs = inputPorts(node, dataset);
  const outputs = outputPorts(node, dataset);

  return (
    <NodeShell
      iconSlug={node.buildingClass}
      title={building?.displayName ?? node.buildingClass}
      subtitle={isGen ? "Generator" : undefined}
      efficiency={nodeFlow?.efficiency}
      powerMW={nodeFlow?.powerMW}
      selected={selected}
      highlighted={highlightedNodeIds.has(id)}
      broken={brokenNodeIds.has(id)}
      accent="primary"
    >
      <div className="flex flex-col gap-2">
        {!isGen && recipeOptions.length > 0 && (
          <SimpleSelect
            value={node.recipeClass}
            onValueChange={(recipeClass) =>
              dispatch({ type: "updateNode", id, patch: { recipeClass } })
            }
            options={recipeOptions}
            placeholder="Select recipe"
          />
        )}
        {(inputs.length > 0 || outputs.length > 0) && (
          <div className="flex flex-col gap-1.5 border-y border-border py-2 text-[11px]">
            {inputs.length > 0 && (
              <PortRateList
                label="In"
                side="in"
                ports={inputs}
                rateOf={(p) => inputPortRate(node, p.id, dataset)}
              />
            )}
            {outputs.length > 0 && (
              <PortRateList
                label="Out"
                side="out"
                ports={outputs}
                rateOf={(p) => outputPortRate(node, p.id, dataset)}
              />
            )}
          </div>
        )}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-muted-foreground">
            Clock
          </span>
          <ClockSpeedControl
            value={node.clockSpeed}
            onChange={(clockSpeed) =>
              dispatch({ type: "updateNode", id, patch: { clockSpeed } })
            }
          />
        </div>
        {slots > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase text-muted-foreground">
              Somersloops
            </span>
            <SomersloopToggles
              slots={slots}
              value={node.somersloops}
              onChange={(somersloops) =>
                dispatch({ type: "updateNode", id, patch: { somersloops } })
              }
            />
          </div>
        )}
        {!isGen && node.recipeClass && (
          <Button
            variant="outline"
            size="sm"
            className="nodrag h-7 w-full gap-1.5 text-xs"
            disabled={expanding}
            onClick={(e) => {
              e.stopPropagation();
              setExpanding(true);
              void expandInputs(id).finally(() => setExpanding(false));
            }}
          >
            <Wand2 className="size-3.5" />
            {expanding ? "Expanding…" : "Expand inputs"}
          </Button>
        )}
      </div>
    </NodeShell>
  );
}

function PortRateList({
  label,
  side,
  ports,
  rateOf,
}: {
  label: string;
  side: "in" | "out";
  ports: PortSpec[];
  rateOf: (p: PortSpec) => number | undefined;
}) {
  const isIn = side === "in";
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {ports.map((p) => {
        const rate = rateOf(p);
        const handle = (
          <Handle
            id={p.id}
            type={isIn ? "target" : "source"}
            position={isIn ? Position.Left : Position.Right}
            className={cn(
              "!relative !left-0 !top-0 !size-3 !min-w-0 !transform-none !rounded-none shrink-0",
              mediumClass(p.form),
            )}
          />
        );
        return (
          <div key={p.id} className="flex items-center gap-1.5">
            {isIn && handle}
            {p.itemClass ? (
              <ItemIcon slug={p.itemClass} className="size-4 shrink-0" />
            ) : (
              <span className="size-4 shrink-0" />
            )}
            <span className="flex-1 truncate">{p.label}</span>
            {rate !== undefined && (
              <span className="tabular-nums text-muted-foreground">
                {fmtRate(rate)}/min
              </span>
            )}
            {!isIn && handle}
          </div>
        );
      })}
    </div>
  );
}
