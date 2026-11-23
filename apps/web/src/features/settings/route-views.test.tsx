import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { SettingsRouteView } from './route-views';

const setDisplayName = vi.hoisted(() => vi.fn());

vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({ handle: { setDisplayName } }),
}));
vi.mock('./Settings', () => ({ SettingsPanelComponentWrapper: () => null }));

afterEach(cleanup);

// The window title is built from the active split's display name.
it('names its split Settings so the window title names the view', () => {
  render(() => <SettingsRouteView />);
  expect(setDisplayName).toHaveBeenCalledExactlyOnceWith('Settings');
});
