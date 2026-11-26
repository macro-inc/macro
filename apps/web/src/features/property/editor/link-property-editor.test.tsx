import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  LinkProperty,
  Property,
  PropertyDefinitionDomain,
} from '../types';
import { PropertyEditorDialog } from './PropertyEditorModal';
import type { PropertyEditorEntity } from './state/propertyEditor';

const savedProperties = vi.hoisted(() => ({
  read: { data: [] } as { data?: unknown[]; error?: Error },
}));

vi.mock('@queries/properties/entity', () => ({
  useEntityPropertiesQuery: () => savedProperties.read,
  useBulkUpdateEntityPropertyOptionsMutation: () => ({}),
}));

const LINKEDIN: LinkProperty = {
  propertyDefinitionId: 'linkedin',
  propertyId: 'linkedin-on-contact',
  displayName: 'LinkedIn',
  isMultiSelect: false,
  owner: { scope: 'team', team_id: 'team' },
  createdAt: new Date(0),
  updatedAt: new Date(0),
  valueType: 'LINK',
  value: null,
};

const NEW_LINKEDIN: PropertyDefinitionDomain = {
  id: 'linkedin',
  displayName: 'LinkedIn',
  isMultiSelect: false,
  isMetadata: false,
  isSystem: false,
  valueType: 'LINK',
  owner: { scope: 'team', team_id: 'team' },
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const CONTACT: PropertyEditorEntity = {
  id: 'contact',
  name: 'Contact',
  entityType: 'CONTACT',
};
const OTHER_CONTACT: PropertyEditorEntity = {
  id: 'other-contact',
  name: 'Other contact',
  entityType: 'CONTACT',
};

function setup(
  target: Property | PropertyDefinitionDomain,
  entities: PropertyEditorEntity[] = [CONTACT],
  draftProperties?: Property[]
) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(() => (
    <PropertyEditorDialog
      isOpen
      state={{
        mode: 'direct',
        selectedEntities: entities,
        targetProperty: target,
      }}
      onModeChange={() => {}}
      onTargetChange={() => {}}
      onClose={onClose}
      onSave={onSave}
      properties={draftProperties}
    />
  ));
  const field = screen.getByRole<HTMLInputElement>('textbox');
  return { onSave, onClose, field };
}

function type(field: HTMLInputElement, value: string) {
  fireEvent.input(field, { target: { value } });
}

function savedValues(onSave: ReturnType<typeof vi.fn>) {
  expect(onSave).toHaveBeenCalledOnce();
  return onSave.mock.calls[0]![1];
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  savedProperties.read = { data: [] };
});

