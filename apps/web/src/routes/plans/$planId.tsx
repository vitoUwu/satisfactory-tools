/**
 * Plan editor route. Loads the Plan and its pinned Game Dataset (ADR-0002) on the
 * server, then hands both to the client-only Planner editor.
 */

import { createFileRoute } from "@tanstack/react-router";

import { loadDatasetFn } from "@/components/planner/dataset";
import { PlannerEditor } from "@/components/planner/PlannerEditor";
import { getPlan } from "@/functions/plans";

export const Route = createFileRoute("/plans/$planId")({
  loader: async ({ params }) => {
    const plan = await getPlan({ data: { id: params.planId } });
    const dataset = await loadDatasetFn({
      data: { version: plan.datasetVersion },
    });
    return { plan, dataset };
  },
  component: PlanEditorPage,
});

function PlanEditorPage() {
  const { plan, dataset } = Route.useLoaderData();
  return (
    <PlannerEditor
      planId={plan.id}
      planName={plan.name}
      dataset={dataset}
      initialGraph={plan.graph}
      recipePreferences={plan.recipePreferences}
    />
  );
}
