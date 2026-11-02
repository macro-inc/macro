import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Root } from '../../core/Root';
import type { Property } from '../../types';
import { InlineEditor } from './InlineEditor';

vi.mock('@core/component/HoverCard', () => ({
  useHoldParentHoverCardOpen: () => {},
}));
vi.mock('@core/signal/unfurl', () => ({
  useUnfurl: () => [() => undefined],
}));

const BASE = {
  propertyDefinitionId: 'definition',
  propertyId: 'assignment',
  displayName: 'Value',
  isMultiSelect: false,
  owner: { scope: 'system' },
  createdAt: new Date(0),
  updatedAt: new Date(0),
} as const;

const NUMBER: Property = { ...BASE, valueType: 'NUMBER', value: 3 };
const TEXT: Property = { ...BASE, valueType: 'STRING', value: 'Draft' };
const LINKS: Property = {
  ...BASE,
  valueType: 'LINK',
  isMultiSelect: true,
  value: ['https://example.com/one'],
};
const LINK: Property = { ...BASE, valueType: 'LINK', value: null };
const FLAG: Property = { ...BASE, valueType: 'BOOLEAN', value: false };

function setup(property: Property) {
  const saves: PromiseWithResolvers<void>[] = [];
  const onSave = vi.fn(() => {
    const save = Promise.withResolvers<void>();
    saves.push(save);
    return save.promise;
  });
  render(() => (
    <>
      <Root property={property} canEdit onSave={onSave}>
        <InlineEditor />
      </Root>
      <button>After</button>
    </>
  ));
  return {
    saves,
    onSave,
    after: screen.getByRole('button', { name: 'After' }),
  };
}

const focused = () => document.activeElement;
// Root returns focus from a timer scheduled after the save's promise settles.
const settle = async () => {
  for (let tick = 0; tick < 3; tick++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const fieldOf = (container: HTMLElement) => {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    'input, textarea'
  );
  if (!field) throw new Error('No field is open');
  return field;
};

async function startEditing(trigger: HTMLElement) {
  fireEvent.click(trigger);
  await settle();
  const field = fieldOf(document.body);
  expect(focused()).toBe(field);
  return field;
}

function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  field.value = value;
  fireEvent.input(field);
}

afterEach(cleanup);

describe.each([
  ['number', NUMBER, '3', '4'],
  ['text', TEXT, 'Draft', 'Final'],
])('%s value', (_name, property, current, next) => {
  const value = (label: string) => screen.getByRole('button', { name: label });

  it('returns focus to the value after Enter saves', async () => {
    const { saves, onSave } = setup(property);
    const field = await startEditing(value(current));

    type(field, next);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledOnce();

    // A disabled field loses focus in browsers, though not in jsdom.
    expect(field.disabled).toBe(false);
    expect(field.readOnly).toBe(true);
    expect(focused()).toBe(field);

    saves[0]!.resolve();
    await settle();
    expect(focused()).toBe(value(next));
  });

  it('returns focus to the value after Enter changes nothing', async () => {
    const { onSave } = setup(property);
    const field = await startEditing(value(current));

    fireEvent.keyDown(field, { key: 'Enter' });
    await settle();

    expect(onSave).not.toHaveBeenCalled();
    expect(focused()).toBe(value(current));
  });

  it('returns focus to the value after Escape', async () => {
    const { onSave } = setup(property);
    const field = await startEditing(value(current));

    type(field, next);
    fireEvent.keyDown(field, { key: 'Escape' });
    await settle();

    expect(onSave).not.toHaveBeenCalled();
    expect(focused()).toBe(value(current));
  });

  it('ignores Enter and Escape while a save runs', async () => {
    const { saves, onSave } = setup(property);
    const field = await startEditing(value(current));

    type(field, next);
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.keyDown(field, { key: 'Escape' });

    expect(onSave).toHaveBeenCalledOnce();
    expect(field.isConnected).toBe(true);
    saves[0]!.resolve();
    await settle();
  });

  it('leaves Enter and Escape to an IME while it composes', async () => {
    const { onSave } = setup(property);
    const field = await startEditing(value(current));

    type(field, next);
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(field, { key: 'Enter', keyCode: 229 });
    fireEvent.keyDown(field, { key: 'Escape', isComposing: true });
    await settle();

    expect(onSave).not.toHaveBeenCalled();
    expect(field.isConnected).toBe(true);
    expect(focused()).toBe(field);
  });

  it('keeps the field open and focused when the save fails', async () => {
    const { saves } = setup(property);
    const field = await startEditing(value(current));

    type(field, next);
    fireEvent.keyDown(field, { key: 'Enter' });
    saves[0]!.reject(new Error('Save failed'));
    await settle();

    expect(focused()).toBe(field);
    expect(field.readOnly).toBe(false);
  });

  it('leaves focus on the next control when Tab saves', async () => {
    const { saves, after } = setup(property);
    const field = await startEditing(value(current));

    type(field, next);
    after.focus();
    saves[0]!.resolve();
    await settle();

    expect(focused()).toBe(after);
  });

  it('leaves focus on a control taken while the save ran', async () => {
    const { saves, after } = setup(property);
    const field = await startEditing(value(current));

    type(field, next);
    fireEvent.keyDown(field, { key: 'Enter' });
    after.focus();
    saves[0]!.resolve();
    await settle();

    expect(focused()).toBe(after);
  });
});

describe('link value', () => {
  const add = () => screen.getByRole('button', { name: '+' });
  const URL_TWO = 'example.com/two';

  it('returns focus to the add button after Enter adds a link', async () => {
    const { saves } = setup(LINKS);
    const field = await startEditing(add());

    type(field, URL_TWO);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(field.disabled).toBe(false);
    expect(focused()).toBe(field);

    saves[0]!.resolve();
    await settle();
    expect(focused()).toBe(add());
  });

  it('returns focus to the chip when no add button is left', async () => {
    const { saves } = setup(LINK);
    const field = await startEditing(add());

    type(field, URL_TWO);
    fireEvent.keyDown(field, { key: 'Enter' });
    saves[0]!.resolve();
    await settle();

    expect(focused()).toBe(screen.getByRole('button', { name: 'example.com' }));
  });

  it('returns focus to the add button after Escape', async () => {
    setup(LINKS);
    const field = await startEditing(add());

    fireEvent.keyDown(field, { key: 'Escape' });
    await settle();

    expect(focused()).toBe(add());
  });

  it('leaves Enter to an IME while it composes', async () => {
    const { onSave } = setup(LINKS);
    const field = await startEditing(add());

    type(field, URL_TWO);
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    await settle();

    expect(onSave).not.toHaveBeenCalled();
    expect(focused()).toBe(field);
  });

  it('adds once when focus leaves while the save runs', async () => {
    const { saves, onSave, after } = setup(LINKS);
    const field = await startEditing(add());

    type(field, URL_TWO);
    fireEvent.keyDown(field, { key: 'Enter' });
    after.focus();
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(onSave).toHaveBeenCalledOnce();
    expect(screen.queryByText('This URL has already been added')).toBeNull();
    saves[0]!.resolve();
    await settle();
    expect(focused()).toBe(after);
  });
});

it('keeps a checkbox focused through its save', async () => {
  const { saves, onSave } = setup(FLAG);
  const toggle = screen.getAllByRole('button')[0] as HTMLButtonElement;
  toggle.focus();

  fireEvent.click(toggle);
  fireEvent.click(toggle);

  expect(onSave).toHaveBeenCalledOnce();
  expect(toggle.disabled).toBe(false);
  saves[0]!.resolve();
  await settle();
  expect(focused()).toBe(toggle);
});