describe('link property editor', () => {
  it('sets the first link of a property created from Add property', () => {
    const { onSave, field } = setup(NEW_LINKEDIN);

    type(field, 'linkedin.com/in/someone');
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(savedValues(onSave)).toEqual({
      valueType: 'LINK',
      values: ['https://linkedin.com/in/someone'],
    });
  });

  it('replaces the link of a single-link property', () => {
    const { onSave, field } = setup({
      ...LINKEDIN,
      value: ['https://linkedin.com/in/old'],
    });

    type(field, 'https://linkedin.com/in/new');
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(savedValues(onSave)).toEqual({
      valueType: 'LINK',
      values: ['https://linkedin.com/in/new'],
    });
  });

  it('adds to the links of a property that takes several', () => {
    const { onSave, field } = setup({
      ...LINKEDIN,
      isMultiSelect: true,
      value: ['https://example.com/one'],
    });

    type(field, 'example.com/two');
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(savedValues(onSave)).toEqual({
      valueType: 'LINK',
      values: ['https://example.com/one', 'https://example.com/two'],
    });
  });

  it('clears the value when its last link is removed', () => {
    const { onSave } = setup({
      ...LINKEDIN,
      value: ['https://linkedin.com/in/old'],
    });

    fireEvent.click(
      screen.getByRole('option', { name: /linkedin\.com\/in\/old/ })
    );

    expect(savedValues(onSave)).toEqual({ valueType: 'LINK', values: null });
  });

  it('keeps the remaining links when one of several is removed', () => {
    const { onSave } = setup({
      ...LINKEDIN,
      isMultiSelect: true,
      value: ['https://example.com/one', 'https://example.com/two'],
    });

    fireEvent.click(screen.getByRole('option', { name: /example\.com\/one/ }));

    expect(savedValues(onSave)).toEqual({
      valueType: 'LINK',
      values: ['https://example.com/two'],
    });
  });

  it('saves nothing for input that is not a URL or is already linked', () => {
    const { onSave, field } = setup({
      ...LINKEDIN,
      value: ['https://linkedin.com/in/old'],
    });

    type(field, 'https://');
    fireEvent.keyDown(field, { key: 'Enter' });
    type(field, 'linkedin.com/in/old');
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(onSave).not.toHaveBeenCalled();
  });

  it('leaves the links alone when Enter is pressed with nothing typed', () => {
    const { onSave, field } = setup({
      ...LINKEDIN,
      value: ['https://linkedin.com/in/old'],
    });

    fireEvent.keyDown(field, { key: 'Enter' });
    type(field, 'x');
    type(field, '');
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(onSave).not.toHaveBeenCalled();
  });

  it('removes the link the user moved to with the arrow keys', () => {
    const { onSave, field } = setup({
      ...LINKEDIN,
      isMultiSelect: true,
      value: ['https://example.com/one', 'https://example.com/two'],
    });

    fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(savedValues(onSave)).toEqual({
      valueType: 'LINK',
      values: ['https://example.com/one'],
    });
  });

  it('closes after a save even with Shift held, so no stale links are edited', () => {
    const { onClose, field } = setup({
      ...LINKEDIN,
      isMultiSelect: true,
      value: ['https://example.com/one'],
    });

    type(field, 'example.com/two');
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('adds to the links a draft already holds', () => {
    const { onSave, field } = setup(
      { ...NEW_LINKEDIN, isMultiSelect: true },
      [],
      [{ ...LINKEDIN, isMultiSelect: true, value: ['https://example.com/one'] }]
    );

    type(field, 'example.com/two');
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(savedValues(onSave)).toEqual({
      valueType: 'LINK',
      values: ['https://example.com/one', 'https://example.com/two'],
    });
  });

  it('adds to the links the item holds once its properties are read', () => {
    savedProperties.read = {
      data: [
        {
          ...LINKEDIN,
          isMultiSelect: true,
          value: ['https://example.com/one'],
        },
      ],
    };
    const { onSave, field } = setup({ ...NEW_LINKEDIN, isMultiSelect: true });

    type(field, 'example.com/two');
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(savedValues(onSave)).toEqual({
      valueType: 'LINK',
      values: ['https://example.com/one', 'https://example.com/two'],
    });
  });

  it('adds nothing while the item has not been read, so no link is dropped', () => {
    savedProperties.read = {};
    const { onSave, field } = setup({ ...NEW_LINKEDIN, isMultiSelect: true });

    type(field, 'example.com/two');
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(onSave).not.toHaveBeenCalled();
  });

  it('adds nothing when the item could not be read, even with an empty answer', () => {
    savedProperties.read = { data: [], error: new Error('FORBIDDEN') };
    const { onSave, field } = setup({ ...NEW_LINKEDIN, isMultiSelect: true });

    type(field, 'example.com/two');
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(onSave).not.toHaveBeenCalled();
  });

  it('sets one link on every selected item', () => {
    const { onSave, field } = setup(
      { ...LINKEDIN, isMultiSelect: true, value: ['https://example.com/one'] },
      [CONTACT, OTHER_CONTACT]
    );

    type(field, 'example.com/two');
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(savedValues(onSave)).toEqual({
      valueType: 'LINK',
      values: ['https://example.com/two'],
    });
  });
});
