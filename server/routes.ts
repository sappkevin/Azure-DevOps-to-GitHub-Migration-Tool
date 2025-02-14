import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertMigrationSchema, azureAuthSchema, githubAuthSchema } from "@shared/schema";
import axios from "axios";
import jwt from "jsonwebtoken";
import { encrypt, decrypt } from "./utils/crypto";
import { execSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const TOKEN_EXPIRY = '8h'; // 8 hours as per spec

async function sanitizeRepoName(repoName: string): Promise<string> {
  // Remove invalid characters and replace with dashes
  return repoName
    .toLowerCase()
    .replace(/[^a-z0-9-_.]/g, '-')
    .replace(/-+/g, '-') // Replace multiple consecutive dashes with a single dash
    .replace(/^-|-$/g, ''); // Remove leading/trailing dashes
}

async function migrateRepository(migration: any): Promise<void> {
  let tempDir = null;
  try {
    // Update status to in_progress
    await storage.updateMigrationStatus(migration.id, "in_progress");
    await storage.updateMigrationProgress(migration.id, 10);

    const azureToken = decrypt(migration.azureToken);
    const githubToken = decrypt(migration.githubToken);

    // Parse repository information
    const [owner, sourceRepo] = migration.sourceRepo.split('/').slice(-2);
    const sanitizedRepoName = await sanitizeRepoName(sourceRepo);

    console.log(`Starting migration for ${migration.sourceRepo} to ${migration.targetRepo}`);
    await storage.updateMigrationProgress(migration.id, 20);

    // Create temporary directory for cloning
    tempDir = mkdtempSync(join(tmpdir(), 'repo-migration-'));
    console.log('Created temporary directory:', tempDir);
    await storage.updateMigrationProgress(migration.id, 40);

    console.log('Cloning Azure repository...');
    const azureUrl = `https://:${azureToken}@dev.azure.com/${migration.sourceRepo.split('dev.azure.com/')[1]}`;
    execSync(`git clone --mirror "${azureUrl}" .`, { cwd: tempDir });

    // Create the repository if it doesn't exist
    try {
      const ownerAndRepo = migration.targetRepo.split('/');
      await axios.post(
        `https://api.github.com/user/repos`,
        {
          name: ownerAndRepo[1],
          private: false,
          auto_init: false
        },
        {
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: "application/vnd.github.v3+json",
            "Content-Type": "application/json"
          }
        }
      );
    } catch (error: any) {
      // Ignore error if repository already exists
      if (error.response?.status !== 422) {
        throw error;
      }
    }

    console.log('Setting up GitHub remote...');
    const githubUrl = `https://${githubToken}@github.com/${migration.targetRepo}.git`;
    execSync(`git remote set-url origin "${githubUrl}"`, { cwd: tempDir });

    console.log('Pushing to GitHub...');
    execSync('git push --mirror', { cwd: tempDir });

    await storage.updateMigrationProgress(migration.id, 90);

    // Mark migration as completed
    await storage.updateMigrationStatus(migration.id, "completed");
    await storage.updateMigrationProgress(migration.id, 100);

    console.log(`Migration completed for ${migration.sourceRepo}`);
  } catch (error: any) {
    console.error(`Migration failed for ${migration.sourceRepo}:`, error);
    const errorMessage = error.response?.data?.message || error.message || "Migration failed";
    await storage.updateMigrationStatus(migration.id, "failed");
    await storage.updateMigrationError(migration.id, errorMessage);
  } finally {
    // Cleanup temporary directory
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
        console.log('Cleaned up temporary directory');
      } catch (err) {
        console.error('Error cleaning up temporary directory:', err);
      }
    }
  }
}

// Middleware for Azure-only routes
const validateAzureToken = async (req: any, res: any, next: any) => {
  const azureSessionToken = req.headers.authorization?.split(" ")[1];

  if (!azureSessionToken) {
    return res.status(401).json({ error: "No Azure session token provided" });
  }

  try {
    const azureDecoded = jwt.verify(azureSessionToken, JWT_SECRET) as any;
    req.user = azureDecoded;
    next();
  } catch (error) {
    res.status(401).json({ error: "Invalid or expired Azure session token" });
  }
};

