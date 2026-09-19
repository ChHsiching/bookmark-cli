import { CliError } from '../types.js';

/**
 * Parse a bookmark id given as a CLI argument. Ids are positive integers in
 * plain decimal notation; anything else is a user error (stderr, exit code 1).
 */
export function parseId(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new CliError(`Invalid id: "${raw}" (expected a positive integer).`);
  }
  const id = Number.parseInt(raw, 10);
  if (id < 1) {
    throw new CliError(`Invalid id: "${raw}" (expected a positive integer).`);
  }
  return id;
}
