import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Store } from '../store.js';
import { CliError } from '../types.js';
import { toMarkdown, toNetscapeHtml, toJson } from '../exporter.js';
const FORMATS = ['md', 'html', 'json'];
function isExportFormat(value) {
    return FORMATS.includes(value);
}
const SERIALIZERS = {
    md: toMarkdown,
    html: toNetscapeHtml,
    json: toJson,
};
/**
 * `bm export [--format md|html|json] [-o <file>]`: default format md.
 * Default target is stdout (exactly the serialized document plus a final
 * newline, so it pipes cleanly); `-o <file>` writes UTF-8 with a trailing
 * newline and stays silent on success. An empty store exports a legal empty
 * document in every format, never an error.
 */
export async function runExport(opts, deps = {}) {
    const format = opts.format ?? 'md';
    if (!isExportFormat(format)) {
        throw new CliError(`Invalid format "${format}". Supported formats: ${FORMATS.join(', ')}.`);
    }
    const store = deps.store ?? Store.load();
    const content = SERIALIZERS[format](store.snapshot());
    if (opts.output === undefined) {
        console.log(content);
        return;
    }
    mkdirSync(dirname(opts.output), { recursive: true });
    writeFileSync(opts.output, `${content}\n`, 'utf8');
}
