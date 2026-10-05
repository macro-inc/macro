import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mode: 'system',
  system: 'dark',
  id: 'new-theme',
  themes: [] as { id: string }[],
  apply: vi.fn(),
  save: vi.fn(),
  update: vi.fn(),
  token: vi.fn(),
  light: vi.fn(),
  dark: vi.fn(),
}));
vi.mock('@theme/constants', () => ({
  DEFAULT_DARK_THEME: 'Macro Dark',
  DEFAULT_LIGHT_THEME: 'Macro Light',
}));
vi.mock('@theme/signals/themeSignals', () => ({
  currentThemeId: () => mocks.id,
  themeMode: () => mocks.mode,
  systemMode: () => mocks.system,
  userThemes: () => mocks.themes,
  setDarkModeTheme: mocks.dark,
  setLightModeTheme: mocks.light,
}));
vi.mock('@theme/utils/themeUtils', () => ({
  applyTheme: mocks.apply,
  saveTheme: mocks.save,
  updateTheme: mocks.update,
  updateLiveThemeColorToken: mocks.token,
}));

import { applyWorkspaceAccent } from './apply-workspace-accent';

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mocks.mode = 'system';
  mocks.system = 'dark';
  mocks.themes = [];
});
describe('workspace palette', () => {
  it.each(['light', 'dark'])(
    'forks the default %s theme and pins the chosen accent',
    (mode) => {
      mocks.system = mode;
      applyWorkspaceAccent('#65d8ac', 'person');
      expect(mocks.apply).toHaveBeenNthCalledWith(
        1,
        `Macro ${mode === 'dark' ? 'Dark' : 'Light'}`
      );
      expect(mocks.token).toHaveBeenCalledWith('accent', '#65d8ac');
      expect(mocks.save).toHaveBeenCalledOnce();
      expect(mode === 'dark' ? mocks.dark : mocks.light).toHaveBeenCalledWith(
        'new-theme'
      );
      expect(mocks.apply).toHaveBeenLastCalledWith('new-theme');
    }
  );
  it('updates the same fork on back/forward instead of accumulating themes', () => {
    mocks.themes = [{ id: 'new-theme' }];
    sessionStorage.setItem('onboarding-theme:person:dark', 'new-theme');
    applyWorkspaceAccent('#f77d67', 'person');
    expect(mocks.update).toHaveBeenCalledWith('new-theme', 'My workspace dark');
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('does not reuse a different user’s fork', () => {
    mocks.themes = [{ id: 'old-theme' }];
    sessionStorage.setItem('onboarding-theme:other:dark', 'old-theme');
    applyWorkspaceAccent('#f77d67', 'person');
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
