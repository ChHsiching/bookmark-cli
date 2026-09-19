/**
 * Domain types shared across the bookmark-cli codebase.
 * Terminology follows CONTEXT.md: Bookmark (URL is identity), Tag (the only
 * organizing means), Note (user-written), Title (auto-fetched, user-overridable).
 */
/** User-facing error: message goes to stderr and the process exits with 1. */
export class CliError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CliError';
    }
}
