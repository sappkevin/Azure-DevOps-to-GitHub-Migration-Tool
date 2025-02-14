import { apiRequest } from "./queryClient";
import { getAuthHeaders } from "./auth";

export interface AzureRepository {
  id: string;
  name: string;
  url: string;
  defaultBranch: string;
  size: number;
}

export interface AzurePipeline {
  id: string;
  name: string;
  type: "build" | "release";
  configuration: any;
}

export async function getAzureRepositories(token: string): Promise<AzureRepository[]> {
  console.log("Fetching Azure repositories...");
  const azureSessionToken = sessionStorage.getItem('azure_session_token');

  if (!azureSessionToken) {
    throw new Error("Azure session token is required");
  }

  const response = await fetch("/api/azure/repositories", {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${azureSessionToken}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const error = await response.json();
    console.error("Azure API error:", error);
    throw new Error(error.error || "Failed to fetch Azure repositories");
  }

  const data = await response.json();
  console.log("Received Azure repositories:", data);
  return data;
}

export async function getAzurePipelines(token: string, repositoryId: string): Promise<AzurePipeline[]> {
  const azureSessionToken = sessionStorage.getItem('azure_session_token');

  if (!azureSessionToken) {
    throw new Error("Azure session token is required");
  }

  const response = await fetch(`/api/azure/repositories/${repositoryId}/pipelines`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${azureSessionToken}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to fetch Azure pipelines");
  }

  return response.json();
}