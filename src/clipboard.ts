import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * Cross-platform clipboard reading, injectable so `bm add` (no argument)
 * tests never touch the real OS clipboard.
 *
 * Platform strategy:
 * - Windows: powershell.exe Get-Clipboard
 * - macOS:   pbpaste
 * - Linux:   xclip, then xsel as fallback
 *
 * Contract: resolve to the clipboard text, or to '' when the clipboard is
 * unreadable (no tool installed, tool failure, timeout). It never throws;
 * the caller reports an empty/unreadable clipboard as a user-facing error.
 */

/** Read the system clipboard. Returns '' when unavailable. */
export type ClipboardReader = () => Promise<string>;

/** Injectable process-execution seam (promisified execFile subset). */
export type ExecFileLike = (
  command: string,
  args: string[],
) => Promise<{ stdout: string }>;

export interface ClipboardDeps {
  platform?: NodeJS.Platform;
  exec?: ExecFileLike;
}

const execFileAsync = promisify(execFile);

async function execWithDefaults(command: string, args: string[]): Promise<{ stdout: string }> {
  const { stdout } = await execFileAsync(command, args, {
    timeout: 5000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return { stdout };
}

export function createClipboardReader(deps: ClipboardDeps = {}): ClipboardReader {
  const platform = deps.platform ?? process.platform;
  const exec = deps.exec ?? execWithDefaults;
  return async (): Promise<string> => {
    try {
      if (platform === 'win32') {
        // -NoProfile keeps profile output from polluting stdout;
        // -NonInteractive guards against prompts hanging the read.
        const { stdout } = await exec('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-command',
          'Get-Clipboard',
        ]);
        return stdout;
      }
      if (platform === 'darwin') {
        const { stdout } = await exec('pbpaste', []);
        return stdout;
      }
      // Linux and everything else: xclip first, xsel as fallback.
      try {
        const { stdout } = await exec('xclip', ['-o', '-selection', 'clipboard']);
        return stdout;
      } catch {
        const { stdout } = await exec('xsel', ['--clipboard', '--output']);
        return stdout;
      }
    } catch {
      return '';
    }
  };
}
