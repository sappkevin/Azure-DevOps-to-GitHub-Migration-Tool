import { azureAuthSchema, githubAuthSchema } from "@shared/schema";
import { useCallback } from "react";

// Azure DevOps OAuth configuration
const AZURE_CLIENT_ID = import.meta.env.VITE_AZURE_CLIENT_ID;
const GITHUB_CLIENT_ID = import.meta.env.VITE_GITHUB_CLIENT_ID;

export async function validateAzurePAT(token: string, organization: string) {
  console.log("Validating Azure PAT token...");
  try {
    const response = await fetch("/api/auth/azure/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, organization })
    });

    if (!response.ok) {
      const data = await response.json();
      console.error("Azure PAT validation failed:", data);
      throw new Error(data.error || "Failed to validate Azure PAT");
    }

    const data = await response.json();
    // Store session token
    if (data.sessionToken) {
      sessionStorage.setItem('azure_session_token', data.sessionToken);
    }

    console.log("Azure PAT validation successful");
    return azureAuthSchema.parse({ token, organization });
  } catch (error) {
    console.error("Error during Azure PAT validation:", error);
    throw error;
  }
}

export async function validateGitHubPAT(token: string) {
  console.log("Validating GitHub PAT token...");
  try {
    const response = await fetch("/api/auth/github/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });

    if (!response.ok) {
      const data = await response.json();
      console.error("GitHub PAT validation failed:", data);
      throw new Error(data.error || "Failed to validate GitHub PAT");
    }

    const data = await response.json();
    // Store session token
    if (data.sessionToken) {
      sessionStorage.setItem('github_session_token', data.sessionToken);
    }

    console.log("GitHub PAT validation successful");
    return githubAuthSchema.parse({ token });
  } catch (error) {
    console.error("Error during GitHub PAT validation:", error);
    throw error;
  }
}

// Hook for getting the current session tokens
export function useSessionTokens() {
  return useCallback(() => ({
    azure: sessionStorage.getItem('azure_session_token'),
    github: sessionStorage.getItem('github_session_token')
  }), []);
}

// Utility for adding session token to requests
export function getAuthHeaders(type: 'azure' | 'github' = 'azure') {
  const token = sessionStorage.getItem(`${type}_session_token`);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Function to check if session is expired
export function isSessionExpired(type: 'azure' | 'github'): boolean {
  const token = sessionStorage.getItem(`${type}_session_token`);
  if (!token) return true;

  try {
    const [, payload] = token.split('.');
    const decodedPayload = JSON.parse(atob(payload));
    return decodedPayload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}