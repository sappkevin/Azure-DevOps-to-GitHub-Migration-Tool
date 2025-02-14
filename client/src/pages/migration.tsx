import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RepositoryList } from "@/components/repository-list";
import { MigrationStatus } from "@/components/migration-status";
import { getAzureRepositories } from "@/lib/azure";
import { getGitHubOrganizations, getGitHubRepositories, getCurrentUser } from "@/lib/github";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Migration() {
  const [selectedAzureRepos, setSelectedAzureRepos] = useState<string[]>([]);
  const [selectedOrg, setSelectedOrg] = useState("");
  const [accountType, setAccountType] = useState<"personal" | "organization">("personal");
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Get tokens from session storage
  const azureToken = sessionStorage.getItem("azure_token");
  const githubToken = sessionStorage.getItem("github_token");
  const azureSessionToken = sessionStorage.getItem("azure_session_token");
  const githubSessionToken = sessionStorage.getItem("github_session_token");

  // Redirect if tokens are missing
  useEffect(() => {
    if (!azureToken || !githubToken || !azureSessionToken || !githubSessionToken) {
      toast({
        title: "Authentication Required",
        description: "Please enter your Azure DevOps and GitHub tokens first.",
        variant: "destructive"
      });
      setLocation("/");
    }
  }, [azureToken, githubToken, azureSessionToken, githubSessionToken, toast, setLocation]);

  const { data: azureRepos, isLoading: isLoadingAzureRepos, error: azureError } = useQuery({
    queryKey: ["/api/azure/repositories"],
    enabled: !!azureSessionToken,
    queryFn: async () => {
      console.log("Fetching Azure repos...");
      return await getAzureRepositories(azureToken!);
    },
    retry: 1
  });

  const { data: githubUser, isLoading: isLoadingGithubUser } = useQuery({
    queryKey: ["/api/github/user"],
    enabled: !!githubSessionToken,
    queryFn: async () => {
      console.log("Fetching Github User...");
      return await getCurrentUser(githubToken!);
    },
  });

  const { data: githubOrgs, isLoading: isLoadingGithubOrgs } = useQuery({
    queryKey: ["/api/github/organizations"],
    enabled: !!githubSessionToken && accountType === "organization",
    queryFn: async () => {
      console.log("Fetching Github Organizations...");
      return await getGitHubOrganizations(githubToken!);
    },
  });

  // Show error toast if Azure repos fetch fails
  useEffect(() => {
    if (azureError) {
      console.error("Azure Error:", azureError);
      toast({
        title: "Error Loading Repositories",
        description: azureError instanceof Error ? azureError.message : "Failed to load Azure repositories",
        variant: "destructive"
      });
    }
  }, [azureError, toast]);

  const migrationMutation = useMutation({
    mutationFn: async (data: any) => {
      const azureSessionToken = sessionStorage.getItem('azure_session_token');
      const githubSessionToken = sessionStorage.getItem('github_session_token');

      if (!azureSessionToken || !githubSessionToken) {
        throw new Error("Missing authentication tokens");
      }

      const response = await fetch("/api/migrations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${azureSessionToken}`,
          "X-GitHub-Token": githubSessionToken
        },
        body: JSON.stringify({
          ...data,
          sourceRepos: selectedAzureRepos,
          targetOrg: accountType === "organization" ? selectedOrg : githubUser?.login
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to start migration');
      }

      return response.json();
    },
    onSuccess: (data) => {
      console.log("Migration started successfully:", data);
      toast({
        title: "Migration Started",
        description: "Your repositories are being migrated. You can track the progress below."
      });
      queryClient.invalidateQueries({ queryKey: ["/api/migrations"] });
    },
    onError: (error) => {
      console.error("Migration error:", error);
      toast({
        title: "Migration Failed",
        description: error instanceof Error ? error.message : "Failed to start migration",
        variant: "destructive"
      });
    }
  });

  if (!azureToken || !githubToken || !azureSessionToken || !githubSessionToken) {
    return null; // Will redirect via useEffect
  }

  const handleStartMigration = async () => {
    if (!selectedAzureRepos.length) {
      toast({
        title: "Selection Required",
        description: "Please select at least one repository to migrate.",
        variant: "destructive"
      });
      return;
    }

    const owner = accountType === "organization" ? selectedOrg : githubUser?.login;
    if (!owner) {
      toast({
        title: accountType === "organization" ? "Organization Required" : "User Not Found",
        description: accountType === "organization"
          ? "Please select a GitHub organization."
          : "Could not determine GitHub user.",
        variant: "destructive"
      });
      return;
    }

    try {
      migrationMutation.mutate({
        sourceRepos: selectedAzureRepos,
        targetOrg: owner
      });
    } catch (error) {
      console.error("Error starting migration:", error);
      toast({
        title: "Migration Setup Failed",
        description: error instanceof Error ? error.message : "Failed to setup migration",
        variant: "destructive"
      });
    }
  };

  const isStartMigrationDisabled =
    !azureToken ||
    !githubToken ||
    !azureSessionToken ||
    !githubSessionToken ||
    azureToken.trim() === "" ||
    githubToken.trim() === "" ||
    isLoadingAzureRepos ||
    !selectedAzureRepos.length ||
    (accountType === "organization" && !selectedOrg) ||
    migrationMutation.isPending ||
    !!azureError ||
    isLoadingGithubOrgs ||
    isLoadingGithubUser;

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <h1 className="text-3xl font-bold">Repository Migration</h1>

        <Card>
          <CardHeader>
            <CardTitle>Select GitHub Destination</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <RadioGroup
              value={accountType}
              onValueChange={(value) => {
                setAccountType(value as "personal" | "organization");
                setSelectedOrg("");
              }}
              className="space-y-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="personal" id="personal" />
                <Label htmlFor="personal">
                  Personal Account
                  {isLoadingGithubUser ? " (Loading...)" : githubUser ? ` (${githubUser.login})` : ""}
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="organization" id="organization" />
                <Label htmlFor="organization">Organization Account</Label>
              </div>
            </RadioGroup>

            {accountType === "organization" && (
              <div className="pl-6">
                {isLoadingGithubOrgs ? (
                  <div className="text-center text-gray-500">Loading GitHub organizations...</div>
                ) : (
                  <Select value={selectedOrg} onValueChange={setSelectedOrg}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select an organization" />
                    </SelectTrigger>
                    <SelectContent>
                      {githubOrgs?.map((org) => (
                        <SelectItem key={org.id} value={org.login}>
                          {org.login}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Select Source Repositories</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingAzureRepos ? (
              <div className="text-center text-gray-500">Loading Azure DevOps repositories...</div>
            ) : azureRepos && !azureError ? (
              <RepositoryList
                repositories={azureRepos}
                type="azure"
                selectedIds={selectedAzureRepos}
                onSelect={(id) => {
                  setSelectedAzureRepos(prev =>
                    prev.includes(id)
                      ? prev.filter(r => r !== id)
                      : [...prev, id]
                  );
                }}
              />
            ) : (
              <div className="text-center mt-4 text-red-500">
                Failed to load repositories. Please check your Azure PAT token and try again.
              </div>
            )}
          </CardContent>
        </Card>

        <Button
          onClick={handleStartMigration}
          disabled={isStartMigrationDisabled}
          className="w-full"
          variant="default"
          size="lg"
        >
          {isLoadingAzureRepos || isLoadingGithubOrgs || isLoadingGithubUser ? "Loading..." : "Start Migration"}
        </Button>

        <div className="space-y-4">
          {migrationMutation.data && (
            <MigrationStatus
              migration={migrationMutation.data}
            />
          )}
        </div>
      </div>
    </div>
  );
}