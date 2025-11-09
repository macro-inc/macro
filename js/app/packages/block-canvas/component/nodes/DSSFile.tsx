import { useToolManager } from '@block-canvas/signal/toolManager';
import { useRenderState } from '@block-canvas/store/RenderState';
import { withAnalytics } from '@coparse/analytics';
import { type BlockName, useBlockId } from '@core/block';
import { CircleSpinner } from '@core/component/CircleSpinner';
import { PopupPreview } from '@core/component/DocumentPreview';
import { EntityIcon } from '@core/component/EntityIcon';
import { floatWithElement } from '@core/component/LexicalMarkdown/directive/floatWithElement';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type PreviewItemNoAccess, useItemPreview } from '@core/signal/preview';
import { matches } from '@core/util/match';
import LockKey from '@phosphor-icons/core/regular/lock-key.svg';
import Question from '@phosphor-icons/core/regular/question.svg';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import { debounce } from '@solid-primitives/scheduled';
import { createEffect, createSignal, Match, Show, Switch } from 'solid-js';
import { useSplitLayout } from '../../../app/component/split-layout/layout';
import { DRAG_THRESHOLD, type RenderMode, Tools } from '../../constants';
import type { FileNode } from '../../model/CanvasModel';
import { fileWidth } from '../../operation/file';
import { type Vector2, vec2 } from '../../util/vector2';
import { BaseCanvasRectangle } from './BaseCanvasRectangle';

false && floatWithElement;

const { track, TrackingEvents } = withAnalytics();

function ErrorMessage(props: {
  node: FileNode;
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

export function File(props: { node: FileNode; mode: RenderMode }) {
  let fileRef!: HTMLDivElement;

  const [error, setError] = createSignal<
    'UNAUTHORIZED' | 'MISSING' | 'INVALID' | 'LOADING' | undefined
  >('LOADING');

  const [fileName, setFileName] = createSignal<string>();
  const [fileType, setFileType] = createSignal<FileType | 'chat'>();
  const [blockName, setBlockName] = createSignal<string>();
  const blockId = useBlockId();

  const [previewOpen, setPreviewOpen] = createSignal(false);
  const debouncedSetPreviewOpen = debounce(setPreviewOpen, 100);

  const { replaceOrInsertSplit } = useSplitLayout();

  const [selfMouseDownPosition, setSelfMouseDownPosition] =
    createSignal<Vector2>();

  const [item] = useItemPreview({
    id: props.node.file,
    type: props.node.isChat
      ? 'chat'
      : props.node.isProject
        ? 'project'
        : 'document',
  });

  createEffect(() => {
    const _item = item();
    if (_item.loading) {
      setError('LOADING');
      return;
    }
    if ((_item as PreviewItemNoAccess).access === 'no_access') {
      setError('UNAUTHORIZED');
      return;
    }
    if (_item.access === 'does_not_exist') {
      setError('MISSING');
      return;
    }
    if (_item.access === 'access') {
      setError();
      if (_item.type === 'document') {
        setFileName(_item.name);
        setFileType(_item.fileType);
        setBlockName(fileTypeToBlockName(_item.fileType!));
      } else if (_item.type === 'chat') {
        setFileName(_item.name);
        setFileType('chat');
        setBlockName('chat');
        setError();
      } else if (_item.type === 'project') {
        setFileName(_item.name);
        setFileType('project' as FileType);
        setBlockName('project');
        setError();
      }
    }
  });

  const { selectedTool, mouseIsDown, activeTool } = useToolManager();
  return (
    <div
      class="document-mention internal-link"
      onMouseEnter={() => {
        if (!isTouchDevice && !mouseIsDown() && selectedTool() !== Tools.Line) {
          debouncedSetPreviewOpen(true);
        }
      }}
      onMouseLeave={() => {
        if (!isTouchDevice) {
          debouncedSetPreviewOpen.clear();
          debouncedSetPreviewOpen(false);
        }
      }}
      ontouchstart={(e) => {
        if (isTouchDevice) {
          e.preventDefault();
        }
      }}
      ontouchend={(e) => {
        if (isTouchDevice) {
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
          when={!error() && fileType()}
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
                    <EntityIcon targetType={fileType()} size={'fill'} />
                  </div>
                  {fileName()}
                </div>
                <Show when={previewOpen()}>
                  <PopupPreview
                    item={item}
                    floatRef={fileRef}
                    mouseEnter={() => {
                      debouncedSetPreviewOpen(true);
                    }}
                    mouseLeave={() => {
                      debouncedSetPreviewOpen.clear();
                      debouncedSetPreviewOpen(false);
                    }}
                    documentInfo={{
                      id: props.node.file,
                      type: blockName() as BlockName,
                      params: {},
                      isOpenable: blockId !== props.node.file,
                    }}
                  />
                </Show>
              </div>
            </div>
          </div>
        </Show>
      </BaseCanvasRectangle>
    </div>
  );
}
