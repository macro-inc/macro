import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, type ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { InlineFetchedEntityTagsPill } from './EntityRowTags';
import type { ResolvedTag } from './useSoupResolvedTags';

const mocks = vi.hoisted(() => ({ appliedTags: () => [] as ResolvedTag[] }));
vi.mock('./useDocTags', () => ({
  useDocTags: () => ({ appliedTags: () => mocks.appliedTags() }),
}));
vi.mock('./TagPicker', () => ({
  TagPicker: (props: ParentProps<{ triggerLabel: string }>) => (
    <button aria-label={props.triggerLabel}>{props.children}</button>
  ),
}));
vi.mock('./TagEditorDialog', () => ({ TagEditorDialog: () => null }));
afterEach(cleanup);

it('replaces Add tags with the existing tag summary without replacing the picker', () => {
  let updateTags!: (tags: ResolvedTag[]) => void;
  render(() => {
    const [tags, setTags] = createSignal<ResolvedTag[]>([]);
    mocks.appliedTags = tags;
    updateTags = setTags;
    return (
      <InlineFetchedEntityTagsPill
        entityId="doc"
        entityType="DOCUMENT"
        showAddButton
      />
    );
  });
  const trigger = screen.getByRole('button', { name: 'Add tags' });
  const tag: ResolvedTag = {
    optionId: 'one',
    propertyDefinitionId: 'tags',
    scope: 'user',
    label: 'Design',
  };
  updateTags([tag]);
  expect(screen.queryByText('Add tags')).toBeNull();
  expect(screen.getByRole('button', { name: 'Change or select tags' })).toBe(
    trigger
  );
  expect(trigger.textContent).toBe('Design');
  updateTags([tag, { ...tag, optionId: 'two', label: 'Review' }]);
  expect(trigger.textContent).toBe('2 Tags');
  updateTags([]);
  expect(screen.getByRole('button', { name: 'Add tags' })).toBe(trigger);
});
