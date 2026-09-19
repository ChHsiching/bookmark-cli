import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
async function execWithDefaults(command, args) {
    const { stdout } = await execFileAsync(command, args, {
        timeout: 5000,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
    });
    return { stdout };
}
export function createClipboardReader(deps = {}) {
    const platform = deps.platform ?? process.platform;
    const exec = deps.exec ?? execWithDefaults;
    return async () => {
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
            }
            catch {
                const { stdout } = await exec('xsel', ['--clipboard', '--output']);
                return stdout;
            }
        }
        catch {
            return '';
        }
    };
}
