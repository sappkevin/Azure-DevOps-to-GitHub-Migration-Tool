import { migrations, type Migration, type InsertMigration, type MigrationStatus } from "@shared/schema";

export interface IStorage {
  createMigration(migration: InsertMigration): Promise<Migration>;
  getMigration(id: number): Promise<Migration | undefined>;
  updateMigrationProgress(id: number, progress: number): Promise<Migration>;
  updateMigrationError(id: number, error: string): Promise<Migration>;
  updateMigrationStatus(id: number, status: MigrationStatus): Promise<Migration>;
  getAllMigrations(): Promise<Migration[]>;
}

export class MemStorage implements IStorage {
  private migrations: Map<number, Migration>;
  private currentId: number;

  constructor() {
    this.migrations = new Map();
    this.currentId = 1;
  }

  async createMigration(insertMigration: InsertMigration): Promise<Migration> {
    const id = this.currentId++;
    const migration: Migration = {
      id,
      batchId: null,
      batchName: null,
      sourceRepo: insertMigration.sourceRepo,
      targetRepo: insertMigration.targetRepo,
      status: insertMigration.status,
      progress: 0,
      error: null,
      azureToken: insertMigration.azureToken,
      githubToken: insertMigration.githubToken,
      pipelineConfig: insertMigration.pipelineConfig || null,
      migrationMode: insertMigration.migrationMode || 'individual',
      folderPath: insertMigration.folderPath || null,
      startedAt: null,
      completedAt: null,
      validationStatus: null,
      retryCount: 0,
      priority: 1
    };
    this.migrations.set(id, migration);
    return migration;
  }

  async getMigration(id: number): Promise<Migration | undefined> {
    return this.migrations.get(id);
  }

  async updateMigrationStatus(id: number, status: MigrationStatus): Promise<Migration> {
    const migration = await this.getMigration(id);
    if (!migration) throw new Error("Migration not found");

    const updated: Migration = {
      ...migration,
      status,
      ...(status === "completed" ? { completedAt: new Date() } : {}),
      ...(status === "in_progress" && !migration.startedAt ? { startedAt: new Date() } : {})
    };
    this.migrations.set(id, updated);
    return updated;
  }

  async updateMigrationProgress(id: number, progress: number): Promise<Migration> {
    const migration = await this.getMigration(id);
    if (!migration) throw new Error("Migration not found");

    const updated = { ...migration, progress };
    this.migrations.set(id, updated);
    return updated;
  }

  async updateMigrationError(id: number, error: string): Promise<Migration> {
    const migration = await this.getMigration(id);
    if (!migration) throw new Error("Migration not found");

    const updated = { ...migration, error };
    this.migrations.set(id, updated);
    return updated;
  }

  async getAllMigrations(): Promise<Migration[]> {
    return Array.from(this.migrations.values());
  }
}

export const storage = new MemStorage();