// Middleware for GitHub-only routes
const validateGitHubToken = async (req: any, res: any, next: any) => {
  const githubSessionToken = req.headers["x-github-token"];

  if (!githubSessionToken) {
    return res.status(401).json({ error: "No GitHub session token provided" });
  }

  try {
    const githubDecoded = jwt.verify(githubSessionToken, JWT_SECRET) as any;
    req.user = { githubToken: githubDecoded.token };
    next();
  } catch (error) {
    res.status(401).json({ error: "Invalid or expired GitHub session token" });
  }
};

// Middleware for routes requiring both tokens
const validateBothTokens = async (req: any, res: any, next: any) => {
  const azureSessionToken = req.headers.authorization?.split(" ")[1];
  const githubSessionToken = req.headers["x-github-token"];

  if (!azureSessionToken) {
    return res.status(401).json({ error: "No Azure session token provided" });
  }

  if (!githubSessionToken) {
    return res.status(401).json({ error: "No GitHub session token provided" });
  }

  try {
    const azureDecoded = jwt.verify(azureSessionToken, JWT_SECRET) as any;
    const githubDecoded = jwt.verify(githubSessionToken, JWT_SECRET) as any;

    req.user = {
      ...azureDecoded,
      githubToken: githubDecoded.token
    };
    next();
  } catch (error) {
    res.status(401).json({ error: "Invalid or expired session token" });
  }
};

// Token encryption middleware
const encryptToken = (req: any, res: any, next: any) => {
  if (req.body.token) {
    req.body.encryptedToken = encrypt(req.body.token);
    delete req.body.token;
  }
  next();
};


