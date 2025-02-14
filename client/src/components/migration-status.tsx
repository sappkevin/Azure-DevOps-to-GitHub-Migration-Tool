import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import type { Migration } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";

interface MigrationStatusProps {
  migration: Migration;
}

export function MigrationStatus({ migration }: MigrationStatusProps) {
  // Poll for updates when migration is in progress
  const { data: updatedMigration } = useQuery({
    queryKey: ["/api/migrations", migration.id],
    enabled: migration.status === "in_progress" || migration.status === "pending",
    refetchInterval: 2000, // Poll every 2 seconds
    queryFn: async () => {
      const azureSessionToken = sessionStorage.getItem('azure_session_token');
      const githubSessionToken = sessionStorage.getItem('github_session_token');

      if (!azureSessionToken || !githubSessionToken) {
        throw new Error('Missing authentication tokens');
      }

      const response = await fetch(`/api/migrations/${migration.id}`, {
        headers: {
          "Authorization": `Bearer ${azureSessionToken}`,
          "X-GitHub-Token": githubSessionToken,
          "Accept": "application/json"
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch migration status');
      }
      return response.json();
    }
  });

  // Use the most recent migration data
  const currentMigration = updatedMigration || migration;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Migration Status</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium">Progress</p>
              <p className="text-sm text-gray-500">{currentMigration.progress}% Complete</p>
            </div>
            <Progress value={currentMigration.progress} className="w-full" />

            {currentMigration.status === "in_progress" && (
              <div className="flex items-center gap-2 mt-2 text-blue-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                <p className="text-sm">Migration in progress...</p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">Source:</p>
            <p className="text-sm text-gray-500">{currentMigration.sourceRepo}</p>
          </div>

          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">Target:</p>
            <p className="text-sm text-gray-500">{currentMigration.targetRepo}</p>
          </div>

          {currentMigration.error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{currentMigration.error}</AlertDescription>
            </Alert>
          )}

          {currentMigration.status === "completed" && !currentMigration.error && (
            <Alert className="bg-green-50 border-green-200">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-600">
                Migration completed successfully
              </AlertDescription>
            </Alert>
          )}
        </div>
      </CardContent>
    </Card>
  );
}