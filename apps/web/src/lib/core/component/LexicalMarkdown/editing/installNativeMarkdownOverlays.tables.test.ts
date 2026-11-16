import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { beforeAll, expect, test, vi } from 'vitest';
import tableSelection from './browser-test/fixtures/table-selection.json';
import { installNativeMarkdownOverlays } from './installNativeMarkdownOverlays';

const control = vi.hoisted(() => ({
  keys: vi.fn(),
  releaseKeys: vi.fn(),
  resize: vi.fn(),
  releaseResize: vi.fn(),
}));
vi.mock('../plugins/tables/nativeKeys', () => ({
  registerNativeTableKeys: (view: unknown) => {
    control.keys(view);
    return control.releaseKeys;
  },
}));
vi.mock('../plugins/tables/nativeResizeEdges', () => ({
  registerNativeTableResizeEdges: (view: unknown) => {
    control.resize(view);
    return control.releaseResize;
  },
}));

beforeAll(initializeNativeSurfaceTests);

test('the body installs table arrow keys and column/row resize edges until disposed', () => {
  const fixture = nativeSurface();
  fixture.port.setState(JSON.stringify(tableSelection));
  const installation = installNativeMarkdownOverlays(fixture.view, {
    canEdit: () => true,
  });
  try {
    expect(control.keys).toHaveBeenCalledExactlyOnceWith(fixture.view);
    expect(control.resize).toHaveBeenCalledExactlyOnceWith(fixture.view);
    expect(control.releaseKeys).not.toHaveBeenCalled();
    expect(control.releaseResize).not.toHaveBeenCalled();
    installation.dispose();
    expect(control.releaseKeys).toHaveBeenCalledOnce();
    expect(control.releaseResize).toHaveBeenCalledOnce();
  } finally {
    installation.dispose();
    fixture.close();
  }
});
