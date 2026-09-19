import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, emptyStore } from '../src/store.js';
import { CliError } from '../src/types.js';
import { ExecFileLike, createClipboardReader } from '../src/clipboard.js';
import { runAdd } from '../src/commands/add.js';
import { buildProgram } from '../src/cli.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bm-clip-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const fakeClipboard = (text: string) => async (): Promise<string> => text;
const explodingClipboard = async (): Promise<string> => {
  throw new Error('clipboard tool missing');
};
const storeAt = () => new Store(join(dir, 'bookmarks.json'), emptyStore());

describe('createClipboardReader (injected exec — no real OS clipboard)', () => {
  it('windows: reads via powershell.exe Get-Clipboard', async () => {
    const calls: Array<[string, string[]]> = [];
    const exec: ExecFileLike = async (command, args) => {
      calls.push([command, args]);
      return { stdout: 'https://win.dev/from-clipboard\r\n' };
    };
    const reader = createClipboardReader({ platform: 'win32', exec });
    expect(await reader()).toBe('https://win.dev/from-clipboard\r\n');
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('powershell.exe');
    expect(calls[0][1].join(' ')).toContain('Get-Clipboard');
  });

  it('macOS: reads via pbpaste', async () => {
    const exec: ExecFileLike = async () => ({ stdout: 'https://mac.dev/x' });
    const reader = createClipboardReader({ platform: 'darwin', exec });
    expect(await reader()).toBe('https://mac.dev/x');
  });

  it('linux: prefers xclip and falls back to xsel when xclip is unavailable', async () => {
    const calls: string[] = [];
    const xclipOnly: ExecFileLike = async (command) => {
      calls.push(command);
      if (command === 'xclip') throw new Error('ENOENT');
      return { stdout: 'https://linux.dev/x' };
    };
    expect(
      await createClipboardReader({ platform: 'linux', exec: xclipOnly })(),
    ).toBe('https://linux.dev/x');
    expect(calls).toEqual(['xclip', 'xsel']);

    const bothWork: ExecFileLike = async (command) => {
      calls.push(command);
      return { stdout: command === 'xclip' ? 'https://xclip.dev/x' : 'should-not-happen' };
    };
    expect(
      await createClipboardReader({ platform: 'linux', exec: bothWork })(),
    ).toBe('https://xclip.dev/x');
  });

  it('resolves to empty string (never throws) when every tool fails', async () => {
    const noneWork: ExecFileLike = async () => {
      throw new Error('ENOENT');
    };
    expect(
      await createClipboardReader({ platform: 'linux', exec: noneWork })(),
    ).toBe('');
    expect(
      await createClipboardReader({ platform: 'win32', exec: noneWork })(),
    ).toBe('');
  });
});

describe('bm add with no URL argument (injected fake clipboard)', () => {
  it('adds the clipboard URL to the store, fetching its title', async () => {
    const store = storeAt();
    await runAdd(
      undefined,
      { tags: 'from-clipboard' },
      {
        store,
        readClipboard: fakeClipboard('https://clip.dev/page'),
        fetchTitle: async () => 'Clipped Page Title',
      },
    );
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0]).toMatchObject({
      id: 1,
      url: 'https://clip.dev/page',
      title: 'Clipped Page Title',
      tags: ['from-clipboard'],
    });
  });

  it('tolerates surrounding whitespace and newlines around the copied URL', async () => {
    const store = storeAt();
    await runAdd(
      undefined,
      {},
      { store, readClipboard: fakeClipboard('  https://clip.dev/page\r\n') },
    );
    expect(store.all()[0].url).toBe('https://clip.dev/page');
    // No fetcher injected: title falls back to the host.
    expect(store.all()[0].title).toBe('clip.dev');
  });

  it('errors when the clipboard holds non-URL text', async () => {
    const store = storeAt();
    await expect(
      runAdd(undefined, {}, { store, readClipboard: fakeClipboard('hello world') }),
    ).rejects.toThrow(CliError);
    await expect(
      runAdd(undefined, {}, { store, readClipboard: fakeClipboard('hello world') }),
    ).rejects.toThrow(/Clipboard does not contain a valid http\(s\) URL/);
    expect(store.all()).toHaveLength(0);
  });

  it('errors when the clipboard holds a non-http(s) URL', async () => {
    const store = storeAt();
    await expect(
      runAdd(undefined, {}, { store, readClipboard: fakeClipboard('ftp://files.dev/doc') }),
    ).rejects.toThrow(/Clipboard does not contain a valid http\(s\) URL/);
    expect(store.all()).toHaveLength(0);
  });

  it('errors when the clipboard is empty', async () => {
    const store = storeAt();
    await expect(
      runAdd(undefined, {}, { store, readClipboard: fakeClipboard('   ') }),
    ).rejects.toThrow(/Clipboard is empty or unreadable/);
    expect(store.all()).toHaveLength(0);
  });

  it('errors when the clipboard reader itself fails', async () => {
    const store = storeAt();
    await expect(
      runAdd(undefined, {}, { store, readClipboard: explodingClipboard }),
    ).rejects.toThrow(/Clipboard is empty or unreadable/);
    expect(store.all()).toHaveLength(0);
  });
});

describe('commander wiring for add (buildProgram with injected deps)', () => {
  it('bm add with no arguments routes through the clipboard dependency', async () => {
    const store = storeAt();
    await buildProgram({
      add: {
        store,
        readClipboard: fakeClipboard('https://wired.dev/a'),
        fetchTitle: async () => 'Wired Title',
      },
    }).parseAsync(['add'], { from: 'user' });
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0]).toMatchObject({
      url: 'https://wired.dev/a',
      title: 'Wired Title',
    });
  });

  it('bm add <url> --title flows through the wiring', async () => {
    const store = storeAt();
    await buildProgram({
      add: { store, readClipboard: fakeClipboard('https://ignored.dev/x') },
    }).parseAsync(['add', 'https://arg.dev/x', '--title', 'Arg Title'], { from: 'user' });
    expect(store.all()[0]).toMatchObject({
      url: 'https://arg.dev/x',
      title: 'Arg Title',
    });
  });

  it('bm add with no argument and no clipboard dependency errors cleanly', async () => {
    const store = storeAt();
    await expect(
      buildProgram({ add: { store } }).parseAsync(['add'], { from: 'user' }),
    ).rejects.toThrow(/No URL given/);
    expect(store.all()).toHaveLength(0);
  });
});