export function registerRoutes(app: Express): Server {
  // Azure routes
  app.get("/api/azure/repositories", validateAzureToken, async (req, res) => {
    try {
      const token = decrypt(req.user.token);
      const organization = req.user.organization;

      if (!token) {
        res.status(401).json({ error: "Azure token is required" });
        return;
      }

      if (!organization) {
        res.status(401).json({ error: "Azure organization is required" });
        return;
      }

      console.log("Fetching Azure projects...");
      const response = await axios.get(`https://dev.azure.com/${organization}/_apis/projects?api-version=7.0`, {
        headers: {
          Authorization: `Basic ${Buffer.from(`:${token}`).toString("base64")}`,
          Accept: "application/json",
        },
      });

      const projects = response.data.value;
      const repositories = [];

      console.log(`Found ${projects.length} Azure projects`);

      for (const project of projects) {
        console.log(`Fetching repositories for project: ${project.name}`);
        const reposResponse = await axios.get(
          `https://dev.azure.com/${organization}/${project.name}/_apis/git/repositories?api-version=7.0`,
          {
            headers: {
              Authorization: `Basic ${Buffer.from(`:${token}`).toString("base64")}`,
              Accept: "application/json",
            },
          }
        );

        repositories.push(...reposResponse.data.value);
      }

      console.log(`Total repositories found: ${repositories.length}`);
      res.json(repositories);
    } catch (error: any) {
      console.error("Azure API error:", error.response?.data || error.message);
      res.status(error.response?.status || 500).json({
        error: error.response?.data?.message || "Failed to fetch Azure repositories",
      });
    }
  });

  // GitHub routes
  app.get("/api/github/organizations", validateGitHubToken, async (req, res) => {
    try {
      const token = decrypt(req.user.githubToken);
      const response = await axios.get("https://api.github.com/user/orgs", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      res.json(response.data);
    } catch (error: any) {
      res.status(error.response?.status || 500).json({
        error: error.response?.data?.message || "Failed to fetch GitHub organizations",
      });
    }
  });

  // GitHub routes
  app.get("/api/github/organizations/:org/repositories", validateGitHubToken, async (req, res) => {
    try {
      const token = decrypt(req.user.githubToken);
      if (!token) {
        res.status(401).json({ error: "GitHub token is required" });
        return;
      }

      const { org } = req.params;
      const response = await axios.get(`https://api.github.com/orgs/${org}/repos`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      res.json(response.data);
    } catch (error: any) {
      res.status(error.response?.status || 500).json({
        error: error.response?.data?.message || "Failed to fetch GitHub repositories",
      });
    }
  });

  app.post("/api/github/organizations/:org/repositories", validateGitHubToken, async (req, res) => {
    try {
      const { name, private: isPrivate } = req.body;
      const token = decrypt(req.user.githubToken);
      const { org } = req.params;

      if (!token) {
        return res.status(401).json({ error: "GitHub token is required" });
      }

      if (!name) {
        return res.status(400).json({ error: "Repository name is required" });
      }

      try {
        const response = await axios.post(
          `https://api.github.com/orgs/${org}/repos`,
          {
            name,
            private: isPrivate || false,
            auto_init: true
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github.v3+json",
              "Content-Type": "application/json"
            }
          }
        );

        res.json(response.data);
      } catch (error) {
        console.error("GitHub API error:", error.response?.data || error.message);
        res.status(error.response?.status || 500).json({
          error: error.response?.data?.message || "Failed to create GitHub repository"
        });
      }
    } catch (error) {
      console.error("Server error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });


  // Migration routes requiring both tokens
  app.post("/api/migrations", validateBothTokens, async (req, res) => {
    try {
      const { sourceRepos, targetOrg } = req.body;
      const azureToken = decrypt(req.user.token);
      const githubToken = decrypt(req.user.githubToken);
      const organization = req.user.organization;

      if (!organization) {
        return res.status(400).json({ error: "Azure DevOps organization is required" });
      }

      // Create a migration for each selected repository
      const migrations = await Promise.all(
        sourceRepos.map(async (repoId: string) => {
          // Get repo details from Azure DevOps API using the organization from the session
          const repoDetailsUrl = `https://dev.azure.com/${organization}/_apis/git/repositories/${repoId}?api-version=7.0`;
          console.log("Fetching repo details from:", repoDetailsUrl);

          const repoResponse = await axios.get(repoDetailsUrl, {
            headers: {
              Authorization: `Basic ${Buffer.from(`:${azureToken}`).toString("base64")}`,
              Accept: "application/json"
            },
          });

          const sourceRepo = repoResponse.data;
          const targetRepo = `${targetOrg}/${sourceRepo.name}`;

          const migrationData = {
            sourceRepo: sourceRepo.remoteUrl,
            targetRepo,
            status: "pending",
            azureToken: req.user.token,
            githubToken: req.user.githubToken,
            pipelineConfig: {
              convertClassicPipelines: true,
              migrateVariableGroups: true,
              migrateServiceConnections: true,
              migrateEnvironments: true
            }
          };

          const migration = await storage.createMigration(migrationData);

          // Start migration process in background
          migrateRepository(migration).catch(console.error);

          return migration;
        })
      );

      res.json(migrations[0]);
    } catch (error: any) {
      console.error('Migration error:', error);
      res.status(400).json({
        error: error.response?.data?.message || error.message || "Failed to create migration"
      });
    }
  });

  // Other protected routes
  app.get("/api/migrations", validateBothTokens, async (req, res) => {
    const migrations = await storage.getAllMigrations();
    res.json(migrations);
  });

  app.get("/api/migrations/:id", validateBothTokens, async (req, res) => {
    const id = parseInt(req.params.id);
    const migration = await storage.getMigration(id);
    if (!migration) {
      res.status(404).json({ error: "Migration not found" });
      return;
    }
    res.json(migration);
  });

  app.post("/api/migrations/:id/progress", validateBothTokens, async (req, res) => {
    const id = parseInt(req.params.id);
    const { progress } = req.body;
    try {
      const migration = await storage.updateMigrationProgress(id, progress);
      res.json(migration);
    } catch (error) {
      res.status(404).json({ error: "Migration not found" });
    }
  });

  app.post("/api/migrations/:id/error", validateBothTokens, async (req, res) => {
    const id = parseInt(req.params.id);
    const { error } = req.body;
    try {
      const migration = await storage.updateMigrationError(id, error);
      res.json(migration);
    } catch (err) {
      res.status(404).json({ error: "Migration not found" });
    }
  });


  app.get("/api/github/user", validateGitHubToken, async (req, res) => {
    try {
      const token = decrypt(req.user.githubToken);
      if (!token) {
        return res.status(401).json({ error: "GitHub token is required" });
      }

      const response = await axios.get("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      res.json(response.data);
    } catch (error: any) {
      res.status(error.response?.status || 500).json({
        error: error.response?.data?.message || "Failed to fetch GitHub user info",
      });
    }
  });

  app.get("/api/github/user/repositories", validateGitHubToken, async (req, res) => {
    try {
      const token = decrypt(req.user.githubToken);
      if (!token) {
        return res.status(401).json({ error: "GitHub token is required" });
      }

      const response = await axios.get("https://api.github.com/user/repos", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      res.json(response.data);
    } catch (error: any) {
      res.status(error.response?.status || 500).json({
        error: error.response?.data?.message || "Failed to fetch GitHub repositories",
      });
    }
  });

  app.post("/api/github/user/repositories", validateGitHubToken, async (req, res) => {
    try {
      const { name, private: isPrivate } = req.body;
      const token = decrypt(req.user.githubToken);

      if (!token) {
        return res.status(401).json({ error: "GitHub token is required" });
      }

      if (!name) {
        return res.status(400).json({ error: "Repository name is required" });
      }

      try {
        const response = await axios.post(
          "https://api.github.com/user/repos",
          {
            name,
            private: isPrivate || false,
            auto_init: true
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github.v3+json",
              "Content-Type": "application/json"
            }
          }
        );

        res.json(response.data);
      } catch (error: any) {
        console.error("GitHub API error:", error.response?.data || error.message);
        res.status(error.response?.status || 500).json({
          error: error.response?.data?.message || "Failed to create GitHub repository"
        });
      }
    } catch (error) {
      console.error("Server error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Azure PAT validation endpoint
  app.post("/api/auth/azure/validate", encryptToken, async (req, res) => {
    try {
      const { encryptedToken, organization } = req.body;
      if (!encryptedToken || !organization) {
        return res.status(400).json({ error: "Token and organization name are required" });
      }

      const token = decrypt(encryptedToken);

      // Try to list Git repositories which matches the Code (read) scope
      try {
        const response = await axios({
          method: 'get',
          url: `https://dev.azure.com/${organization}/_apis/git/repositories?api-version=7.0`,
          headers: {
            'Authorization': `Basic ${Buffer.from(`:${token}`).toString('base64')}`,
            'Accept': 'application/json'
          },
          validateStatus: (status) => {
            return status === 200 || status === 203;
          }
        });

        if ((response.status === 200 || response.status === 203) && response.data) {
          // Create JWT session token
          const sessionToken = jwt.sign(
            {
              type: 'azure',
              token: encryptedToken,
              organization
            },
            JWT_SECRET,
            { expiresIn: TOKEN_EXPIRY }
          );
          return res.json({ valid: true, sessionToken });
        }
      } catch (error) {
        console.error("Azure token validation failed:", error.response?.status, error.response?.data);

        // Handle specific error cases
        if (error.response?.status === 401 || error.response?.status === 403) {
          return res.status(401).json({
            error: "Invalid Azure PAT token or insufficient permissions. Please ensure your token has Code (read), Build (read), and Release (read) scopes."
          });
        }

        if (error.response?.status === 404) {
          return res.status(401).json({
            error: "Could not access Git repositories. Please check if your organization name is correct."
          });
        }

        throw error;
      }

      return res.status(401).json({ error: "Could not validate Azure PAT token" });
    } catch (error: any) {
      console.error("Azure PAT validation error:", error.message);
      res.status(500).json({
        error: "Failed to validate Azure PAT. Please try again later."
      });
    }
  });

  // GitHub PAT validation
  app.post("/api/auth/github/validate", encryptToken, async (req, res) => {
    try {
      const { encryptedToken } = req.body;
      if (!encryptedToken) {
        return res.status(400).json({ error: "Token is required" });
      }

      const token = decrypt(encryptedToken);
      const response = await axios.get("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (response.status === 200) {
        // Create JWT session token
        const sessionToken = jwt.sign(
          {
            type: 'github',
            token: encryptedToken
          },
          JWT_SECRET,
          { expiresIn: TOKEN_EXPIRY }
        );
        return res.json({ valid: true, sessionToken });
      }

      res.status(401).json({ error: "Invalid GitHub PAT" });
    } catch (error: any) {
      console.error("GitHub PAT validation error:", error.response?.data || error.message);
      res.status(401).json({
        error: error.response?.data?.message || "Failed to validate GitHub PAT"
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}