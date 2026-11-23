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
import { StartDueEditor, type StartDueEditorProps } from './StartDueEditor';

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

function setup(
  onSave: PropertyRootContextValue['onSave'],
  saveOther: StartDueEditorProps['saveOther'] = vi.fn(async () => {})
) {
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

  await waitFor(() =>
    expect(saveOther).toHaveBeenCalledWith(start, {
      valueType: 'DATE',
      value: null,
    })
  );
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

function pickStartInCalendar(day: number) {
  fireEvent.click(screen.getByRole('button', { name: /^Start/ }));
  fireEvent.click(screen.getByText('Custom date...'));
  fireEvent.click(screen.getByRole('button', { name: String(day) }));
}

it('saves dates in the order they were picked, even while an earlier save is pending', async () => {
  const startSave = Promise.withResolvers<void>();
  const saveOther = vi
    .fn<StartDueEditorProps['saveOther']>()
    .mockReturnValueOnce(startSave.promise)
    .mockResolvedValue(undefined);
  const onSave = vi.fn(async () => {});
  setup(onSave, saveOther);

  fireEvent.click(screen.getByRole('button', { name: 'Clear both' }));
  pickStartInCalendar(25);
  await waitFor(() => expect(saveOther).toHaveBeenCalledTimes(1));

  startSave.resolve();
  await waitFor(() => expect(saveOther).toHaveBeenCalledTimes(2));
  expect(saveOther.mock.calls.map(([, saved]) => saved.value)).toEqual([
    null,
    new Date(2026, 10, 25),
  ]);
  expect(onSave).toHaveBeenCalledWith(due, { valueType: 'DATE', value: null });
});

it('keeps a newer pick on screen when an older save of that end fails', async () => {
  const startSave = Promise.withResolvers<void>();
  const saveOther = vi
    .fn<StartDueEditorProps['saveOther']>()
    .mockReturnValueOnce(startSave.promise)
    .mockResolvedValue(undefined);
  setup(
    vi.fn(async () => {}),
    saveOther
  );

  fireEvent.click(screen.getByRole('button', { name: 'Clear start' }));
  pickStartInCalendar(25);
  startSave.reject(new Error());

  await waitFor(() => expect(saveOther).toHaveBeenCalledTimes(2));
  expect(field('Start')).toBe('StartWed, Nov 25');
});

it('gives both ends a time with Add time and saves them as timed', async () => {
  const onSave = vi.fn(async () => {});
  const { saveOther } = setup(onSave);

  fireEvent.click(screen.getByRole('button', { name: /^Add time/ }));

  await waitFor(() =>
    expect(saveOther).toHaveBeenCalledWith(start, {
      valueType: 'DATE',
      value: new Date(2026, 10, 23, 11),
      hasTime: true,
    })
  );
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith(due, {
      valueType: 'DATE',
      value: new Date(2026, 10, 27, 12),
      hasTime: true,
    })
  );
  expect(field('Start')).toBe('StartMon, Nov 2311:00 AM');
  expect(field('Due')).toBe('DueFri, Nov 2712:00 PM');
  expect(screen.getByPlaceholderText('Set end time...')).toBeTruthy();
});

it('moves the due date with a new start time, keeping the length, then asks for the end', async () => {
  const onSave = vi.fn(async () => {});
  const { saveOther } = setup(onSave);
  fireEvent.click(screen.getByRole('button', { name: /^Add time/ }));
  fireEvent.click(screen.getByRole('button', { name: /^Start/ }));

  fireEvent.click(screen.getByRole('option', { name: '2:00 PM' }));

  await waitFor(() =>
    expect(saveOther).toHaveBeenLastCalledWith(start, {
      valueType: 'DATE',
      value: new Date(2026, 10, 23, 14),
      hasTime: true,
    })
  );
  await waitFor(() =>
    expect(onSave).toHaveBeenLastCalledWith(due, {
      valueType: 'DATE',
      value: new Date(2026, 10, 27, 15),
      hasTime: true,
    })
  );
  expect(screen.getByPlaceholderText('Set end time...')).toBeTruthy();
});

