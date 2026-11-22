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
}));
vi.mock('../plugins/tables/nativeKeys', () => ({
  registerNativeTableKeys: (view: unknown) => {
    control.keys(view);
    return control.releaseKeys;
  },
}));

beforeAll(initializeNativeSurfaceTests);

test('the body installs table arrow keys until disposed', () => {
  const fixture = nativeSurface();
  fixture.port.setState(JSON.stringify(tableSelection));
  const installation = installNativeMarkdownOverlays(fixture.view, {
    canEdit: () => true,
  });
  try {
    expect(control.keys).toHaveBeenCalledExactlyOnceWith(fixture.view);
    expect(control.releaseKeys).not.toHaveBeenCalled();
    installation.dispose();
    expect(control.releaseKeys).toHaveBeenCalledOnce();
  } finally {
    installation.dispose();
    fixture.close();
  }
});
