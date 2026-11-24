import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { IMPORT_CATEGORIES } from '../core/catalog';
import { createImportSources, createProviderFlags } from './provider-flags';

const fusionFlag = vi.hoisted(() => ({
  state: undefined as
    | undefined
    | (() => { enabled: boolean; loading: boolean; payload: undefined }),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: { key: string }) => () =>
    flag.key === 'enable-fusion-import' && fusionFlag.state
      ? fusionFlag.state()
      : { enabled: false, loading: false, payload: undefined },
}));

const files = IMPORT_CATEGORIES.files;
const fusion = files.providers.find((p) => p.appSlug === 'autodesk')!;
const notion = files.providers.find((p) => p.appSlug === 'notion')!;

describe('import provider flags', () => {
  it('hides Fusion while its flag loads or is off, and follows it on', () => {
    const [state, setState] = createSignal({
      enabled: false,
      loading: true,
      payload: undefined,
    });
    fusionFlag.state = state;
    createRoot((dispose) => {
      const shown = createProviderFlags();
      const importSource = createImportSources();
      expect(shown(fusion)).toBe(false);
      expect(importSource('autodesk')).toBeUndefined();
      expect(shown(notion)).toBe(true);

      setState({ enabled: false, loading: false, payload: undefined });
      expect(shown(fusion)).toBe(false);

      setState({ enabled: true, loading: false, payload: undefined });
      expect(shown(fusion)).toBe(true);
      expect(importSource('autodesk')?.provider.name).toBe('Autodesk Fusion');
      dispose();
    });
  });
});
