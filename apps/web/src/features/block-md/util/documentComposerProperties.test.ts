import type { PropertyApiValues } from '@property/types';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createDocumentComposerTags } from './documentComposerProperties';

vi.mock('@queries/properties/entity', () => ({
  useBulkUpdateEntityPropertyOptionsMutation: () => ({}),
}));
vi.mock('@property/hooks', () => ({
  useEntityProperties: () => ({ properties: () => [] }),
}));
vi.mock('@queries/properties/tags', () => ({
  useTagsQuery: () => ({
    isSuccess: true,
    data: [
      {
        scope: 'user',
        definition: {
          id: 'tags',
          scope: 'user',
          user_id: 'me',
          displayName: 'Tags',
          dataType: 'TAG',
          isMultiSelect: true,
          isSystem: false,
          isMetadata: false,
        },
        options: [
          {
            id: 'launch',
            propertyDefinitionId: 'tags',
            displayOrder: 0,
            value: { type: 'string', value: 'Launch' },
          },
        ],
      },
    ],
  }),
  useEnsureTagSetMutation: () => ({ mutateAsync: vi.fn() }),
}));

describe('document composer tags', () => {
  it('edits the host draft, restores its selection, and clears through the same contract', async () => {
    await createRoot(async (dispose) => {
      try {
        const [values, setValues] = createSignal<
          Record<string, PropertyApiValues>
        >({});
        const tags = createDocumentComposerTags(
          {},
          { values, onChange: setValues }
        );
        await tags.composerTags.applyTag('user', 'launch');
        expect(values()).toEqual({
          tags: { valueType: 'SELECT_STRING', values: ['launch'] },
        });
        expect(tags.composerTags.isApplied('launch')).toBe(true);
        const restored = createDocumentComposerTags(
          JSON.parse(JSON.stringify(values()))
        );
        expect(
          restored.composerTags.appliedTags().map((tag) => tag.label)
        ).toEqual(['Launch']);
        expect(tags.createDefinitions().get('tags')?.id).toBe('tags');
        tags.clearComposerTags();
        expect(values()).toEqual({});
        expect(tags.composerTags.appliedTags()).toEqual([]);
        expect(restored.composerTags.isApplied('launch')).toBe(true);
      } finally {
        dispose();
      }
    });
  });
});
