/** React Flow node type registry, keyed by {@link PlanNodeKind}. */

import type { NodeTypes } from "@xyflow/react";

import { PlanInputNode, PlanOutputNode } from "./BoundaryNode";
import { ExtractorNode } from "./ExtractorNode";
import { MachineNode } from "./MachineNode";
import { MergerNode, SplitterNode } from "./LogisticsNode";

export const nodeTypes: NodeTypes = {
  machine: MachineNode,
  extractor: ExtractorNode,
  splitter: SplitterNode,
  merger: MergerNode,
  planInput: PlanInputNode,
  planOutput: PlanOutputNode,
};
