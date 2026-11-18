import { describe, expect, it } from 'vitest';
import { nativeEditorLeak } from '../vite.base';

const VIEW = '/repo/packages/lexical-wasm-view/src/view/editor-view.ts';
const ABI = '/repo/packages/collaboration/src/session/abi.generated.ts';
const ROOTS = '/repo/packages/lexical-wasm-view/src/view/editor-roots.ts';
const BOUNDARY =
  '/repo/apps/web/src/features/block-md/component/SessionMarkdownEditor.tsx';

const graph =
  (
    edges: Record<string, { static?: string[]; dynamic?: string[] }>
  ): Parameters<typeof nativeEditorLeak>[1] =>
  (id) => ({
    static: edges[id]?.static ?? [],
    dynamic: edges[id]?.dynamic ?? [],
  });

describe('nativeEditorLeak', () => {
  it('reports the static chain from an entry through a lazy chunk to native code', () => {
    expect(
      nativeEditorLeak(
        ['/repo/index.html'],
        graph({
          '/repo/index.html': { dynamic: ['/repo/DriveDetailView.tsx'] },
          '/repo/DriveDetailView.tsx': { static: ['/repo/pins.ts'] },
          '/repo/pins.ts': { static: ['/repo/command.ts'] },
          '/repo/command.ts': { static: [ABI] },
        })
      )
    ).toEqual([
      '/repo/index.html',
      '/repo/DriveDetailView.tsx',
      '/repo/pins.ts',
      '/repo/command.ts',
      ABI,
    ]);
  });

  it('allows native code behind the boundary, including its own lazy imports', () => {
    expect(
      nativeEditorLeak(
        ['/repo/index.html'],
        graph({
          '/repo/index.html': { dynamic: [BOUNDARY] },
          [BOUNDARY]: { static: [VIEW], dynamic: ['/repo/native-helper.ts'] },
          '/repo/native-helper.ts': { static: [ABI] },
        })
      )
    ).toBeUndefined();
  });

  it('allows a dynamic import of native code and the shared root registry', () => {
    expect(
      nativeEditorLeak(
        ['/repo/index.html'],
        graph({
          '/repo/index.html': { static: ['/repo/wrapper.tsx'], dynamic: [VIEW] },
          '/repo/wrapper.tsx': { static: [ROOTS] },
        })
      )
    ).toBeUndefined();
  });

  it('still reports native code the shared registry is not', () => {
    expect(
      nativeEditorLeak(['/repo/index.html'], graph({ '/repo/index.html': { static: [VIEW] } }))
    ).toEqual(['/repo/index.html', VIEW]);
  });
});
