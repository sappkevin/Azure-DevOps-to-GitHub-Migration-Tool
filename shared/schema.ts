import { pgTable, text, serial, integer, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Migration status types
export const migrationStatusEnum = z.enum([
  'pending',
  'in_progress',
  'completed',
  'failed',
  'cancelled'
]);

// Migration mode types
export const migrationModeSchema = z.enum(['individual', 'centralized']);
export type MigrationMode = z.infer<typeof migrationModeSchema>;

// Main migrations table
export const migrations = pgTable("migrations", {
  id: serial("id").primaryKey(),
  batchId: text("batch_id"),
  batchName: text("batch_name"),
  sourceRepo: text("source_repo").notNull(),
  targetRepo: text("target_repo").notNull(),
  status: text("status").notNull(),
  progress: integer("progress").notNull().default(0),
  error: text("error"),
  azureToken: text("azure_token").notNull(),
  githubToken: text("github_token").notNull(),
  pipelineConfig: jsonb("pipeline_config"),
  migrationMode: text("migration_mode").notNull().default('individual'),
  folderPath: text("folder_path"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  validationStatus: jsonb("validation_status"),
  retryCount: integer("retry_count").default(0),
  priority: integer("priority").default(1)
});

// Pipeline configuration schema
export const pipelineConfigSchema = z.object({
  convertClassicPipelines: z.boolean().default(true),
  migrateVariableGroups: z.boolean().default(true),
  migrateServiceConnections: z.boolean().default(true),
  migrateEnvironments: z.boolean().default(true),
  customMappings: z.record(z.string()).optional()
});

// Batch configuration schema
export const batchConfigSchema = z.object({
  name: z.string().min(1, "Batch name is required"),
  description: z.string().optional(),
  scheduledTime: z.string().optional(),
  concurrentLimit: z.number().min(1).max(10).default(3),
  timeoutMinutes: z.number().min(5).max(180).default(60)
});

// Enhanced migration insert schema
export const insertMigrationSchema = createInsertSchema(migrations)
  .omit({ 
    id: true, 
    progress: true,
    error: true,
    startedAt: true,
    completedAt: true,
    validationStatus: true,
    retryCount: true
  })
  .extend({
    pipelineConfig: pipelineConfigSchema.optional(),
    batchConfig: batchConfigSchema.optional()
  });

// Authentication schemas
export const azureAuthSchema = z.object({
  token: z.string().min(1, "Azure DevOps PAT token is required"),
  organization: z.string().min(1, "Organization name is required")
});

export const githubAuthSchema = z.object({
  token: z.string().min(1, "GitHub PAT token is required")
});

// Type exports
export type InsertMigration = z.infer<typeof insertMigrationSchema>;
export type Migration = typeof migrations.$inferSelect;
export type AzureAuth = z.infer<typeof azureAuthSchema>;
export type GitHubAuth = z.infer<typeof githubAuthSchema>;
export type PipelineConfig = z.infer<typeof pipelineConfigSchema>;
export type BatchConfig = z.infer<typeof batchConfigSchema>;
export type MigrationStatus = z.infer<typeof migrationStatusEnum>;