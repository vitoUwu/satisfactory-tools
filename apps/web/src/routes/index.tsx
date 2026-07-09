import { Button } from "@satisfactory-tools/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@satisfactory-tools/ui/components/card";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Factory } from "lucide-react";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">
      <div className="mb-8">
        <h1 className="flex items-center gap-2 text-2xl font-bold uppercase tracking-wide">
          <Factory className="size-6 text-primary" />
          Satisfactory Tools
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A suite of tools for planning FICSIT factories.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Planner</CardTitle>
          <CardDescription>
            An interactive, animated graph editor for designing factories:
            machines and logistics wired by belts and pipes, with live throughput
            and power calculations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button render={<Link to="/plans" />}>
            Open Planner <ArrowRight className="size-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
