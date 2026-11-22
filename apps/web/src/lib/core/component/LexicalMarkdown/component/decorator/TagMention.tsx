import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { useIsAuthenticated } from '@core/auth';
import {
  $isTagMentionNode,
  HISTORIC_TAG,
  SKIP_DOM_SELECTION_TAG,
  SKIP_SCROLL_INTO_VIEW_TAG,
  type TagMentionDecoratorProps,
} from '@macro-inc/lexical-core';
import { TagDot } from '@property/tags/TagDot';
import { navigateToTag } from '@property/tags/tagNavigation';
import { useTagsQuery } from '@queries/properties/tags';
import {
  $getNodeByKey,
  COMMAND_PRIORITY_NORMAL,
  KEY_ENTER_COMMAND,
} from 'lexical';
import { createEffect, createMemo, useContext } from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import type { TagMentionHostProp } from '../../decorator-host/tag-mention-host';
import { autoRegister } from '../../plugins';
import { MentionTooltip } from './MentionTooltip';

function optionLabel(value: unknown): string | undefined {
  if (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'string' &&
    'value' in value &&
    typeof value.value === 'string'
  ) {
    return value.value;
  }
  return undefined;
}

/**
 * Source `importJSON` and `decorate` hand a stored color over unchanged, so an
 * explicit null reaches this component. Ids, scope and name stay required:
 * Source fails the whole document on a null name, and opening a tag needs ids.
 */
export type TagMentionUIProps = Omit<TagMentionDecoratorProps, 'color'> & {
  color?: string | null;
} & TagMentionHostProp;

export function TagMention(props: TagMentionUIProps) {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const editor = lexicalWrapper?.editor;
  const selection = () => lexicalWrapper?.selection;
  const tagsQuery = useTagsQuery();
  const split = useSplitLayout();
  const panel = useSplitPanel();
  const isAuthenticated = useIsAuthenticated();

  const isSelectedAsNode = createMemo(() => {
    if (props.host) return props.host.isSelected(props.key);
    const sel = selection();
    if (!sel) return false;
    return sel.type === 'node' && sel.nodeKeys.has(props.key);
  });

  const resolvedOption = createMemo(() => {
    for (const set of tagsQuery.data ?? []) {
      for (const option of set.options) {
        if (option.id !== props.optionId) continue;
        return {
          optionId: option.id,
          propertyDefinitionId: option.propertyDefinitionId,
          scope: set.scope,
          name: optionLabel(option.value) ?? props.name,
          color: option.color ?? undefined,
        };
      }
    }
    return undefined;
  });
  const resolvedTag = () => resolvedOption() ?? props;

  createEffect(() => {
    const tag = resolvedOption();
    // An unresolved tag shows the stored props, which never differ from themselves.
    if (
      !tag ||
      (tag.propertyDefinitionId === props.propertyDefinitionId &&
        tag.scope === props.scope &&
        tag.name === props.name &&
        tag.color === props.color)
    ) {
      return;
    }

    if (props.host) {
      props.host.setTagInfo(props.key, {
        propertyDefinitionId: tag.propertyDefinitionId,
        scope: tag.scope,
        name: tag.name,
        color: tag.color,
      });
      return;
    }
    editor?.update(
      () => {
        const node = $getNodeByKey(props.key);
        if (!$isTagMentionNode(node)) return;
        node.setTagInfo({
          propertyDefinitionId: tag.propertyDefinitionId,
          scope: tag.scope,
          name: tag.name,
          color: tag.color,
        });
      },
      {
        tag: [HISTORIC_TAG, SKIP_DOM_SELECTION_TAG, SKIP_SCROLL_INTO_VIEW_TAG],
        discrete: true,
      }
    );
  });

  const open = () => {
    if (isAuthenticated() !== true) return;

    const tag = resolvedTag();
    navigateToTag(split.openWithSplit, tag, { handle: panel?.handle });
  };

  const onEnter = (event: KeyboardEvent | null) => {
    if (!isSelectedAsNode()) return false;
    event?.preventDefault();
    event?.stopPropagation();
    open();
    return true;
  };
  if (props.host) {
    autoRegister(props.host.registerNormalEnter(onEnter));
  } else if (editor) {
    autoRegister(
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        onEnter,
        COMMAND_PRIORITY_NORMAL
      )
    );
  }

  return (
    <span class="relative">
      <span
        data-tag-mention="true"
        data-tag-option-id={props.optionId}
        data-tag-property-definition-id={resolvedTag().propertyDefinitionId}
        data-tag-name={resolvedTag().name}
        data-tag-scope={resolvedTag().scope}
        data-tag-color={resolvedTag().color}
        class="pointer-events-auto p-0.5 cursor-default rounded-xs hover:bg-hover focus:bg-active"
        classList={{ 'bg-active text-ink': isSelectedAsNode() }}
        onClick={(event) => {
          event.stopPropagation();
          open();
        }}
      >
        <span class="relative inline-flex -top-px mr-1">
          {/* TagDot reads a missing color with `??`, so null and undefined match. */}
          <TagDot
            color={resolvedTag().color ?? undefined}
            class="size-[0.5em]"
          />
        </span>
        <span class="text-ink underline decoration-current/20 decoration-[max(1px,0.1em)] underline-offset-2">
          {resolvedTag().name}
        </span>
      </span>
      <MentionTooltip show={isSelectedAsNode()} text="Open" />
    </span>
  );
}
