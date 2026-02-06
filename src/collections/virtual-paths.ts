/**
 * Virtual Path Utilities for QMD Collections
 * Format: qmd://collection-name/relative/path/to/file.md
 */

import type { Collection } from './manager';

export const VIRTUAL_PATH_PROTOCOL = 'qmd://';

export interface ParsedVirtualPath {
  collection: string;
  path: string;
}

export function isVirtualPath(path: string): boolean {
  return path.startsWith(VIRTUAL_PATH_PROTOCOL);
}

/**
 * @example
 * parseVirtualPath("qmd://notes/folder/file.md") => { collection: "notes", path: "folder/file.md" }
 * parseVirtualPath("qmd://daily-notes/2024/01/note.md") => { collection: "daily-notes", path: "2024/01/note.md" }
 * parseVirtualPath("/regular/path/file.md") => null
 */
export function parseVirtualPath(virtualPath: string): ParsedVirtualPath | null {
  if (!isVirtualPath(virtualPath)) {
    return null;
  }

  const withoutProtocol = virtualPath.slice(VIRTUAL_PATH_PROTOCOL.length);
  
  if (!withoutProtocol) {
    return null;
  }

  const slashIndex = withoutProtocol.indexOf('/');
  
  if (slashIndex === -1) {
    const collection = withoutProtocol;
    if (!isValidCollectionName(collection)) {
      return null;
    }
    return { collection, path: '' };
  }

  const collection = withoutProtocol.slice(0, slashIndex);
  const path = withoutProtocol.slice(slashIndex + 1);

  if (!isValidCollectionName(collection)) {
    return null;
  }

  const normalizedPath = normalizePath(path);

  return { collection, path: normalizedPath };
}

/**
 * @example
 * buildVirtualPath("notes", "folder/file.md") => "qmd://notes/folder/file.md"
 * buildVirtualPath("notes", "") => "qmd://notes"
 */
export function buildVirtualPath(collection: string, path: string): string {
  if (!collection) {
    throw new Error('Collection name is required');
  }

  const normalizedPath = normalizePath(path);
  
  if (!normalizedPath) {
    return `${VIRTUAL_PATH_PROTOCOL}${collection}`;
  }

  return `${VIRTUAL_PATH_PROTOCOL}${collection}/${normalizedPath}`;
}

/**
 * @example
 * resolveVirtualPath("qmd://notes/todo.md", [{ name: "notes", path: "Documents/Notes" }])
 * => "Documents/Notes/todo.md"
 */
export function resolveVirtualPath(
  virtualPath: string,
  collections: Collection[]
): string | null {
  const parsed = parseVirtualPath(virtualPath);
  if (!parsed) {
    return null;
  }

  const collection = collections.find(c => c.name === parsed.collection);
  if (!collection) {
    return null;
  }

  if (!parsed.path) {
    return collection.path;
  }

  return joinPaths(collection.path, parsed.path);
}

/**
 * @example
 * toVirtualPath("Documents/Notes/todo.md", [{ name: "notes", path: "Documents/Notes" }])
 * => "qmd://notes/todo.md"
 */
export function toVirtualPath(
  realPath: string,
  collections: Collection[]
): string | null {
  const normalizedRealPath = normalizePath(realPath);
  let bestMatch: { collection: Collection; relativePath: string } | null = null;

  for (const collection of collections) {
    const normalizedCollectionPath = normalizePath(collection.path);
    
    if (normalizedRealPath === normalizedCollectionPath) {
      if (!bestMatch || normalizedCollectionPath.length > normalizePath(bestMatch.collection.path).length) {
        bestMatch = { collection, relativePath: '' };
      }
    } else if (normalizedRealPath.startsWith(normalizedCollectionPath + '/')) {
      const relativePath = normalizedRealPath.slice(normalizedCollectionPath.length + 1);
      if (!bestMatch || normalizedCollectionPath.length > normalizePath(bestMatch.collection.path).length) {
        bestMatch = { collection, relativePath };
      }
    }
  }

  if (!bestMatch) {
    return null;
  }

  return buildVirtualPath(bestMatch.collection.name, bestMatch.relativePath);
}

export function isPathInCollection(realPath: string, collection: Collection): boolean {
  const normalizedRealPath = normalizePath(realPath);
  const normalizedCollectionPath = normalizePath(collection.path);

  return normalizedRealPath === normalizedCollectionPath ||
         normalizedRealPath.startsWith(normalizedCollectionPath + '/');
}

export function getRelativePath(realPath: string, collection: Collection): string | null {
  const normalizedRealPath = normalizePath(realPath);
  const normalizedCollectionPath = normalizePath(collection.path);

  if (normalizedRealPath === normalizedCollectionPath) {
    return '';
  }

  if (normalizedRealPath.startsWith(normalizedCollectionPath + '/')) {
    return normalizedRealPath.slice(normalizedCollectionPath.length + 1);
  }

  return null;
}

/**
 * Kebab-case: lowercase letters/numbers/hyphens, starts with letter, max 64 chars
 * Pattern: /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
 */
export function isValidCollectionName(name: string): boolean {
  if (!name || name.length > 64) {
    return false;
  }

  const KEBAB_CASE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
  return KEBAB_CASE_PATTERN.test(name);
}

export function normalizePath(path: string): string {
  if (!path) {
    return '';
  }

  return path
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\//, '')
    .replace(/\/$/, '');
}

export function joinPaths(...segments: string[]): string {
  return segments
    .map(segment => normalizePath(segment))
    .filter(segment => segment.length > 0)
    .join('/');
}

export function extractCollectionName(virtualPath: string): string | null {
  if (!isVirtualPath(virtualPath)) {
    return null;
  }

  const withoutProtocol = virtualPath.slice(VIRTUAL_PATH_PROTOCOL.length);
  const slashIndex = withoutProtocol.indexOf('/');
  
  if (slashIndex === -1) {
    return withoutProtocol || null;
  }

  return withoutProtocol.slice(0, slashIndex) || null;
}
