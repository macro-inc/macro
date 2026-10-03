import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableDatabases } from '@core/constant/featureFlags';
import {
  $createDatabaseQueryNode,
  $isDatabaseQueryNode,
  type DatabaseQueryDecoratorProps,
} from '@macro-inc/lexical-core/nodes/DatabaseQueryNode';
import type { DatabaseQueryData } from '@macro-inc/lexical-core/nodes/databaseQueryData';
import { cn } from '@ui';
import {
  $createNodeSelection,
  $createParagraphNode,
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  $isParagraphNode,
  $setSelection,
} from 'lexical';
import {
  createSignal,
  lazy,
  onCleanup,
  Show,
  Suspense,
  splitProps,
  useContext,
} from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { LazyDecorator } from './LazyDecorator';

/** Presses on these do their own thing instead of selecting the block. */
const BLOCK_CONTROLS =
  'button, a, input, select, textarea, summary, label, [role="button"], [role="menuitem"], [role="checkbox"], [data-mention], [contenteditable="true"]';

const LiveQuestion = lazy(async () => {
  const module = await import('@app/features/database-query/database-query');
  return { default: module.DatabaseLiveQuestion };
});

export function DatabaseQuery(props: DatabaseQueryDecoratorProps) {
  const enabled = useFeatureFlag(enableDatabases);
  const wrapper = useContext(LexicalWrapperContext);
  const [editable, setEditable] = createSignal(
    wrapper?.editor.isEditable() ?? false
  );
  // Lexical calls a listener's return value as its cleanup, so the setter's
  // returned boolean must not leak out.
  if (wrapper)
    onCleanup(
      wrapper.editor.registerEditableListener((value) => {
        setEditable(value);
      })
    );
  const canEdit = () => editable() && !!wrapper?.isInteractable();
  const isSelectedAsNode = () => {
    const selection = wrapper?.selection;
    return selection?.type === 'node' && selection.nodeKeys.has(props.key);
  };
  const selectBlock = () => {
    if (!wrapper) return;
    const root = wrapper.editor.getRootElement();
    if (root && document.activeElement !== root)
      root.focus({ preventScroll: true });
    wrapper.editor.update(() => {
      const current = $getSelection();
      if (
        $isNodeSelection(current) &&
        current.getNodes().length === 1 &&
        current.has(props.key)
      )
        return;
      const selection = $createNodeSelection();
      selection.add(props.key);
      $setSelection(selection);
    });
  };
  /** A press on the block itself, not on one of its controls or on anything portaled out of it. */
  const isBlockPress = (event: MouseEvent & { currentTarget: Element }) => {
    if (event.button !== 0 || !wrapper || !editable()) return false;
    const target = event.target;
    if (!(target instanceof Element) || !event.currentTarget.contains(target))
      return false;
    const control = target.closest(BLOCK_CONTROLS);
    return !control || !event.currentTarget.contains(control);
  };
  // Pressing the block selects it as the arrow keys do. Cancelling the press
  // stops the browser from first placing a caret beside the block; a table
  // cell keeps it so its text can still be selected.
  const selectOnPress = (event: MouseEvent & { currentTarget: Element }) => {
    if (!isBlockPress(event)) return;
    const target = event.target as Element;
    if (!target.closest('td, th')) event.preventDefault();
    selectBlock();
  };
  // Rich text clears a node selection on every click, so the click that ends
  // the press selects the block again, unless it ended a text selection.
  const selectOnClick = (event: MouseEvent & { currentTarget: Element }) => {
    if (!isBlockPress(event)) return;
    const text = document.getSelection();
    if (
      text &&
      !text.isCollapsed &&
      text.anchorNode &&
      event.currentTarget.contains(text.anchorNode)
    )
      return;
    selectBlock();
  };
  const [, source] = splitProps(props, ['key', 'theme']);
  const save = (data: DatabaseQueryData) => {
    if (!canEdit() || !wrapper) return;
    wrapper.editor.update(() => {
      const node = $getNodeByKey(props.key);
      if (!$isDatabaseQueryNode(node)) return;
      if (node.isInline() && data.displayMode !== 'scalar') {
        const parent = node.getParent();
        if ($isParagraphNode(parent) && parent.getChildrenSize() === 1)
          parent.replace($createDatabaseQueryNode(data));
        else {
          node
            .getTopLevelElementOrThrow()
            .insertAfter($createDatabaseQueryNode(data));
          node.remove();
        }
      } else if (!node.isInline() && data.displayMode === 'scalar') {
        node.replace(
          $createParagraphNode().append($createDatabaseQueryNode(data))
        );
      } else node.setQuery(data);
    });
  };
  // An answer inserted from the actions menu and never asked is left behind as
  // an empty block when its editor closes; take it out again.
  const discard = () => {
    if (!canEdit() || !wrapper) return;
    wrapper.editor.update(() => {
      const node = $getNodeByKey(props.key);
      if (!$isDatabaseQueryNode(node)) return;
      // The caret goes back to where the block was inserted.
      node.selectPrevious();
      node.remove();
    });
  };
  const answer = () => (
    <LazyDecorator
      placeholder={placeholder()}
      render={() => (
        <Suspense fallback={placeholder()}>
          <LiveQuestion
            source={source}
            onSave={canEdit() ? save : undefined}
            onDiscard={canEdit() ? discard : undefined}
          />
        </Suspense>
      )}
    />
  );
  const placeholder = () => (
    <span class="mx-0.5 rounded border border-edge-muted bg-hover px-1.5 py-0.5 text-sm text-ink">
      {props.title || props.chart?.title || 'Database answer'}
    </span>
  );
  return (
    <Show
      when={enabled().enabled && !wrapper?.skipPreviewFetch}
      fallback={placeholder()}
    >
      <Show
        when={props.displayMode !== 'scalar'}
        fallback={
          <span
            data-lexical-interactive
            data-database-query-selected={isSelectedAsNode() || undefined}
            class={cn(
              'rounded-lg',
              isSelectedAsNode() && 'ring-3 ring-edge-muted'
            )}
          >
            {answer()}
          </span>
        }
      >
        {/* The block's spacing is padding, not the card's margin, so a press
            beside the card still lands on the block instead of the text
            around it. */}
        <div
          data-lexical-interactive
          class="py-1"
          onMouseDown={selectOnPress}
          onClick={selectOnClick}
        >
          <div
            data-database-query-selected={isSelectedAsNode() || undefined}
            class={cn(
              'rounded-lg',
              isSelectedAsNode() && 'ring-3 ring-edge-muted'
            )}
          >
            {answer()}
          </div>
        </div>
      </Show>
    </Show>
  );
}
