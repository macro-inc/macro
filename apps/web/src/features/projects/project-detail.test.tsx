import { useViewTabHotkeys } from '@app/components/view-shell/use-view-tab-hotkeys';
import { useHotKeyRoot } from '@core/hotkey/hotkeys';
import { setActiveScope } from '@core/hotkey/state';
import { registerScope, removeScope } from '@core/hotkey/utils';
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal, type ParentProps, Show } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({ scopeId: 'project-detail-test-scope' }));

vi.mock('@app/components/entity-detail/EntityDetailTopBar', () => ({
  EntityDetailTopBar: () => null,
}));
vi.mock('@app/lib/split-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/lib/split-router')>()),
  useNavigate: () => vi.fn(),
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({}),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitDisplayName: () => {},
  useSplitPanelOrThrow: () => ({ splitHotkeyScope: fixtures.scopeId }),
}));
vi.mock('./project-collaboration', () => ({ ProjectDiscussion: () => null }));
vi.mock('./project-description', () => ({ ProjectDescription: () => null }));
vi.mock('./project-share', () => ({
  useProjectShareModal: () => () => {},
}));
vi.mock('./project-unavailable', () => ({ ProjectUnavailable: () => null }));
vi.mock('./projects', async () => {
  const { ProjectsProvider } = await import('./context/projects-context');
  const context = {
    createProjectSource: () => ({
      project: () => undefined,
      properties: () => [],
      loading: () => false,
      error: () => undefined,
      refresh: async () => {},
    }),
    createCommands: () => ({}),
  } as unknown as Parameters<typeof ProjectsProvider>[0]['context'];
  return {
    Projects: (props: ParentProps) => (
      <ProjectsProvider context={context}>{props.children}</ProjectsProvider>
    ),
  };
});
vi.mock('./views/project-workspace', () => ({ ProjectWorkspace: () => null }));

import { ProjectDetail } from './project-detail';

beforeEach(() => {
  registerScope({
    parentScopeId: 'global',
    scopeId: fixtures.scopeId,
    type: 'dom',
  });
  setActiveScope(fixtures.scopeId);
});

afterEach(() => {
  cleanup();
  setActiveScope('global');
  removeScope(fixtures.scopeId);
});

const pressTab = (shiftKey = false) => {
  const keydown = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(keydown);
  document.dispatchEvent(
    new KeyboardEvent('keyup', { key: 'Tab', shiftKey, bubbles: true })
  );
  return keydown;
};

it('leaves Tab to the focus order while open and gives it back on leaving', () => {
  const setTab = vi.fn();
  const [open, setOpen] = createSignal(true);
  render(() => {
    useHotKeyRoot();
    useViewTabHotkeys({
      scopeId: fixtures.scopeId,
      ids: () => ['my-projects', 'all-projects'],
      activeId: () => 'my-projects',
      setActiveId: setTab,
    });
    return (
      <Show when={open()}>
        <ProjectDetail
          route={{
            id: '01992d2f-8444-7000-8000-000000000001',
            section: 'overview',
          }}
        />
      </Show>
    );
  });

  expect(pressTab().defaultPrevented).toBe(false);
  expect(pressTab(true).defaultPrevented).toBe(false);
  expect(setTab).not.toHaveBeenCalled();

  setOpen(false);

  expect(pressTab().defaultPrevented).toBe(true);
  expect(setTab).toHaveBeenCalledExactlyOnceWith('all-projects');
});
