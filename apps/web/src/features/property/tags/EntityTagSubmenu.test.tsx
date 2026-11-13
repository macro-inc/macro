/** @vitest-environment jsdom */
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { Dropdown } from '@ui';
import { ImperativeDialogHost } from '@ui/components/ImperativeDialog';
import { createSignal, Show } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EntityTagSubmenu } from './EntityTagSubmenu';
import type { DocTags } from './tag-picker-session';

const mocks = vi.hoisted(() => ({ source: vi.fn(), save: vi.fn() }));
vi.mock('./useDocTags', () => ({ useDocTags: mocks.source }));
vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({ data: undefined }),
}));
vi.mock('@queries/properties/options', () => ({
  useAddPropertyOptionMutation: () => ({ isPending: false }),
}));
vi.mock('@queries/properties/tags', () => ({
  useEnsureTagSetMutation: () => ({ isPending: false }),
  useCreateTagMutation: () => ({ isPending: false }),
  useDeletePropertyOptionMutation: () => ({ isPending: false }),
  useUpdatePropertyOptionMutation: () => ({ isPending: false }),
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({}),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanel: () => undefined,
}));
vi.mock('@core/util/createControlledOpenSignal', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@core/util/createControlledOpenSignal')
  >()),
  useFocusLock: () => ({ acquire() {}, release() {} }),
}));

const tagSets: TagSetResponse[] = [
  {
    scope: 'user',
    options: [
      {
        id: 'urgent',
        propertyDefinitionId: 'tags',
        displayOrder: 0,
        value: { type: 'string', value: 'Urgent' },
      },
    ],
  },
];
const scrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollIntoView'
);
let style: HTMLStyleElement;
beforeEach(() => {
  mocks.save.mockReset().mockResolvedValue(undefined);
  mocks.source.mockReset().mockReturnValue({
    tagSets: () => tagSets,
    appliedTags: () => [],
    optionById: () => new Map(),
    isApplied: () => false,
    applyTag: vi.fn(),
    removeTag: vi.fn(),
    replaceTag: vi.fn(),
    setTagSelection: mocks.save,
    toggleTag: vi.fn(),
  } satisfies DocTags);
  style = document.createElement('style');
  style.textContent = '* { animation-name: none !important; }';
  document.head.append(style);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  style.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (scrollIntoView)
    Object.defineProperty(
      HTMLElement.prototype,
      'scrollIntoView',
      scrollIntoView
    );
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});

function setup() {
  const [visible, setVisible] = createSignal(true);
  render(() => (
    <>
      <Show when={visible()}>
        <Dropdown>
          <Dropdown.Trigger>Actions</Dropdown.Trigger>
          <Dropdown.Content>
            <EntityTagSubmenu
              entity={{
                type: 'document',
                id: 'document-1',
                name: 'Document',
                ownerId: 'owner',
                fileType: 'md',
              }}
              onActionComplete={() => setVisible(false)}
            />
          </Dropdown.Content>
        </Dropdown>
      </Show>
      <ImperativeDialogHost />
    </>
  ));
  return { closeParent: () => setVisible(false) };
}

async function openTags() {
  fireEvent.keyDown(screen.getByRole('button', { name: 'Actions' }), {
    key: 'Enter',
  });
  const trigger = await screen.findByRole('menuitem', { name: 'Add tag' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowRight' });
  const search = await screen.findByPlaceholderText('Change or add tags');
  search.focus();
  return search;
}

it('handles selection keys in the submenu and saves staged tags when its parent unmounts', async () => {
  const { closeParent } = setup();
  expect(mocks.source).not.toHaveBeenCalled();
  const search = await openTags();
  fireEvent.keyDown(search, { key: 'ArrowLeft' });
  expect(screen.getByPlaceholderText('Change or add tags')).toBe(search);
  fireEvent.keyDown(search, { key: 'Enter', shiftKey: true });
  expect(mocks.save).not.toHaveBeenCalled();
  closeParent();
  await waitFor(() =>
    expect(mocks.save).toHaveBeenCalledWith(new Set(['urgent']))
  );
});

it('keeps tag editing alive after the parent menu unmounts', async () => {
  const { closeParent } = setup();
  await openTags();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Urgent' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  await screen.findByRole('dialog');
  expect(screen.queryByRole('menuitem', { name: 'Add tag' })).toBeNull();
  closeParent();
  expect(screen.getByPlaceholderText('Tag name')).toHaveProperty(
    'value',
    'Urgent'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
