import { fireAndForget } from '@core/util/fireAndForget';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { EntityProperty, SelectProperty } from '../types';
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

const project: EntityProperty = {
  propertyId: 'project-assignment',
  propertyDefinitionId: 'project-definition',
  displayName: 'Project',
  isMultiSelect: false,
  owner: { scope: 'system' },
  createdAt: new Date(0),
  updatedAt: new Date(0),
  valueType: 'ENTITY',
  specificEntityType: 'INITIATIVE',
  value: [{ entity_id: 'launch', entity_type: 'INITIATIVE' }],
};

function PickProject() {
  const ctx = useProperty();
  const pick = async () => {
    try {
      await ctx.onSave?.(
        ctx.property(),
        {
          valueType: 'ENTITY',
          refs: [{ entity_id: 'redesign', entity_type: 'INITIATIVE' }],
        },
        new Map([['redesign', 'Website redesign']])
      );
    } catch {
      // Each test settles its saves.
    }
  };
  return (
    <>
      <output>{ctx.pickedEntityName('redesign')}</output>
      <button onClick={() => fireAndForget(pick(), 'property-root-test')}>
        Pick redesign
      </button>
    </>
  );
}

it('names a picked entity until its own read can answer, on its property only', async () => {
  const [source, setSource] = createSignal<EntityProperty>(project);
  const saves: PromiseWithResolvers<void>[] = [];
  const onSave = vi.fn(() => {
    const save = Promise.withResolvers<void>();
    saves.push(save);
    return save.promise;
  });
  render(() => (
    <Root property={source()} canEdit onSave={onSave}>
      <PickProject />
    </Root>
  ));
  const pickedName = () => screen.getByRole('status').textContent;

  fireEvent.click(screen.getByText('Pick redesign'));
  expect(pickedName()).toBe('Website redesign');
  expect(onSave).toHaveBeenCalledExactlyOnceWith(project, {
    valueType: 'ENTITY',
    refs: [{ entity_id: 'redesign', entity_type: 'INITIATIVE' }],
  });

  saves[0].resolve();
  await saves[0].promise;
  // The source can show the pick before the chip's own read answers.
  setSource({
    ...project,
    value: [{ entity_id: 'redesign', entity_type: 'INITIATIVE' }],
  });
  expect(pickedName()).toBe('Website redesign');

  setSource({
    ...project,
    propertyId: 'status-assignment',
    propertyDefinitionId: 'status-definition',
  });
  expect(pickedName()).toBe('');
});

it('drops the picked names when their save fails', async () => {
  const save = Promise.withResolvers<void>();
  render(() => (
    <Root property={project} canEdit onSave={() => save.promise}>
      <PickProject />
    </Root>
  ));

  fireEvent.click(screen.getByText('Pick redesign'));
  expect(screen.getByRole('status').textContent).toBe('Website redesign');

  save.reject(new Error('rejected'));
  await expect(save.promise).rejects.toThrow('rejected');
  expect(screen.getByRole('status').textContent).toBe('');
});
