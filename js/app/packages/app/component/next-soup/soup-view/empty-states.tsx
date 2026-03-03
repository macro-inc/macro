import { useHandleFileUpload } from '@app/util/handleFileUpload';
import { useMaybeBlockId, useMaybeBlockName } from '@core/block';
import { fileSelector } from '@core/directive/fileSelector';
import { folderSelector } from '@core/directive/folderSelector';
import { useEmailLinksStatus } from '@core/email-link';
import { isMobile } from '@core/mobile/isMobile';
import type { ViewId } from '@core/types/view';
import { handleFolderSelect } from '@core/util/upload';
import { createMemo, Match, Show, Switch } from 'solid-js';
import Arcanum001 from '@macro-icons/arcanum/arcanum-001.svg';
import Arcanum002 from '@macro-icons/arcanum/arcanum-002.svg';
import Arcanum004 from '@macro-icons/arcanum/arcanum-004.svg';
import Arcanum005 from '@macro-icons/arcanum/arcanum-005.svg';
import Arcanum006 from '@macro-icons/arcanum/arcanum-006.svg';
import Arcanum007 from '@macro-icons/arcanum/arcanum-007.svg';
import Arcanum009 from '@macro-icons/arcanum/arcanum-009.svg';

false && fileSelector;
false && folderSelector;

const DEFAULT_EMPTY_MESSAGE = 'No items to show.';

function getRandomArcanumGraphic() {
  const graphicStyle = 'h-72 m-8 mt-32 @max-sm:mt-20 opacity-60';
  const arcanumGraphics = [
    <Arcanum001 class={graphicStyle} />,
    <Arcanum002 class={graphicStyle} />,
    <Arcanum004 class={graphicStyle} />,
    <Arcanum005 class={graphicStyle} />,
    <Arcanum006 class={graphicStyle} />,
    <Arcanum007 class={graphicStyle} />,
    <Arcanum009 class={graphicStyle} />,
  ];
  const randomIndex = Math.floor(Math.random() * arcanumGraphics.length);
  return arcanumGraphics[randomIndex];
}

export function EmptyState(props: {
  viewId?: ViewId;
  search?: boolean;
  hasRefinementsFromBase?: boolean;
  onClearFilters?: () => void;
}) {
  const emailActive = useEmailLinksStatus();

  return (
    <Switch>
      <Match when={props.search}>
        <EmptyStateInner message={'No results.'} />
      </Match>
      <Match when={props.hasRefinementsFromBase}>
        <EmptyStateInner
          message="No items match your filters."
          cta={
            props.onClearFilters
              ? { label: 'Clear filters', onClick: props.onClearFilters }
              : undefined
          }
        />
      </Match>
      <Match when={props.viewId === 'noise' && !emailActive()}>
        <EmptyStateInner message={'Email not connected.'} />
      </Match>
      <Match
        when={
          (props.viewId === 'noise' ||
            props.viewId === 'signal' ||
            props.viewId === 'email') &&
          emailActive()
        }
      >
        <EmptyStateInner message={'Inbox zero.'} />
      </Match>
      <Match when={props.viewId === 'signal' && !emailActive()}>
        <EmptyStateInner message={'Nothing to show. Email not connected.'} />
      </Match>
      <Match when={props.viewId === 'email' && !emailActive()}>
        <EmptyStateInner message={'Nothing to show. Email not connected.'} />
      </Match>
      <Match when={props.viewId === 'people'}>
        <EmptyStateInner message={'No messages to show.'} />
      </Match>
      <Match when={props.viewId === 'files'}>
        <EmptyStateInner message={'No files to show.'} showDropZone />
      </Match>
      <Match when={props.viewId === 'folders'}>
        <EmptyStateInner message={'No folders to show.'} showDropZone />
      </Match>
      <Match when={props.viewId === 'tasks'}>
        <EmptyStateInner message={'No tasks to show.'} />
      </Match>
      <Match when={props.viewId === 'all'}>
        <EmptyStateInner />
      </Match>
      <Match when={true}>
        <EmptyStateInner />
      </Match>
    </Switch>
  );
}

export interface EmptyStateInnerProps {
  message?: string;
  showDropZone?: boolean;
  cta?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyStateInner(props: EmptyStateInnerProps) {
  const blockName = useMaybeBlockName();
  const blockId = useMaybeBlockId();
  const projectId = createMemo(() => {
    if (blockName === 'project' && blockId) {
      return blockId;
    }
    return undefined;
  });

  const handleFileUpload = useHandleFileUpload({ projectId: projectId() });

  return (
    <div class="size-full flex items-center justify-center p-4 text-ink-muted">
      <div class="panel w-full flex flex-col items-center size-full">
        {getRandomArcanumGraphic()}
        <p class="text-ink-muted font-mono">
          {props.message ?? DEFAULT_EMPTY_MESSAGE}
        </p>
        <Show when={props.cta}>
          {(cta) => (
            <div class="w-full flex justify-center pt-4">
              <button
                onMouseDown={cta().onClick}
                class="py-2 px-4 rounded-md bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
              >
                <span class="font-medium text-sm">{cta().label}</span>
              </button>
            </div>
          )}
        </Show>
        <Show when={props.showDropZone && !isMobile()}>
          <div class="drop-zone flex flex-col items-center justify-center w-full py-8 border border-dashed border-edge-muted bg-hover">
            <p class="text-ink-muted">Drag & drop files and folders here</p>
            <p class="text-ink-muted">
              or{' '}
              <span
                use:fileSelector={{
                  multiple: true,
                  onSelect: (files) => {
                    handleFileUpload(files);
                  },
                }}
                class="underline cursor-pointer"
              >
                Upload files
              </span>{' '}
              /{' '}
              <span
                use:folderSelector={{
                  onSelect: async (files) => {
                    await handleFolderSelect(files, handleFileUpload);
                  },
                }}
                class="underline cursor-pointer"
              >
                Upload folders
              </span>
            </p>
            <p class="text-ink-muted"></p>
          </div>
        </Show>
      </div>
    </div>
  );
}
