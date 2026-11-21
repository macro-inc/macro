import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, type ParentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  PropertyRootContext,
  type PropertyRootContextValue,
} from '../../core/context';
import type { DateProperty } from '../../types';
import { StartDueEditor } from './StartDueEditor';

vi.mock('../../utils', async () => ({
  ...(await import('../../utils/typeGuards')),
  ...(await import('../../utils/formatting')),
}));

// The real editor and selector; the popover is a plain container here.
vi.mock('./EditorPopover', () => ({
  EditorPopover: (props: ParentProps) => (
    <div role="dialog">{props.children}</div>
  ),
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function dateProperty(
  id: string,
  displayName: string,
  value: Date | null
): DateProperty {
  return {
    propertyId: id,
    propertyDefinitionId: id,
    displayName,
    isMultiSelect: false,
    owner: { scope: 'system' },
    createdAt: new Date(0),
    updatedAt: new Date(0),
    valueType: 'DATE',
    value,
  };
}

const start = dateProperty('start', 'Start Date', new Date(2026, 10, 23));
const due = dateProperty('due', 'Due Date', new Date(2026, 10, 27));

function setup(onSave: PropertyRootContextValue['onSave']) {
  const saveOther = vi.fn(async () => {});
  const [editorOpen, setEditorOpen] = createSignal(true);
  const context: PropertyRootContextValue = {
    property: () => due,
    pickedEntityName: () => undefined,
    canEdit: () => true,
    editorOpen,
    openEditor: () => setEditorOpen(true),
    closeEditor: () => setEditorOpen(false),
    onSave,
  };
  render(() => (
    <PropertyRootContext.Provider value={context}>
      <StartDueEditor field="due" other={() => start} saveOther={saveOther} />
    </PropertyRootContext.Provider>
  ));
  return { saveOther };
}

function field(name: 'Start' | 'Due') {
  return screen.getByRole('button', { name: new RegExp(`^${name}`) })
    .textContent;
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', ObserverStub);
  Element.prototype.scrollIntoView = vi.fn();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 20, 10));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('keeps a cleared start and shows the due date again when clearing it fails', async () => {
  const { saveOther } = setup(vi.fn(async () => Promise.reject(new Error())));

  fireEvent.click(screen.getByRole('button', { name: 'Clear both' }));

  expect(saveOther).toHaveBeenCalledWith(start, null);
  await waitFor(() => expect(field('Due')).toBe('DueFri, Nov 27'));
  expect(field('Start')).toBe('StartNone');
});

it('shows both ends cleared once both saves succeed', async () => {
  const onSave = vi.fn(async () => {});
  setup(onSave);

  fireEvent.click(screen.getByRole('button', { name: 'Clear both' }));

  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith(due, { valueType: 'DATE', value: null })
  );
  expect(field('Start')).toBe('StartNone');
  expect(field('Due')).toBe('DueNone');
});
