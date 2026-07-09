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
import type { NodeProps } from "@xyflow/react";
import { Wand2 } from "lucide-react";
import { useState } from "react";

import { ClockSpeedControl, SimpleSelect, SomersloopToggles } from "../controls";
import { usePlanner } from "../PlannerContext";
import { inputPorts, outputPorts } from "../ports";
import { NodeShell } from "./NodeShell";
import { PortHandles } from "./PortHandles";

export function MachineNode({ id, selected }: NodeProps) {
  const { graph, dataset, dispatch, flow, highlightedNodeIds, brokenNodeIds, expandInputs } =
    usePlanner();
  const [expanding, setExpanding] = useState(false);
  const node = graph.nodes.find((n) => n.id === id);
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
      <PortHandles
        inputs={inputPorts(node, dataset)}
        outputs={outputPorts(node, dataset)}
      />
    </NodeShell>
  );
}
