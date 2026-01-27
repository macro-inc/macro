import { useMaybeBlockId } from '@core/block';
import { PopupPreview } from '@core/component/DocumentPreview';
import {
  EntityIcon,
  type EntityIconSelector,
} from '@core/component/EntityIcon';
import { verifyBlockName } from '@core/constant/allBlocks';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { isAccessiblePreviewItem, useItemPreview } from '@queries/preview';
import { matches } from '@core/util/match';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import EyeSlashDuo from '@icon/duotone/eye-slash-duotone.svg';
import TrashSimple from '@icon/duotone/trash-simple-duotone.svg';
import LoadingSpinner from '@icon/regular/spinner.svg';
import { $isSnapshotNode, type SnapshotDecoratorProps } from '@lexical-core';
import { blockNameToItemType } from '@service-storage/client';
import { createCallback } from '@solid-primitives/rootless';
import { debounce } from '@solid-primitives/scheduled';
import {
  $getNodeByKey,
  COMMAND_PRIORITY_NORMAL,
  KEY_ENTER_COMMAND,
} from 'lexical';
import type { JSX } from 'solid-js';
import { createMemo, createSignal, Show, useContext } from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { autoRegister } from '../../plugins';
import { openDocument } from '../core/BlockLink';
import { MentionTooltip } from './MentionTooltip';

function MentionContainer(props: { icon: JSX.Element; text: JSX.Element }) {
  return (
    <span class="pointer-events-auto">
      <span class="relative top-[0.125em] size-[1em] inline-flex mx-1">
        {props.icon}
      </span>
      <span class="underline decoration-current/20 decoration-[max(1px,0.1em)] underline-offset-2">
        {props.text}
      </span>
    </span>
  );
}

function Spinner() {
  return (
    <div class="animate-spin">
      <LoadingSpinner />
    </div>
  );
}

function Loading() {
  return <MentionContainer icon={<Spinner />} text="Loading" />;
}

export function Snapshot(props: SnapshotDecoratorProps) {
  const currentBlockId = useMaybeBlockId();

  const lexicalWrapper = useContext(LexicalWrapperContext);
  const editor = lexicalWrapper?.editor;
  const selection = () => lexicalWrapper?.selection;

  let inlinePreviewRef!: HTMLSpanElement;

  const previewType = () =>
    blockNameToItemType(verifyBlockName(props.blockName));

  const [item] = useItemPreview(() => ({
    id: props.documentId,
    type: previewType(),
  }));

  const [popupOpen, setPopupOpen] = createSignal(false);
  const debouncedSetPreviewOpen = debounce(setPopupOpen, 100);

  const isSelectedAsNode = createMemo(() => {
    const sel = selection();
    if (!sel) return false;
    return sel.type === 'node' && sel.nodeKeys.has(props.key);
  });

  const open = createCallback((e: MouseEvent | KeyboardEvent | null) => {
    openDocument(
      props.blockName,
      props.documentId,
      {},
      openInNewSplitForMention(e?.altKey, e != null)
    );
  });

  if (editor) {
    autoRegister(
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (e) => {
          if (isSelectedAsNode()) {
            open(e);
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_NORMAL
      )
    );
  }

  const deleteSnapshot = () => {
    editor?.update(() => {
      const node = $getNodeByKey(props.key);
      if (!$isSnapshotNode(node)) return false;
      node.remove();
      return true;
    });
  };

  const navHandlers = useSplitNavigationHandler<HTMLSpanElement>((e) => {
    e.stopPropagation();
    if (matches(item(), (i) => !i.loading && i.access === 'access')) {
      open(e);
    }
  });

  const renderContent = () => {
    const i = item();

    if (i.loading) {
      return <Loading />;
    }

    if (isAccessiblePreviewItem(i)) {
      return (
        <MentionContainer
          icon={
            <EntityIcon
              targetType={props.blockName as EntityIconSelector}
              size="fill"
            />
          }
          text={props.documentName || 'Untitled'}
        />
      );
    }

    if (i.access === 'no_access') {
      return <MentionContainer icon={<EyeSlashDuo />} text="No Access" />;
    }

    if (i.access === 'does_not_exist') {
      return <MentionContainer icon={<TrashSimple />} text="Deleted" />;
    }

    return (
      <MentionContainer
        icon={
          <EntityIcon
            targetType={props.blockName as EntityIconSelector}
            size="fill"
          />
        }
        text={props.documentName || 'Untitled'}
      />
    );
  };

  return (
    <>
      <span class="relative">
        <span
          class="w-full h-full py-0.5 cursor-default rounded-xs hover:bg-hover focus:bg-active"
          classList={{
            'bg-active text-ink bracket bracket-offset-2': isSelectedAsNode(),
          }}
          style={{
            'user-select': 'inherit',
          }}
          ref={inlinePreviewRef}
          onMouseEnter={() => {
            if (!isTouchDevice()) {
              debouncedSetPreviewOpen(true);
            }
          }}
          onMouseLeave={() => {
            if (!isTouchDevice()) {
              debouncedSetPreviewOpen.clear();
              debouncedSetPreviewOpen(false);
            }
          }}
          ontouchstart={(e) => {
            if (isTouchDevice()) {
              e.preventDefault();
            }
          }}
          ontouchend={(e) => {
            if (isTouchDevice()) {
              e.preventDefault();
              if (matches(item(), (i) => !i.loading && i.access === 'access')) {
                open(null);
              }
            }
          }}
          {...navHandlers}
        >
          {renderContent()}
        </span>
        <MentionTooltip show={isSelectedAsNode()} text="Open" />
      </span>

      <Show when={popupOpen()}>
        <PopupPreview
          item={item}
          floatRef={inlinePreviewRef}
          mouseEnter={() => {
            debouncedSetPreviewOpen(true);
          }}
          mouseLeave={() => {
            debouncedSetPreviewOpen.clear();
            debouncedSetPreviewOpen(false);
          }}
          delete={editor?.isEditable() ? deleteSnapshot : undefined}
          documentInfo={{
            id: props.documentId,
            type: verifyBlockName(props.blockName),
            params: {},
            isOpenable: currentBlockId !== props.documentId,
          }}
          snapshotInfo={{
            date: props.snapshotDate || new Date().toISOString(),
            characterCount: props.content.length,
          }}
        />
      </Show>
    </>
  );
}
