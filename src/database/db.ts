import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { SCHEMA_SQL, VEC0_TABLE_SQL, SCHEMA_VERSION } from './schema';
// @ts-ignore - esbuild will bundle this as a file
import wasmBinary from 'sql.js/dist/sql-wasm.wasm';

type SqlValue = number | string | Uint8Array | null;

interface QueryExecResult {
  columns: string[];
  values: SqlValue[][];
}

interface Statement {
  bind(params?: SqlValue[] | Record<string, SqlValue> | null): boolean;
  step(): boolean;
  get(): SqlValue[];
  getAsObject(): Record<string, SqlValue>;
  free(): boolean;
}

export interface Database {
  run(sql: string, params?: unknown[]): void;
  exec(sql: string): QueryExecResult[];
  prepare(sql: string): Statement;
  close(): void;
  export(): Uint8Array;
}

class DatabaseWrapper implements Database {
  constructor(private db: SqlJsDatabase) {}

  run(sql: string, params?: unknown[]): void {
    this.db.run(sql, params as SqlValue[]);
  }

  exec(sql: string): QueryExecResult[] {
    return this.db.exec(sql);
  }

  prepare(sql: string): Statement {
    return this.db.prepare(sql);
  }

  close(): void {
    this.db.close();
  }

  export(): Uint8Array {
    return this.db.export();
  }
}

export class DatabaseInitError extends Error {
  constructor(
    message: string,
    public readonly code: 
      | 'SQLJS_LOAD_FAILED'
      | 'VEC_EXTENSION_MISSING'
      | 'SCHEMA_CREATION_FAILED'
      | 'MIGRATION_FAILED'
  ) {
    super(message);
    this.name = 'DatabaseInitError';
  }
}

export interface DatabaseConfig {
  wasmUrl?: string;
  enableVectorSearch?: boolean;
  existingData?: Uint8Array;
}

export async function initDatabase(config: DatabaseConfig = {}): Promise<Database> {
  const {
    wasmUrl,
    enableVectorSearch = false,
    existingData
  } = config;

  try {
    const SQL = await initSqlJs({
      locateFile: (file) => {
        // Use explicit wasmUrl if provided, otherwise use bundled WASM
        if (wasmUrl) return wasmUrl;
        // esbuild will replace this import with the actual path
        return wasmBinary;
      }
    });
    
    const db = existingData 
      ? new SQL.Database(existingData)
      : new SQL.Database();

    if (!existingData) {
      await applySchema(db, enableVectorSearch);
    } else {
      await migrateIfNeeded(db, enableVectorSearch);
    }

    return new DatabaseWrapper(db);

  } catch (error) {
    throw new DatabaseInitError(
      `Failed to initialize database: ${error instanceof Error ? error.message : String(error)}`,
      'SQLJS_LOAD_FAILED'
    );
  }
}

async function applySchema(db: SqlJsDatabase, enableVectorSearch: boolean): Promise<void> {
  try {
    db.run('BEGIN TRANSACTION');
    
    db.exec(SCHEMA_SQL);
    
    if (enableVectorSearch) {
      try {
        db.exec(VEC0_TABLE_SQL);
      } catch (vecError) {
        console.warn('Vector search table creation failed (sqlite-vec extension not available):', vecError);
      }
    }
    
    db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [
      SCHEMA_VERSION,
      Date.now()
    ]);
    
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw new DatabaseInitError(
      `Failed to create schema: ${error instanceof Error ? error.message : String(error)}`,
      'SCHEMA_CREATION_FAILED'
    );
  }
}

async function migrateIfNeeded(db: SqlJsDatabase, enableVectorSearch: boolean): Promise<void> {
  try {
    const result = db.exec('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1');
    
    if (result.length === 0 || !result[0].values.length) {
      await applySchema(db, enableVectorSearch);
      return;
    }

    const currentVersion = result[0].values[0][0] as number;
    
    if (currentVersion < SCHEMA_VERSION) {
      console.log(`Migrating database from version ${currentVersion} to ${SCHEMA_VERSION}`);
    }

  } catch (error) {
    if ((error as Error).message.includes('no such table: schema_migrations')) {
      await applySchema(db, enableVectorSearch);
    } else {
      throw new DatabaseInitError(
        `Migration failed: ${error instanceof Error ? error.message : String(error)}`,
        'MIGRATION_FAILED'
      );
    }
  }
}

export async function loadDatabase(data: Uint8Array, config: DatabaseConfig = {}): Promise<Database> {
  return initDatabase({ ...config, existingData: data });
}

export function serializeDatabase(db: Database): Uint8Array {
  return db.export();
}
