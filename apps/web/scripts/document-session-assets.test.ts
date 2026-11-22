import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { documentSessionAssets } from './document-session-assets';

type BuildStart = (this: { emitFile: () => string }) => void;

function runBuildStart(directory: URL) {
  const emitFile = vi.fn(() => 'reference');
  const plugin = documentSessionAssets(directory);
  (plugin.buildStart as BuildStart).call({ emitFile });
  return emitFile;
}

describe('document session build assets', () => {
  it('leaves emission to the loader’s import.meta.url references', () => {
    const directory = mkdtempSync(join(tmpdir(), 'document-session-'));
    writeFileSync(join(directory, 'document_session_wasm.js'), '');
    writeFileSync(join(directory, 'document_session_wasm_bg.wasm'), '');

    const emitFile = runBuildStart(pathToFileURL(`${directory}/`));

    expect(emitFile).not.toHaveBeenCalled();
  });

  it('names the recipe when the package has not been built', () => {
    const directory = mkdtempSync(join(tmpdir(), 'document-session-'));

    expect(() => runBuildStart(pathToFileURL(`${directory}/`))).toThrow(
      /just build-document-session-wasm/
    );
  });
});
