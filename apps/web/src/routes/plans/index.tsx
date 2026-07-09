/**
 * Plan list: every saved Plan as a card (name + pinned dataset version badge) with
 * open / rename / duplicate / delete actions, plus a "New Plan" dialog that pins the
 * chosen Game Dataset version (ADR-0002). Persistence goes through the server
 * functions in `@/functions/plans`.
 */

import type { Plan } from "@satisfactory-tools/db/schema/index";
import { Badge } from "@satisfactory-tools/ui/components/badge";
import { Button } from "@satisfactory-tools/ui/components/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@satisfactory-tools/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@satisfactory-tools/ui/components/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@satisfactory-tools/ui/components/alert-dialog";
import { Input } from "@satisfactory-tools/ui/components/input";
import { Label } from "@satisfactory-tools/ui/components/label";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Copy, FileStack, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SimpleSelect } from "@/components/planner/controls";
import { listDatasetVersionsFn } from "@/components/planner/dataset";
import {
  createPlan,
  deletePlan,
  duplicatePlan,
  listPlans,
  renamePlan,
} from "@/functions/plans";

export const Route = createFileRoute("/plans/")({
  loader: async () => {
    const [plans, versions] = await Promise.all([
      listPlans(),
      listDatasetVersionsFn(),
    ]);
    return { plans, versions };
  },
  component: PlansListPage,
});

function PlansListPage() {
  const { plans, versions } = Route.useLoaderData();
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Plan | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Plan | null>(null);

  const refresh = () => router.invalidate();

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold uppercase tracking-wide">
            <FileStack className="size-5 text-primary" /> Plans
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Interactive factory graphs. Each Plan is pinned to a Game Dataset
            version.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" /> New Plan
        </Button>
      </div>

      {plans.length === 0 ? (
        <div className="border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          No plans yet. Create your first factory plan.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <Card key={plan.id} className="flex flex-col">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="truncate">{plan.name}</CardTitle>
                  <Badge variant="outline" className="shrink-0">
                    {plan.datasetVersion}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex-1 text-xs text-muted-foreground">
                {plan.graph.nodes.length} nodes · {plan.graph.edges.length}{" "}
                connections
              </CardContent>
              <CardFooter className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() =>
                    router.navigate({
                      to: "/plans/$planId",
                      params: { planId: plan.id },
                    })
                  }
                >
                  Open
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRenameTarget(plan)}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await duplicatePlan({ data: { id: plan.id } });
                    toast.success("Plan duplicated");
                    await refresh();
                  }}
                >
                  <Copy className="size-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDeleteTarget(plan)}
                >
                  <Trash2 className="size-3.5 text-destructive" />
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      <CreatePlanDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        versions={versions}
        onCreated={async (plan) => {
          setCreateOpen(false);
          await router.navigate({
            to: "/plans/$planId",
            params: { planId: plan.id },
          });
        }}
      />

      <RenamePlanDialog
        plan={renameTarget}
        onOpenChange={(open) => !open && setRenameTarget(null)}
        onRenamed={async () => {
          setRenameTarget(null);
          await refresh();
        }}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete plan?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes “{deleteTarget?.name}”. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!deleteTarget) return;
                await deletePlan({ data: { id: deleteTarget.id } });
                setDeleteTarget(null);
                toast.success("Plan deleted");
                await refresh();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CreatePlanDialog({
  open,
  onOpenChange,
  versions,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versions: string[];
  onCreated: (plan: Plan) => void;
}) {
  const [name, setName] = useState("");
  const [version, setVersion] = useState(versions[versions.length - 1] ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || !version) return;
    setBusy(true);
    try {
      const plan = await createPlan({
        data: { name: name.trim(), datasetVersion: version },
      });
      setName("");
      onCreated(plan);
    } catch {
      toast.error("Could not create plan");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Plan</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="plan-name">Name</Label>
            <Input
              id="plan-name"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              placeholder="My Steel Factory"
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Game Dataset version</Label>
            <SimpleSelect
              value={version}
              onValueChange={setVersion}
              options={versions.map((v) => ({ value: v, label: v }))}
              placeholder={versions.length ? "Select version" : "No datasets"}
              size="default"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !name.trim() || !version}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenamePlanDialog({
  plan,
  onOpenChange,
  onRenamed,
}: {
  plan: Plan | null;
  onOpenChange: (open: boolean) => void;
  onRenamed: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  // Reset the field whenever a new rename target opens.
  const [lastId, setLastId] = useState<string | null>(null);
  if (plan && plan.id !== lastId) {
    setLastId(plan.id);
    setName(plan.name);
  }

  const submit = async () => {
    if (!plan || !name.trim()) return;
    setBusy(true);
    try {
      await renamePlan({ data: { id: plan.id, name: name.trim() } });
      onRenamed();
    } catch {
      toast.error("Could not rename plan");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={plan !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename Plan</DialogTitle>
        </DialogHeader>
        <div className="py-2">
          <Input
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !name.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
