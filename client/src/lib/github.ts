import { apiRequest } from "./queryClient";
import { getAuthHeaders } from "./auth";

export interface GitHubOrganization {
  id: string;
  login: string;
}

export interface GitHubUser {
  id: string;
  login: string;
}

export interface GitHubRepository {
  id: string;
  name: string;
  private: boolean;
  html_url: string;
}

export async function getCurrentUser(token: string): Promise<GitHubUser> {
  console.log("Fetching GitHub user info...");
  const githubSessionToken = sessionStorage.getItem('github_session_token');

  if (!githubSessionToken) {
    throw new Error("GitHub session token is required");
  }

  const response = await fetch("/api/github/user", {
    headers: {
      "X-GitHub-Token": githubSessionToken,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
  });

  if (!response.ok) {
    const error = await response.json();
    console.error("GitHub user info error:", error);
    throw new Error(error.error || "Failed to fetch GitHub user info");
  }

  const data = await response.json();
  console.log("Received GitHub user info:", data);
  return data;
}

export async function getGitHubOrganizations(token: string): Promise<GitHubOrganization[]> {
  console.log("Fetching GitHub organizations...");
  const githubSessionToken = sessionStorage.getItem('github_session_token');

  if (!githubSessionToken) {
    throw new Error("GitHub session token is required");
  }

  const response = await fetch("/api/github/organizations", {
    headers: {
      "X-GitHub-Token": githubSessionToken,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
  });

  if (!response.ok) {
    const error = await response.json();
    console.error("GitHub organizations error:", error);
    throw new Error(error.error || "Failed to fetch GitHub organizations");
  }

  const data = await response.json();
  console.log("Received GitHub organizations:", data);
  return data;
}

export async function getGitHubRepositories(token: string, owner: string, isOrg: boolean = true): Promise<GitHubRepository[]> {
  console.log(`Fetching GitHub repositories for ${isOrg ? 'org' : 'user'}: ${owner}`);
  const githubSessionToken = sessionStorage.getItem('github_session_token');

  if (!githubSessionToken) {
    throw new Error("GitHub session token is required");
  }

  const endpoint = isOrg ? `/api/github/organizations/${owner}/repositories` : `/api/github/user/repositories`;

  const response = await fetch(endpoint, {
    headers: {
      "X-GitHub-Token": githubSessionToken,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
  });

  if (!response.ok) {
    const error = await response.json();
    console.error("GitHub repositories error:", error);
    throw new Error(error.error || "Failed to fetch GitHub repositories");
  }

  const data = await response.json();
  console.log("Received GitHub repositories:", data);
  return data;
}

function sanitizeRepoName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-_.]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function createGitHubRepository(
  token: string,
  owner: string,
  name: string,
  isPrivate: boolean,
  isOrg: boolean = true
): Promise<GitHubRepository> {
  const githubSessionToken = sessionStorage.getItem('github_session_token');

  if (!githubSessionToken) {
    throw new Error("GitHub session token is required");
  }

  const sanitizedName = sanitizeRepoName(name);
  console.log(`Creating GitHub repository: ${sanitizedName} for ${isOrg ? 'org' : 'user'}: ${owner}`);
  const endpoint = isOrg ? `/api/github/organizations/${owner}/repositories` : `/api/github/user/repositories`;
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "X-GitHub-Token": githubSessionToken,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          name: sanitizedName,
          private: isPrivate,
          auto_init: true,
          description: "Repository migrated from Azure DevOps"
        }),
        signal: AbortSignal.timeout(30000)
      });

      if (!response.ok) {
        let errorMessage;
        try {
          const errorData = await response.json();
          if (response.status === 422 && errorData.message?.includes('already exists')) {
            console.log('Repository already exists, fetching existing repository');
            const existingRepo = await fetch(
              `/api/github/${isOrg ? `organizations/${owner}` : 'user'}/repositories/${sanitizedName}`,
              {
                headers: {
                  "X-GitHub-Token": githubSessionToken,
                  Accept: "application/json"
                }
              }
            );
            if (existingRepo.ok) {
              return await existingRepo.json();
            }
          }
          errorMessage = errorData.error || errorData.message || `Failed to create repository (HTTP ${response.status})`;
        } catch (e) {
          errorMessage = `Failed to create repository: ${response.statusText}`;
        }

        if (response.status === 502 || response.status === 503 || response.status === 504) {
          console.warn(`Attempt ${attempt} failed with server error, retrying...`);
          lastError = new Error(errorMessage);
          if (attempt === maxRetries) throw lastError;
          await new Promise(resolve => setTimeout(resolve, attempt * 1000));
          continue;
        }

        throw new Error(errorMessage);
      }

      try {
        const data = await response.json();
        console.log("Created GitHub repository:", data);
        return data;
      } catch (error) {
        console.error("Error parsing GitHub response:", error);
        throw new Error("Invalid response from GitHub API");
      }
    } catch (error: any) {
      if (error.name === 'TimeoutError') {
        console.error("Request timed out, retrying...");
        lastError = new Error("Request timed out while creating repository");
        if (attempt === maxRetries) throw lastError;
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error("Failed to create repository after retries");
}