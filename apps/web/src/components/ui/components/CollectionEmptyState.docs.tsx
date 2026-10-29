import { defineDoc } from '@app/features/ui-gallery/types';
import { t } from '@app/lib/i18n';
import Plus from '@icon/system/regular/plus.svg';
import { createSignal, Show } from 'solid-js';
import { Button } from './Button';
import { CollectionEmptyState } from './CollectionEmptyState';

// #region demo:editable
function EditableDemo() {
  const [added, setAdded] = createSignal(false);

  return (
    <div class="w-full max-w-sm">
      <Show
        when={!added()}
        fallback={
          <div class="flex items-center justify-between gap-2 text-sm">
            <span>Reference document</span>
            <Button variant="ghost" size="xs" onClick={() => setAdded(false)}>
              Reset
            </Button>
          </div>
        }
      >
        <CollectionEmptyState
          message={t('common.emptyCollection')}
          action={
            <Button variant="ghost" size="xs" onClick={() => setAdded(true)}>
              <Plus class="size-4" />
              {t('common.add')}
            </Button>
          }
        />
      </Show>
    </div>
  );
}
// #endregion

// #region demo:read-only
function ReadOnlyDemo() {
  return (
    <CollectionEmptyState
      class="max-w-sm"
      message="No reference documents have been added."
    />
  );
}
// #endregion

export default defineDoc({
  name: 'CollectionEmptyState',
  category: 'Feedback',
  status: 'beta',
  exports: ['CollectionEmptyState'],
  import: "import { Button, CollectionEmptyState } from '@ui';",
  description:
    'A compact, single-line empty collection message with an optional trailing action. The caller owns loading, permissions, and any expanded drag-and-drop state.',
  demos: [
    {
      id: 'editable',
      title: 'Editable collection',
      description: 'The Add action updates local preview state only.',
      render: EditableDemo,
    },
    {
      id: 'read-only',
      title: 'Custom copy without an action',
      render: ReadOnlyDemo,
    },
  ],
});
