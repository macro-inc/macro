import { useEmailLinksStatus } from '@app/signal/onboarding/email-link';
import { useHandleFileUpload } from '@app/util/handleFileUpload';

import { useMaybeBlockId, useMaybeBlockName } from '@core/block';
import { fileSelector } from '@core/directive/fileSelector';
import { folderSelector } from '@core/directive/folderSelector';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import type { ViewId } from '@core/types/view';
import { handleFolderSelect } from '@core/util/upload';
import { createMemo, Match, onMount, Show, Switch } from 'solid-js';
import { useSplitPanelOrThrow } from './split-layout/layoutUtils';

false && fileSelector;
false && folderSelector;

export function EmptyState(props: { viewId?: ViewId }) {
  const emailActive = useEmailLinksStatus();
  const splitPanelContext = useSplitPanelOrThrow();
  const {
    unifiedListContext: { setShowHelpDrawer },
  } = splitPanelContext;
  return (
    <Switch>
      <Match when={props.viewId === 'emails' && !emailActive()}>
        {(_) => {
          onMount(() =>
            setShowHelpDrawer((prev) => new Set([...prev, 'emails']))
          );
          return <EmptyStateInner emptyMessage={'Email not connected.'} />;
        }}
      </Match>
      <Match
        when={
          (props.viewId === 'emails' || props.viewId === 'inbox') &&
          emailActive()
        }
      >
        <EmptyStateInner emptyMessage={'Inbox zero.'} />
      </Match>
      <Match when={props.viewId === 'inbox' && !emailActive()}>
        {(_) => {
          onMount(() =>
            setShowHelpDrawer((prev) => new Set([...prev, 'inbox']))
          );
          return (
            <EmptyStateInner
              emptyMessage={'Nothing to show. Email not connected.'}
            />
          );
        }}
      </Match>
      <Match when={props.viewId === 'comms'}>
        {(_) => {
          onMount(() =>
            setShowHelpDrawer((prev) => new Set([...prev, 'comms']))
          );
          return <EmptyStateInner emptyMessage={'No messages to show.'} />;
        }}
      </Match>
      <Match when={props.viewId === 'docs'}>
        {(_) => {
          onMount(() =>
            setShowHelpDrawer((prev) => new Set([...prev, 'docs']))
          );
          return <EmptyStateInner showDropZone />;
        }}
      </Match>
      <Match when={props.viewId === 'ai'}>
        {(_) => {
          onMount(() => setShowHelpDrawer((prev) => new Set([...prev, 'ai'])));
          return <EmptyStateInner emptyMessage={'No AI chats to show.'} />;
        }}
      </Match>
      <Match when={props.viewId === 'folders'}>
        {(_) => {
          onMount(() =>
            setShowHelpDrawer((prev) => new Set([...prev, 'folders']))
          );
          return <EmptyStateInner showDropZone />;
        }}
      </Match>
      <Match when={true}>
        <EmptyStateInner showDropZone />
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
