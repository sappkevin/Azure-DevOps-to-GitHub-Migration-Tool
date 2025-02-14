import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Cloud as AzureIcon, Github as GitHubIcon } from "lucide-react";
import type { AzureRepository } from "@/lib/azure";
import type { GitHubRepository } from "@/lib/github";

interface RepositoryListProps {
  repositories: AzureRepository[] | GitHubRepository[];
  type: "azure" | "github";
  selectedIds: string[];
  onSelect: (id: string) => void;
}

export function RepositoryList({ repositories, type, selectedIds, onSelect }: RepositoryListProps) {
  return (
    <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
      {repositories.map((repo: any) => (
        <Card key={repo.id} className="relative">
          <CardHeader className="flex flex-row items-center gap-2">
            {type === "azure" ? (
              <AzureIcon className="h-5 w-5 text-blue-600" />
            ) : (
              <GitHubIcon className="h-5 w-5" />
            )}
            <CardTitle className="text-lg">{repo.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <Checkbox
                id={repo.id}
                checked={selectedIds.includes(repo.id)}
                onCheckedChange={() => onSelect(repo.id)}
              />
              <label htmlFor={repo.id} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                Select for migration
              </label>
            </div>
            <div className="mt-4 text-sm text-gray-500">
              {type === "azure" && (
                <>
                  <p>Default Branch: {(repo as AzureRepository).defaultBranch}</p>
                  <p>Size: {Math.round((repo as AzureRepository).size / 1024)} MB</p>
                </>
              )}
              {type === "github" && (
                <p>Visibility: {(repo as GitHubRepository).private ? "Private" : "Public"}</p>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}