import { useHandleFileUpload } from '@app/util/handleFileUpload';
import { useMaybeBlockId, useMaybeBlockName } from '@core/block';
import { fileSelector } from '@core/directive/fileSelector';
import { folderSelector } from '@core/directive/folderSelector';
import { useEmailLinksStatus } from '@core/email-link';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import type { DefaultView, ViewId } from '@core/types/view';
import { handleFolderSelect } from '@core/util/upload';
import { createMemo, Match, onMount, Show, Switch } from 'solid-js';
import { useSplitPanelOrThrow } from './split-layout/layoutUtils';

false && fileSelector;
false && folderSelector;

function EmptyStateHelpDrawer(props: {
  message?: string;
  helpDrawer: DefaultView;
  showDropZone?: boolean;
}) {
  const {
    unifiedListContext: { setShowHelpDrawer },
  } = useSplitPanelOrThrow();
  onMount(() => {
    setShowHelpDrawer((prev) => new Set([...prev, props.helpDrawer]));
  });
  return (
    <EmptyStateInner
      emptyMessage={props.message}
      showDropZone={props.showDropZone}
    />
  );
}

export function EmptyState(props: { viewId?: ViewId; search?: boolean }) {
  const emailActive = useEmailLinksStatus();

  return (
    <Switch>
      <Match when={props.search}>
        <EmptyStateInner emptyMessage={'No results.'} />
      </Match>
      <Match when={props.viewId === 'noise' && !emailActive()}>
        <EmptyStateHelpDrawer
          message={'Email not connected.'}
          helpDrawer={'noise'}
        />
      </Match>
      <Match
        when={
          (props.viewId === 'noise' || props.viewId === 'signal') &&
          emailActive()
        }
      >
        <EmptyStateInner emptyMessage={'Inbox zero.'} />
      </Match>
      <Match when={props.viewId === 'signal' && !emailActive()}>
        <EmptyStateHelpDrawer
          message={'Nothing to show. Email not connected.'}
          helpDrawer={'signal'}
        />
      </Match>
      <Match when={props.viewId === 'people'}>
        <EmptyStateHelpDrawer
          message={'No messages to show.'}
          helpDrawer={'people'}
        />
      </Match>
      <Match when={props.viewId === 'files'}>
        <EmptyStateHelpDrawer
          message={'No files to show.'}
          helpDrawer={'files'}
          showDropZone
        />
      </Match>
      <Match when={props.viewId === 'folders'}>
        <EmptyStateHelpDrawer
          message={'No folders to show.'}
          helpDrawer={'folders'}
          showDropZone
        />
      </Match>
      <Match when={props.viewId === 'tasks'}>
        <EmptyStateHelpDrawer
          message={'No tasks to show.'}
          helpDrawer={'tasks'}
        />
      </Match>
      <Match when={props.viewId === 'all'}>
        <EmptyStateHelpDrawer
          message={'No items to show.'}
          helpDrawer={'all'}
        />
      </Match>
      <Match when={true}>
        <EmptyStateInner emptyMessage={'No items to show.'} showDropZone />
      </Match>
    </Switch>
  );
}

export interface EmptyStateInnerProps {
  emptyMessage?: string;
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
      <div class="panel w-full flex flex-col size-full">
        <Show when={props.emptyMessage}>
          <p class="text-ink-muted font-mono">{props.emptyMessage}</p>
        </Show>
        <Show when={props.cta}>
          {(cta) => (
            <div class="w-full flex justify-start pt-4">
              <button
                onMouseDown={cta().onClick}
                class="cta py-2 px-2 bg-accent/75 text-panel"
              >
                <span class="font-medium">{cta().label.toUpperCase()}</span>
              </button>
            </div>
          )}
        </Show>
        <Show when={props.showDropZone && !(isTouchDevice && isMobileWidth())}>
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
