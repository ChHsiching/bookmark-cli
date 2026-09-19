/**
 * Domain types shared across the bookmark-cli codebase.
 * Terminology follows CONTEXT.md: Bookmark (URL is identity), Tag (the only
 * organizing means), Note (user-written), Title (auto-fetched, user-overridable).
 */

/** A saved web reference, uniquely identified by its URL. */
export interface Bookmark {
  /** Auto-incrementing id. Monotonic, never reused (gaps are permanent). */
  id: number;
  /** Identity of the bookmark: a given URL exists at most once in the store. */
  url: string;
  title: string;
  tags: string[];
  note: string;
  /** ISO 8601 UTC timestamp, e.g. "2026-09-19T12:34:56.789Z". */
  created_at: string;
  /** ISO 8601 UTC timestamp, refreshed on every mutation. */
  updated_at: string;
}

/**
 * On-disk shape of the single JSON store file. The counter is persisted so
 * deleted ids are never handed out again.
 */
export interface StoreData {
  bookmarks: Bookmark[];
  /** Next id to hand out; only ever increases. */
  nextId: number;
}

/** User-facing error: message goes to stderr and the process exits with 1. */
export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}

/** Options for the `add` command (as declared on the commander program). */
export interface AddOptions {
  title?: string;
  /** Comma-separated tag list, e.g. "demo,a". */
  tags?: string;
  note?: string;
  force?: boolean;
}

/** Options for the `list` command. */
export interface ListOptions {
  tag?: string;
  json?: boolean;
}

/** Options for the `search` command. */
export interface SearchOptions {
  json?: boolean;
  open?: boolean;
}

/** Options for the `edit` command. */
export interface EditOptions {
  title?: string;
  note?: string;
  /** Comma-separated list that replaces the bookmark's tags entirely. */
  tags?: string;
}

/** Options for the `rm` command. */
export interface RmOptions {
  /** Skip the y/n confirmation prompt. */
  yes?: boolean;
}
