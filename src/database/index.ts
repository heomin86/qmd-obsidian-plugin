export { 
  initDatabase, 
  loadDatabase,
  serializeDatabase,
  type Database,
  type DatabaseConfig,
  DatabaseInitError 
} from './db';

export { 
  SCHEMA_VERSION,
  SCHEMA_SQL,
  VEC0_TABLE_SQL,
  getSchemaVersion 
} from './schema';

export {
  DocumentIndexer,
  type IndexedDocument,
  type IndexingResult,
  type IndexingProgress,
  type ProgressCallback
} from './indexer';