it('lists end times after a same-day start with the length each gives', async () => {
  setup(vi.fn(async () => {}));
  fireEvent.click(screen.getByRole('button', { name: /^Add time/ }));
  fireEvent.click(screen.getByRole('button', { name: /^Start/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Change day' }));
  fireEvent.click(screen.getByRole('button', { name: '27' }));

  fireEvent.click(screen.getByRole('button', { name: /^Due/ }));

  expect(screen.getByRole('option', { name: '12:00 PM 1h' })).toBeTruthy();
  expect(screen.getByRole('option', { name: '11:15 AM 15min' })).toBeTruthy();
});

it('makes both ends whole days again with Remove time', async () => {
  const onSave = vi.fn(async () => {});
  const { saveOther } = setup(onSave);
  fireEvent.click(screen.getByRole('button', { name: /^Add time/ }));

  fireEvent.click(screen.getByRole('button', { name: 'Remove time' }));

  await waitFor(() =>
    expect(saveOther).toHaveBeenLastCalledWith(start, {
      valueType: 'DATE',
      value: new Date(2026, 10, 23),
    })
  );
  await waitFor(() =>
    expect(onSave).toHaveBeenLastCalledWith(due, {
      valueType: 'DATE',
      value: new Date(2026, 10, 27),
    })
  );
  expect(screen.getByRole('button', { name: /^Add time/ })).toBeTruthy();
});

it('updates the length in the footer while the picker stays open', async () => {
  setup(vi.fn(async () => {}));
  expect(screen.getByText('5 days')).toBeTruthy();

  pickStartInCalendar(25);

  await waitFor(() => expect(screen.getByText('3 days')).toBeTruthy());
  expect(field('Start')).toBe('StartWed, Nov 25');
});

it('saves the due date first when a new start time passes the saved due date', async () => {
  const onSave = vi.fn(async () => {});
  const saveOther = vi
    .fn<StartDueEditorProps['saveOther']>()
    .mockResolvedValue(undefined);
  setup(onSave, saveOther);
  fireEvent.click(screen.getByRole('button', { name: /^Add time/ }));
  fireEvent.click(screen.getByRole('button', { name: /^Start/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Change day' }));
  fireEvent.click(screen.getByRole('button', { name: '27' }));
  await waitFor(() =>
    expect(saveOther).toHaveBeenLastCalledWith(start, {
      valueType: 'DATE',
      value: new Date(2026, 10, 27, 11),
      hasTime: true,
    })
  );

  fireEvent.click(screen.getByRole('option', { name: '2:00 PM' }));

  await waitFor(() =>
    expect(saveOther).toHaveBeenLastCalledWith(start, {
      valueType: 'DATE',
      value: new Date(2026, 10, 27, 14),
      hasTime: true,
    })
  );
  const dueSave = onSave.mock.invocationCallOrder.at(-1) ?? 0;
  const startSave = saveOther.mock.invocationCallOrder.at(-1) ?? 0;
  expect(onSave).toHaveBeenLastCalledWith(due, {
    valueType: 'DATE',
    value: new Date(2026, 10, 27, 15),
    hasTime: true,
  });
  expect(dueSave).toBeLessThan(startSave);
});

it('saves the time the arrows move to over the one typed', async () => {
  const onSave = vi.fn(async () => {});
  setup(onSave);
  fireEvent.click(screen.getByRole('button', { name: /^Add time/ }));
  const input = screen.getByPlaceholderText('Set end time...');

  fireEvent.input(input, { target: { value: '2p' } });
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });

  await waitFor(() =>
    expect(onSave).toHaveBeenLastCalledWith(due, {
      valueType: 'DATE',
      value: new Date(2026, 10, 27, 14, 15),
      hasTime: true,
    })
  );
});

it('saves the due date first when a start day is picked after it, moving it by the same length', async () => {
  const onSave = vi.fn(async () => {});
  const saveOther = vi
    .fn<StartDueEditorProps['saveOther']>()
    .mockResolvedValue(undefined);
  setup(onSave, saveOther);

  pickStartInCalendar(30);

  await waitFor(() =>
    expect(saveOther).toHaveBeenCalledWith(start, {
      valueType: 'DATE',
      value: new Date(2026, 10, 30),
    })
  );
  expect(onSave).toHaveBeenCalledWith(due, {
    valueType: 'DATE',
    value: new Date(2026, 11, 4),
  });
  expect(onSave.mock.invocationCallOrder[0]).toBeLessThan(
    saveOther.mock.invocationCallOrder[0] ?? 0
  );
});
