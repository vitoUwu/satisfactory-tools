/**
 * Extractor card. Like a machine card but for raw-resource extraction: a resource
 * selector, a Purity selector, an Mk-variant selector for Miners (switches the
 * underlying building), clock-speed control, efficiency and power.
 */

import type { ExtractorBuilding, Purity } from "@satisfactory-tools/game-data";
import { getBuilding, getItem } from "@satisfactory-tools/game-data";
import type { NodeProps } from "@xyflow/react";

import { ClockSpeedControl, SimpleSelect } from "../controls";
import { minerVariants } from "../factory";
import { usePlanner } from "../PlannerContext";
import { outputPorts } from "../ports";
import { NodeShell } from "./NodeShell";
import { PortHandles } from "./PortHandles";

const PURITY_OPTIONS: { value: Purity; label: string }[] = [
  { value: "impure", label: "Impure (x0.5)" },
  { value: "normal", label: "Normal (x1)" },
  { value: "pure", label: "Pure (x2)" },
];

export function ExtractorNode({ id, selected }: NodeProps) {
  const { graph, dataset, dispatch, flow, highlightedNodeIds, brokenNodeIds } =
    usePlanner();
  const node = graph.nodes.find((n) => n.id === id);
  if (!node || node.kind !== "extractor") return null;

  const building = getBuilding(dataset, node.buildingClass) as
    | ExtractorBuilding
    | undefined;
  const nodeFlow = flow?.perNode[id];
  const isMiner = building?.extractorType === "miner";

  const resourceOptions = (building?.allowedResources ?? []).map((r) => ({
    value: r,
    label: getItem(dataset, r)?.displayName ?? r,
  }));

  const miners = minerVariants(dataset);
  const mkOptions = miners.map((m) => ({
    value: m.className,
    label: `Mk.${m.mk ?? "?"}`,
  }));

  return (
    <NodeShell
      iconSlug={node.buildingClass}
      title={building?.displayName ?? node.buildingClass}
      subtitle="Extractor"
      efficiency={nodeFlow?.efficiency}
      powerMW={nodeFlow?.powerMW}
      selected={selected}
      highlighted={highlightedNodeIds.has(id)}
      broken={brokenNodeIds.has(id)}
      accent="primary"
    >
      <div className="flex flex-col gap-2">
        <SimpleSelect
          value={node.resourceClass}
          onValueChange={(resourceClass) =>
            dispatch({ type: "updateNode", id, patch: { resourceClass } })
          }
          options={resourceOptions}
          placeholder="Select resource"
        />
        <div className="flex gap-2">
          {isMiner && mkOptions.length > 0 && (
            <div className="flex-1">
              <span className="text-[10px] uppercase text-muted-foreground">
                Variant
              </span>
              <SimpleSelect
                value={node.buildingClass}
                onValueChange={(buildingClass) => {
                  const next = miners.find((m) => m.className === buildingClass);
                  dispatch({
                    type: "updateNode",
                    id,
                    patch: { buildingClass, mk: next?.mk },
                  });
                }}
                options={mkOptions}
              />
            </div>
          )}
          <div className="flex-1">
            <span className="text-[10px] uppercase text-muted-foreground">
              Purity
            </span>
            <SimpleSelect
              value={node.purity}
              onValueChange={(p) =>
                dispatch({
                  type: "updateNode",
                  id,
                  patch: { purity: p as Purity },
                })
              }
              options={PURITY_OPTIONS}
            />
          </div>
        </div>
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
      </div>
      <PortHandles inputs={[]} outputs={outputPorts(node, dataset)} />
    </NodeShell>
  );
}
