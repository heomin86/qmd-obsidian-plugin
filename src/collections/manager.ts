import type { TFile, TFolder, Vault } from 'obsidian';
import { isValidCollectionName, normalizePath } from './virtual-paths';

export interface Collection {
  id: number;
  name: string;
  path: string;
  globPattern: string;
  createdAt: number;
  updatedAt: number;
}

type SqlValue = number | string | Uint8Array | null;

interface QueryExecResult {
  columns: string[];
  values: SqlValue[][];
}

interface Statement {
  bind(params?: SqlValue[] | Record<string, SqlValue> | null): boolean;
  step(): boolean;
  get(): SqlValue[];
  free(): boolean;
}

export interface Database {
  run(sql: string, params?: unknown[]): void;
  exec(sql: string): QueryExecResult[];
  prepare(sql: string): Statement;
}

export class CollectionError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_FOUND' | 'DUPLICATE' | 'INVALID_NAME' | 'INVALID_PATH' | 'INVALID_PATTERN'
  ) {
    super(message);
    this.name = 'CollectionError';
  }
}

export class CollectionManager {
  constructor(
    private db: Database,
    private vault: Vault
  ) {}

  async addCollection(
    name: string,
    path: string,
    globPattern = '**/*.md'
  ): Promise<Collection> {
    if (!isValidCollectionName(name)) {
      throw new CollectionError(
        `Invalid collection name: "${name}". Use kebab-case (lowercase letters, numbers, hyphens).`,
        'INVALID_NAME'
      );
    }

    const existing = await this.getCollection(name);
    if (existing) {
      throw new CollectionError(
        `Collection "${name}" already exists.`,
        'DUPLICATE'
      );
    }

    const normalizedPath = normalizePath(path);
    const pathExists = await this.vault.adapter.exists(normalizedPath);
    if (!pathExists) {
      throw new CollectionError(
        `Path "${normalizedPath}" does not exist in vault.`,
        'INVALID_PATH'
      );
    }

    if (!isValidGlobPattern(globPattern)) {
      throw new CollectionError(
        `Invalid glob pattern: "${globPattern}".`,
        'INVALID_PATTERN'
      );
    }

    const now = Date.now();
    
    this.db.run(
      `INSERT INTO collections (name, path, glob_pattern, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [name, normalizedPath, globPattern, now, now]
    );

    const result = this.db.exec('SELECT last_insert_rowid() as id');
    const id = result[0]?.values[0]?.[0] as number;

    return {
      id,
      name,
      path: normalizedPath,
      globPattern,
      createdAt: now,
      updatedAt: now,
    };
  }

  async removeCollection(name: string): Promise<void> {
    const collection = await this.getCollection(name);
    if (!collection) {
      throw new CollectionError(
        `Collection "${name}" not found.`,
        'NOT_FOUND'
      );
    }

    this.db.run('DELETE FROM embeddings WHERE document_id IN (SELECT id FROM documents WHERE collection_id = ?)', [collection.id]);
    this.db.run('DELETE FROM documents WHERE collection_id = ?', [collection.id]);
    this.db.run('DELETE FROM collections WHERE id = ?', [collection.id]);
  }

  async renameCollection(oldName: string, newName: string): Promise<void> {
    if (!isValidCollectionName(newName)) {
      throw new CollectionError(
        `Invalid collection name: "${newName}". Use kebab-case.`,
        'INVALID_NAME'
      );
    }

    const collection = await this.getCollection(oldName);
    if (!collection) {
      throw new CollectionError(
        `Collection "${oldName}" not found.`,
        'NOT_FOUND'
      );
    }

    const existingNew = await this.getCollection(newName);
    if (existingNew) {
      throw new CollectionError(
        `Collection "${newName}" already exists.`,
        'DUPLICATE'
      );
    }

    const now = Date.now();
    this.db.run(
      'UPDATE collections SET name = ?, updated_at = ? WHERE id = ?',
      [newName, now, collection.id]
    );
  }

  async listCollections(): Promise<Collection[]> {
    const result = this.db.exec(
      'SELECT id, name, path, glob_pattern, created_at, updated_at FROM collections ORDER BY name'
    );

    if (!result[0]) {
      return [];
    }

    return result[0].values.map((row: SqlValue[]) => ({
      id: row[0] as number,
      name: row[1] as string,
      path: row[2] as string,
      globPattern: row[3] as string,
      createdAt: row[4] as number,
      updatedAt: row[5] as number,
    }));
  }

  async getCollection(name: string): Promise<Collection | null> {
    const stmt = this.db.prepare(
      'SELECT id, name, path, glob_pattern, created_at, updated_at FROM collections WHERE name = ?'
    );
    
    try {
      stmt.bind([name]);
      
      if (!stmt.step()) {
        return null;
      }
      
      const row = stmt.get() as [number, string, string, string, number, number];
      
      return {
        id: row[0],
        name: row[1],
        path: row[2],
        globPattern: row[3],
        createdAt: row[4],
        updatedAt: row[5],
      };
    } finally {
      stmt.free();
    }
  }

  async updateCollection(
    name: string,
    updates: { path?: string; globPattern?: string }
  ): Promise<Collection> {
    const collection = await this.getCollection(name);
    if (!collection) {
      throw new CollectionError(
        `Collection "${name}" not found.`,
        'NOT_FOUND'
      );
    }

    if (updates.path !== undefined) {
      const normalizedPath = normalizePath(updates.path);
      const pathExists = await this.vault.adapter.exists(normalizedPath);
      if (!pathExists) {
        throw new CollectionError(
          `Path "${normalizedPath}" does not exist in vault.`,
          'INVALID_PATH'
        );
      }
      collection.path = normalizedPath;
    }

    if (updates.globPattern !== undefined) {
      if (!isValidGlobPattern(updates.globPattern)) {
        throw new CollectionError(
          `Invalid glob pattern: "${updates.globPattern}".`,
          'INVALID_PATTERN'
        );
      }
      collection.globPattern = updates.globPattern;
    }

    const now = Date.now();
    collection.updatedAt = now;

    this.db.run(
      'UPDATE collections SET path = ?, glob_pattern = ?, updated_at = ? WHERE id = ?',
      [collection.path, collection.globPattern, now, collection.id]
    );

    return collection;
  }

  async listFilesInCollection(collectionName: string): Promise<TFile[]> {
    const collection = await this.getCollection(collectionName);
    if (!collection) {
      throw new CollectionError(
        `Collection "${collectionName}" not found.`,
        'NOT_FOUND'
      );
    }

    const allFiles = this.vault.getMarkdownFiles();
    const collectionPathNormalized = normalizePath(collection.path);
    const matcher = createGlobMatcher(collection.globPattern);

    return allFiles.filter(file => {
      const filePath = normalizePath(file.path);
      
      if (filePath !== collectionPathNormalized && !filePath.startsWith(collectionPathNormalized + '/')) {
        return false;
      }

      const relativePath = filePath === collectionPathNormalized 
        ? '' 
        : filePath.slice(collectionPathNormalized.length + 1);

      return matcher(relativePath || file.name);
    });
  }

  async getCollectionFolder(collectionName: string): Promise<TFolder | null> {
    const collection = await this.getCollection(collectionName);
    if (!collection) {
      return null;
    }

    const abstractFile = this.vault.getAbstractFileByPath(collection.path);
    if (abstractFile && 'children' in abstractFile) {
      return abstractFile as TFolder;
    }
    
    return null;
  }

  async getCollectionStats(collectionName: string): Promise<{
    fileCount: number;
    totalSize: number;
  }> {
    const files = await this.listFilesInCollection(collectionName);
    
    let totalSize = 0;
    for (const file of files) {
      totalSize += file.stat.size;
    }

    return {
      fileCount: files.length,
      totalSize,
    };
  }
}

function isValidGlobPattern(pattern: string): boolean {
  if (!pattern || pattern.length > 256) {
    return false;
  }

  try {
    createGlobMatcher(pattern);
    return true;
  } catch {
    return false;
  }
}

function createGlobMatcher(pattern: string): (path: string) => boolean {
  const patterns = pattern.split(',').map(p => p.trim()).filter(Boolean);
  
  const matchers = patterns.map(p => {
    const isNegation = p.startsWith('!');
    const actualPattern = isNegation ? p.slice(1) : p;
    const regex = globToRegex(actualPattern);
    return { isNegation, regex };
  });

  return (path: string): boolean => {
    let matched = false;

    for (const { isNegation, regex } of matchers) {
      if (regex.test(path)) {
        matched = !isNegation;
      }
    }

    return matched;
  };
}

function globToRegex(glob: string): RegExp {
  let regex = '';
  let i = 0;

  while (i < glob.length) {
    const char = glob[i];
    const nextChar = glob[i + 1];

    if (char === '*' && nextChar === '*') {
      if (glob[i + 2] === '/') {
        regex += '(?:.*/)?';
        i += 3;
      } else {
        regex += '.*';
        i += 2;
      }
    } else if (char === '*') {
      regex += '[^/]*';
      i++;
    } else if (char === '?') {
      regex += '[^/]';
      i++;
    } else if (char === '[') {
      const closeBracket = glob.indexOf(']', i);
      if (closeBracket === -1) {
        regex += '\\[';
        i++;
      } else {
        const charClass = glob.slice(i, closeBracket + 1);
        regex += charClass;
        i = closeBracket + 1;
      }
    } else if (char === '{') {
      const closeBrace = glob.indexOf('}', i);
      if (closeBrace === -1) {
        regex += '\\{';
        i++;
      } else {
        const alternatives = glob.slice(i + 1, closeBrace).split(',');
        regex += '(?:' + alternatives.map(escapeRegex).join('|') + ')';
        i = closeBrace + 1;
      }
    } else if ('.+^$()[]{}|\\'.includes(char)) {
      regex += '\\' + char;
      i++;
    } else {
      regex += char;
      i++;
    }
  }

  return new RegExp('^' + regex + '$', 'i');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
