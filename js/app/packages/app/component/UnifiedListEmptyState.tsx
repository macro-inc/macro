import { useHandleFileUpload } from '@app/util/handleFileUpload';
import { useMaybeBlockId, useMaybeBlockName } from '@core/block';
import { fileSelector } from '@core/directive/fileSelector';
import { folderSelector } from '@core/directive/folderSelector';
import { useEmailLinksStatus } from '@core/email-link';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import type { DefaultView, ViewId } from '@core/types/view';
import { handleFolderSelect } from '@core/util/upload';
import { createMemo, Match, onCleanup, onMount, Show, Switch } from 'solid-js';
import { useSplitPanelOrThrow } from './split-layout/layoutUtils';

false && fileSelector;
false && folderSelector;

const EMPTY_STATE_HELP_DRAWER_TIMEOUT_MS = 0;

const DEFAULT_EMPTY_MESSAGE = 'No items to show.';

function EmptyStateHelpDrawer(props: {
  message?: string;
  helpDrawer: DefaultView;
  showDropZone?: boolean;
}) {
  const {
    unifiedListContext: { setShowHelpDrawer },
  } = useSplitPanelOrThrow();

  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  // because the empty state can sometimes be mounted and unmounted rapidly, we need to
  // ensure that the help drawer is only shown when this state is stable
  onMount(() => {
    timeoutId = setTimeout(() => {
      setShowHelpDrawer((prev) => new Set([...prev, props.helpDrawer]));
    }, EMPTY_STATE_HELP_DRAWER_TIMEOUT_MS);
  });
  onCleanup(() => {
    clearTimeout(timeoutId);
  });

  return (
    <EmptyStateInner
      message={props.message}
      showDropZone={props.showDropZone}
    />
  );
}

export function EmptyState(props: {
  viewId?: ViewId;
  search?: boolean;
  hasRefinementsFromBase?: boolean;
}) {
  const emailActive = useEmailLinksStatus();

  return (
    <Switch>
      <Match when={props.search}>
        <EmptyStateInner message={'No results.'} />
      </Match>
      <Match when={props.hasRefinementsFromBase}>
        <EmptyStateInner />
      </Match>
      <Match when={props.viewId === 'noise' && !emailActive()}>
        <EmptyStateHelpDrawer
          message={'Email not connected.'}
          helpDrawer={'noise'}
        />
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
        <EmptyStateHelpDrawer
          message={'Nothing to show. Email not connected.'}
          helpDrawer={'signal'}
        />
      </Match>
      <Match when={props.viewId === 'email' && !emailActive()}>
        <EmptyStateHelpDrawer
          message={'Nothing to show. Email not connected.'}
          helpDrawer={'email'}
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
      <div class="panel w-full flex flex-col size-full">
        <p class="text-ink-muted font-mono">
          {props.message ?? DEFAULT_EMPTY_MESSAGE}
        </p>
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
