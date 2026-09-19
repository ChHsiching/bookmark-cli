import { spawn } from 'node:child_process';

/**
 * Opens a URL with the OS-default handler (the browser, for http(s)).
 * Kept as an injectable function-shaped module so commands (and tests)
 * never have to launch a real browser: the fake opener in tests is just a
 * different implementation of this type.
 */
export type Opener = (url: string) => void | Promise<void>;

/**
 * Default cross-platform opener (spec: Windows `start` / macOS `open` /
 * Linux `xdg-open`, via child_process):
 * - `start` is a cmd.exe builtin, so it must go through `cmd /c`. It also
 *   treats the first quoted argument as a window title, which is why an
 *   empty "" title precedes the URL.
 * - Node quotes arguments on Windows, keeping cmd metacharacters (&, |, ^)
 *   in the URL inert; a literal double quote in a URL is percent-encoded
 *   first because it could otherwise escape that quoting.
 * The promise resolves once the handler process has been spawned — we do
 * not wait for the browser to exit — and rejects if it fails to spawn.
 */
export function defaultOpener(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      if (process.platform === 'win32') {
        child = spawn(
          'cmd',
          ['/c', 'start', '', url.replace(/"/g, '%22')],
          { stdio: 'ignore' },
        );
      } else if (process.platform === 'darwin') {
        child = spawn('open', [url], { stdio: 'ignore' });
      } else {
        child = spawn('xdg-open', [url], { stdio: 'ignore' });
      }
    } catch (err) {
      reject(err);
      return;
    }
    child.once('error', reject);
    child.once('spawn', () => resolve());
  });
}
