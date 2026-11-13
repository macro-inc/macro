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

const mocks = vi.hoisted(() => ({
  source: vi.fn(),
  save: vi.fn(),
  add: vi.fn(),
  ensure: vi.fn(),
  apply: vi.fn(),
}));
vi.mock('./useDocTags', () => ({ useDocTags: mocks.source }));
vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({ data: undefined }),
}));
vi.mock('@queries/properties/options', () => ({
  useAddPropertyOptionMutation: () => ({
    isPending: false,
    mutateAsync: mocks.add,
  }),
}));
vi.mock('@queries/properties/tags', () => ({
  invalidateTags: vi.fn(),
  useEnsureTagSetMutation: () => ({
    isPending: false,
    mutateAsync: mocks.ensure,
  }),
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
      {
        id: 'follow-up',
        propertyDefinitionId: 'tags',
        displayOrder: 1,
        value: { type: 'string', value: 'Follow up' },
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
  mocks.add.mockReset().mockResolvedValue({ id: 'created-tag' });
  mocks.ensure.mockReset().mockResolvedValue({
    definition: { id: 'tags' },
    options: tagSets[0].options,
  });
  mocks.apply.mockReset().mockResolvedValue(undefined);
  mocks.source.mockReset().mockReturnValue({
    tagSets: () => tagSets,
    appliedTags: () => [],
    optionById: () => new Map(),
    isApplied: () => false,
    applyTag: mocks.apply,
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
  const complete = vi.fn(() => setVisible(false));
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
              onActionComplete={complete}
            />
          </Dropdown.Content>
        </Dropdown>
      </Show>
      <ImperativeDialogHost />
    </>
  ));
  return { closeParent: () => setVisible(false), complete };
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

it('keeps checkbox selections open and saves them together with a row pick', async () => {
  const { complete } = setup();
  const search = await openTags();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Urgent' }));
  expect(screen.getByRole('checkbox', { name: 'Urgent' })).toHaveProperty(
    'checked',
    true
  );
  expect(screen.getByPlaceholderText('Change or add tags')).toBe(search);
  expect(mocks.save).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('checkbox', { name: 'Urgent' }));
  expect(screen.getByRole('checkbox', { name: 'Urgent' })).toHaveProperty(
    'checked',
    false
  );
  fireEvent.click(screen.getByRole('checkbox', { name: 'Urgent' }));
  fireEvent.click(
    screen.getByText('Follow up', { exact: true, selector: 'span' })
  );

  await waitFor(() => expect(complete).toHaveBeenCalledOnce());
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(mocks.save).toHaveBeenCalledWith(new Set(['urgent', 'follow-up']));
  expect(screen.queryByPlaceholderText('Change or add tags')).toBeNull();
});

it('goes back through creation steps without losing the name or chosen color', async () => {
  setup();
  const search = await openTags();
  fireEvent.input(search, { target: { value: 'New tag' } });
  fireEvent.click(screen.getByText('Create new tag "New tag"'));
  fireEvent.click(screen.getByText('Green', { exact: true }));
  const back = screen.getByRole('button', { name: 'Back' });
  back.focus();
  fireEvent.keyDown(back, { key: 'Enter' });
  expect(screen.getByText('Personal', { exact: true })).toBeTruthy();
  expect(mocks.add).not.toHaveBeenCalled();
  fireEvent.click(back);
  expect(screen.getByText('Green', { exact: true })).toBeTruthy();
  const flow = back.closest('[tabindex="-1"]');
  expect(document.activeElement).toBe(flow);
  back.focus();
  fireEvent.keyDown(back, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(flow);
  if (!flow) throw new Error('Missing tag creation flow');
  fireEvent.keyDown(flow, { key: 'ArrowUp' });
  fireEvent.keyDown(flow, { key: 'Enter' });
  expect(screen.getByText('Personal', { exact: true })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));

  const name = screen.getByPlaceholderText('Change or add tags');
  expect(name).toHaveProperty('value', 'New tag');
  fireEvent.input(name, { target: { value: 'Renamed tag' } });
  fireEvent.click(screen.getByText('Create new tag "Renamed tag"'));
  fireEvent.keyDown(screen.getByText('Create tag "Renamed tag"'), {
    key: 'Enter',
  });
  fireEvent.click(screen.getByText('Personal', { exact: true }));

  await waitFor(() =>
    expect(mocks.apply).toHaveBeenCalledWith('user', 'created-tag')
  );
  expect(mocks.add).toHaveBeenCalledWith({
    propertyDefinitionId: 'tags',
    body: {
      type: 'select_string',
      option: { value: 'Renamed tag', display_order: 2, color: '#46A758' },
    },
  });
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

it('does not report completion or close the parent after a rejected tag write', async () => {
  const failure = new Error('Tag update rejected');
  mocks.save.mockRejectedValueOnce(failure);
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { complete } = setup();
  const search = await openTags();
  fireEvent.keyDown(search, { key: 'Enter' });
  await waitFor(() =>
    expect(error).toHaveBeenCalledWith(
      'Failed to persist tag selection',
      failure
    )
  );
  expect(complete).not.toHaveBeenCalled();
  expect(screen.getByRole('menuitem', { name: 'Add tag' })).toBeTruthy();
});
