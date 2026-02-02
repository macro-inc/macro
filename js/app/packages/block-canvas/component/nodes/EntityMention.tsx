import { useToolManager } from '@block-canvas/signal/toolManager';
import { useRenderState } from '@block-canvas/store/RenderState';
import { withAnalytics } from '@coparse/analytics';
import { type BlockName, useBlockId } from '@core/block';
import { CircleSpinner } from '@core/component/CircleSpinner';
import { PopupPreview } from '@core/component/DocumentPreview';
import { EntityIcon } from '@core/component/EntityIcon';
import { itemToBlockName } from '@core/constant/allBlocks';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type PreviewItemNoAccess, useItemPreview } from '@queries/preview';
import { matches } from '@core/util/match';
import LockKey from '@phosphor-icons/core/regular/lock-key.svg';
import Question from '@phosphor-icons/core/regular/question.svg';
import {
  createEffect,
  createMemo,
  createSignal,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { HoverCard } from '@kobalte/core/hover-card';
import { useSplitLayout } from 'app/component/split-layout/layout';
import { DRAG_THRESHOLD, type RenderMode, Tools } from '../../constants';
import type { EntityMentionNode } from '../../model/CanvasModel';
import { fileWidth } from '../../operation/file';
import { type Vector2, vec2 } from '../../util/vector2';
import { BaseCanvasRectangle } from './BaseCanvasRectangle';

const { track, TrackingEvents } = withAnalytics();

function ErrorMessage(props: {
  node: EntityMentionNode;
  error: 'UNAUTHORIZED' | 'MISSING' | 'INVALID' | 'LOADING' | undefined;
}) {
  const { currentScale } = useRenderState();
  return (
    <div
      class="w-full h-full bg-menu/40 rounded border border-dashed border-edge"
      style={{
        'font-size': 12 * (props.node.width / fileWidth) + 'px',
        'background-size':
          15 / currentScale() + 'px ' + 15 / currentScale() + 'px',
        'background-blend-mode': 'lighten',
        'background-image':
          props.error === 'LOADING'
            ? 'none'
            : 'linear-gradient(-45deg, transparent 10%, var(--color-gray-100) 10%, var(--color-gray-100) 20%, transparent 10%, transparent 60%, var(--color-gray-100) 60%, var(--color-gray-100) 70%, transparent 70%, transparent)',
      }}
    >
      <Switch>
        <Match when={props.error === 'UNAUTHORIZED'}>
          <div class="w-full h-full flex flex-row items-center">
            <LockKey
              width={18 * (props.node.width / fileWidth) + 'px'}
              class="mx-1 fill-failure bg-menu rounded-full"
            />
            Unauthorized: Invalid file permissions
          </div>
        </Match>
        <Match when={props.error === 'MISSING'}>
          <div class="w-full h-full flex flex-row items-center px-2">
            <Question
              width={18 * (props.node.width / fileWidth) + 'px'}
              class="mx-1 fill-ink-extra-muted bg-menu rounded-full"
            />
            Error: Missing file
          </div>
        </Match>
        <Match when={props.error === 'INVALID'}>
          <div class="w-full h-full flex flex-row items-center px-2">
            <Question
              width={18 * (props.node.width / fileWidth) + 'px'}
              class="mx-1 fill-ink-extra-muted bg-menu rounded-full"
            />
            Error: Invalid file
          </div>
        </Match>
        <Match when={props.error === 'LOADING'}>
          <div class="w-full h-full flex items-center justify-center">
            <CircleSpinner />
          </div>
        </Match>
      </Switch>
    </div>
  );
}

export function File(props: { node: EntityMentionNode; mode: RenderMode }) {
  let fileRef!: HTMLDivElement;

  const [error, setError] = createSignal<
    'UNAUTHORIZED' | 'MISSING' | 'INVALID' | 'LOADING' | undefined
  >('LOADING');

  const blockId = useBlockId();

  const { replaceOrInsertSplit } = useSplitLayout();

  const [selfMouseDownPosition, setSelfMouseDownPosition] =
    createSignal<Vector2>();

  const [item] = useItemPreview(() => ({
    id: props.node.file,
    type: props.node.entityType,
  }));

  createEffect(() => {
    const currentItem = item();
    if (currentItem.loading) {
      setError('LOADING');
      return;
    }
    if ((currentItem as PreviewItemNoAccess).access === 'no_access') {
      setError('UNAUTHORIZED');
      return;
    }
    if (currentItem.access === 'does_not_exist') {
      setError('MISSING');
      return;
    }
    if (currentItem.access === 'access') {
      setError();
    }
  });

  // Get icon type using the same logic as EntityWithEverything
  const iconType = createMemo(() => {
    const currentItem = item();
    if (
      !currentItem ||
      currentItem.loading ||
      currentItem.access !== 'access'
    ) {
      return 'default';
    }

    switch (currentItem.type) {
      case 'channel':
        switch (currentItem.channelType) {
          case 'direct_message':
            return 'directMessage';
          case 'organization':
            return 'company';
          default:
            return 'channel';
        }
      case 'document':
        // TODO: consolidate is task logic, see isTaskEntity
        if (
          currentItem.fileType === 'md' &&
          currentItem.subType?.type === 'task'
        ) {
          return 'task';
        }
        if (currentItem.fileType) return currentItem.fileType;
        return 'default';
      case 'chat':
        return 'chat';
      case 'project':
        return 'project';
      case 'email':
        return 'email';
      default:
        return 'default';
    }
  });

  const fileName = createMemo(() => {
    const currentItem = item();
    if (
      !currentItem ||
      currentItem.loading ||
      currentItem.access !== 'access'
    ) {
      return '';
    }
    return currentItem.name;
  });

  const blockName = createMemo(() => {
    const currentItem = item();
    if (
      !currentItem ||
      currentItem.loading ||
      currentItem.access !== 'access'
    ) {
      return undefined;
    }
    return itemToBlockName(currentItem);
  });

  const { selectedTool, mouseIsDown, activeTool } = useToolManager();

  const hoverDisabled = createMemo(
    () => isTouchDevice() || mouseIsDown() || selectedTool() === Tools.Line
  );

  const triggerContent = (
    <div
      class="document-mention internal-link"
      ontouchstart={(e) => {
        if (isTouchDevice()) {
          e.preventDefault();
        }
      }}
      ontouchend={(e) => {
        if (isTouchDevice()) {
          e.preventDefault();
          if (matches(item(), (i) => !i.loading && i.access === 'access')) {
            replaceOrInsertSplit({
              type: blockName() as BlockName,
              id: props.node.file,
            });
            track(TrackingEvents.BLOCKCANVAS.FILES.OPENFILESIDE);
          }
        }
      }}
      on:pointerdown={(e) => {
        setSelfMouseDownPosition(vec2(e.pageX, e.pageY));
      }}
      on:click={(e) => {
        if (activeTool() !== Tools.Select && activeTool() !== Tools.Grab) {
          return;
        }
        const pos = selfMouseDownPosition();
        if (pos && pos.distance(vec2(e.pageX, e.pageY)) > DRAG_THRESHOLD) {
          return;
        }
        e.stopPropagation();
        if (matches(item(), (i) => !i.loading && i.access === 'access')) {
          replaceOrInsertSplit({
            type: blockName() as BlockName,
            id: props.node.file,
          });
          track(TrackingEvents.BLOCKCANVAS.FILES.OPENFILESIDE);
        }
      }}
    >
      <BaseCanvasRectangle
        node={props.node}
        mode={props.mode}
        clickable={true}
        useSimpleSelectionBox={true}
      >
        <Show
          when={!error()}
          fallback={<ErrorMessage error={error()} node={props.node} />}
        >
          <div
            ref={fileRef}
            class={`w-full h-full bg-panel rounded-lg shadow-md flex items-center`}
          >
            <div class="flex flex-row p-2 truncate">
              <div
                class="font-semibold text-sm"
                style={{
                  'font-size': 12 * (props.node.width / fileWidth) + 'px',
                }}
              >
                <div class="flex flex-row items-center">
                  <div
                    style={{
                      'margin-left': 2 * (props.node.width / fileWidth) + 'px',
                      'margin-right': 2 * (props.node.width / fileWidth) + 'px',
                      width: 18 * (props.node.width / fileWidth) + 'px',
                      height: 18 * (props.node.width / fileWidth) + 'px',
                    }}
                  >
                    <EntityIcon targetType={iconType()} size={'fill'} />
                  </div>
                  {fileName()}
                </div>
              </div>
            </div>
          </div>
        </Show>
      </BaseCanvasRectangle>
    </div>
  );

  return (
    <Show when={!hoverDisabled()} fallback={triggerContent}>
      <HoverCard openDelay={100} closeDelay={150} gutter={8}>
        <HoverCard.Trigger as="div">{triggerContent}</HoverCard.Trigger>

        <Show when={blockName()}>
          <HoverCard.Portal>
            <HoverCard.Content class="z-toast-region">
              <PopupPreview
                item={item}
                floatRef={fileRef}
                mouseEnter={() => {}}
                mouseLeave={() => {}}
                documentInfo={{
                  id: props.node.file,
                  type: blockName() as BlockName,
                  params: {},
                  isOpenable: blockId !== props.node.file,
                }}
              />
            </HoverCard.Content>
          </HoverCard.Portal>
        </Show>
      </HoverCard>
    </Show>
  );
}
