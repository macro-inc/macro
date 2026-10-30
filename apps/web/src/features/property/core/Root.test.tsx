import { fireAndForget } from '@core/util/fireAndForget';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { SelectProperty } from '../types';
import { getSelectValues } from '../utils/typeGuards';
import { useProperty } from './context';
import { Root } from './Root';

vi.mock('@core/component/HoverCard', () => ({
  useHoldParentHoverCardOpen: () => {},
}));

const priority: SelectProperty = {
  propertyId: 'priority-assignment',
  propertyDefinitionId: 'priority-definition',
  displayName: 'Priority',
  isMultiSelect: false,
  owner: { scope: 'system' },
  createdAt: new Date(0),
  updatedAt: new Date(0),
  valueType: 'SELECT_STRING',
  value: ['low'],
};

function Pick(props: { option: string }) {
  const ctx = useProperty();
  const pick = async () => {
    try {
      await ctx.onSave?.(ctx.property(), {
        valueType: 'SELECT_STRING',
        values: [props.option],
      });
    } catch {
      // Each test settles its saves.
    }
  };
  return (
    <button onClick={() => fireAndForget(pick(), 'property-root-test')}>
      Pick {props.option}
    </button>
  );
}

function setup() {
  const [source, setSource] = createSignal<SelectProperty>(priority);
  const saves: PromiseWithResolvers<void>[] = [];
  const onSave = vi.fn(() => {
    const save = Promise.withResolvers<void>();
    saves.push(save);
    return save.promise;
  });
  render(() => (
    <Root property={source()} canEdit onSave={onSave}>
      {(shown) => (
        <>
          <output>{getSelectValues(shown()).join(',')}</output>
          <Pick option="high" />
          <Pick option="urgent" />
        </>
      )}
    </Root>
  ));
  const shown = () => screen.getByRole('status').textContent;
  return { saves, onSave, setSource, shown };
}

afterEach(cleanup);

it('shows a pick while it saves and until the source moves past it', async () => {
  const { saves, onSave, setSource, shown } = setup();

  fireEvent.click(screen.getByText('Pick high'));
  expect(shown()).toBe('high');
  expect(onSave).toHaveBeenCalledExactlyOnceWith(priority, {
    valueType: 'SELECT_STRING',
    values: ['high'],
  });

  // An unrelated emission before the save settles keeps the pick.
  setSource({ ...priority });
  expect(shown()).toBe('high');

  saves[0].resolve();
  await saves[0].promise;
  expect(shown()).toBe('high');

  setSource({ ...priority, value: ['high'] });
  expect(shown()).toBe('high');
  setSource({ ...priority, value: ['medium'] });
  expect(shown()).toBe('medium');
});

it('drops a failed pick without clearing a newer one', async () => {
  const { saves, shown } = setup();

  fireEvent.click(screen.getByText('Pick high'));
  fireEvent.click(screen.getByText('Pick urgent'));
  expect(shown()).toBe('urgent');

  saves[0].reject(new Error('rejected'));
  await expect(saves[0].promise).rejects.toThrow('rejected');
  expect(shown()).toBe('urgent');

  saves[1].reject(new Error('rejected'));
  await expect(saves[1].promise).rejects.toThrow('rejected');
  expect(shown()).toBe('low');
});

it('keeps a saving pick through ID assignment but not on another property', () => {
  const { setSource, shown } = setup();

  fireEvent.click(screen.getByText('Pick high'));
  setSource({ ...priority, propertyId: 'assigned-after-save' });
  expect(shown()).toBe('high');

  setSource({
    ...priority,
    propertyId: 'status-assignment',
    propertyDefinitionId: 'status-definition',
    value: ['todo'],
  });
  expect(shown()).toBe('todo');
});

function EditorToggle() {
  const ctx = useProperty();
  return (
    <>
      <button onClick={(event) => ctx.openEditor(event.currentTarget)}>
        Edit
      </button>
      <input aria-label="Search" />
      <button onClick={() => ctx.closeEditor()}>Close</button>
    </>
  );
}

function renderEditor() {
  render(() => (
    <>
      <input aria-label="Title" />
      <Root property={priority} canEdit>
        <EditorToggle />
      </Root>
    </>
  ));
  return {
    title: screen.getByLabelText('Title'),
    search: screen.getByLabelText('Search'),
    pill: screen.getByText('Edit'),
  };
}

const nextTask = () => new Promise((resolve) => setTimeout(resolve));

it('returns focus to the pill after the editor took it', async () => {
  const { search, pill } = renderEditor();

  pill.focus();
  fireEvent.click(pill);
  search.focus();
  fireEvent.click(screen.getByText('Close'));
  await nextTask();

  expect(document.activeElement).toBe(pill);
});

it('leaves focus in the field the editor found it in', async () => {
  const { title, pill } = renderEditor();

  // A touch pill opens without taking focus from the title.
  title.focus();
  fireEvent.click(pill);
  fireEvent.click(screen.getByText('Close'));
  await nextTask();

  expect(document.activeElement).toBe(title);
});
