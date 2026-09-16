import { FindAndReplace } from '@block-md/component/FindAndReplace';
import {
  MarkdownDocument,
  MarkdownDocumentContent,
} from '@block-md/component/MarkdownDocument';
import { ModalsProvider } from '@block-md/component/ModalsProvider';
import { MarkdownSidePanelSections } from '@block-md/component/sidepanel/MarkdownSidePanelSections';
import { OldOverlay } from '@block-md/history/OldOverlay';
import { loadMarkdownCachedSnapshot } from '@block-md/queries/markdown-document-operations';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { SidePanel } from '@components/app/side-panel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { ENABLE_MARKDOWN_SIDE_PANEL } from '@core/constant/featureFlags';
import { DocumentDebouncedNotificationReadMarker } from '@notifications';
import SpinnerIcon from '@phosphor/spinner.svg';
import { Button } from '@ui';
import {
  createResource,
  ErrorBoundary,
  type JSX,
  Match,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import {
  loadTaskDocument,
  type TaskDocumentData,
} from '../queries/task-document';
import type { TaskDetailTarget } from '../types';

export type TaskDetailContext = {
  data: TaskDocumentData;
};

export type TaskDetailProps = {
  task: TaskDetailTarget;
  shareOpen: boolean;
  onShareOpenChange: (open: boolean) => void;
  children?: (context: TaskDetailContext) => JSX.Element;
};

export function TaskDetailBodyState(props: {
  error?: unknown;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const errorText = () => String(props.error);

  return (
    <div class="grid size-full place-items-center text-ink-muted">
      <Switch
        fallback={
          <SpinnerIcon aria-label="Loading task" class="size-5 animate-spin" />
        }
      >
        <Match when={props.error !== undefined}>
          <div class="flex max-w-xl flex-col items-center gap-3 px-6 text-center">
            <span>This task couldn’t be displayed.</span>
            <pre class="max-h-48 max-w-full overflow-auto whitespace-pre-wrap text-left text-failure text-xs">
              {errorText()}
            </pre>
            <Button variant="outline" size="sm" onClick={props.onAction}>
              {props.actionLabel ?? 'Reset'}
            </Button>
          </div>
        </Match>
      </Switch>
    </div>
  );
}

function TaskDetailContent(props: {
  task: TaskDetailTarget;
  data: TaskDocumentData;
  shareOpen: boolean;
  onShareOpenChange: (open: boolean) => void;
  children?: (context: TaskDetailContext) => JSX.Element;
}) {
  const panel = useSplitPanelOrThrow();
  const notificationSource = useGlobalNotificationSource();
  const fallbackName = () => props.task.fallbackName ?? 'New Task';

  return (
    <MarkdownDocument
      documentId={props.task.id}
      kind="task"
      documentSource={{ type: 'sync', source: props.data.source }}
      permissions={props.data.permissions}
      persistedName={props.data.metadata.documentName}
      fallbackName={fallbackName()}
    >
      <ModalsProvider
        shareOpen={props.shareOpen}
        onShareOpenChange={props.onShareOpenChange}
      >
        <OldOverlay />
        {props.children?.({ data: props.data })}
        <SidePanel.Layout headerToggle={false}>
          <Show when={ENABLE_MARKDOWN_SIDE_PANEL}>
            <MarkdownSidePanelSections />
          </Show>
          <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
            <div class="absolute top-1.5 right-4 z-action-menu flex justify-end">
              <FindAndReplace hotkeyScope={panel.splitHotkeyScope} />
            </div>
            <DocumentDebouncedNotificationReadMarker
              notificationSource={notificationSource}
              documentId={props.task.id}
            />
            <MarkdownDocumentContent
              hotkeyScope={panel.splitHotkeyScope}
              doInitialSync={props.data.doInitialSync}
              loadCachedSnapshot={() =>
                loadMarkdownCachedSnapshot(props.task.id)
              }
            />
          </div>
        </SidePanel.Layout>
      </ModalsProvider>
    </MarkdownDocument>
  );
}

/** Renders one task document without owning view navigation or breadcrumbs. */
export function TaskDetail(props: TaskDetailProps) {
  const [document, { refetch }] = createResource(
    () => props.task.id,
    loadTaskDocument
  );

  return (
    <Suspense fallback={<TaskDetailBodyState />}>
      <Switch>
        <Match when={document.error}>
          {(error) => (
            <TaskDetailBodyState
              error={error()}
              actionLabel="Try again"
              onAction={() => void refetch()}
            />
          )}
        </Match>
        <Match when={document()}>
          {(data) => (
            <ErrorBoundary
              fallback={(error, reset) => (
                <TaskDetailBodyState
                  error={error}
                  actionLabel="Reset"
                  onAction={reset}
                />
              )}
            >
              <TaskDetailContent
                task={props.task}
                data={data()}
                shareOpen={props.shareOpen}
                onShareOpenChange={props.onShareOpenChange}
                children={props.children}
              />
            </ErrorBoundary>
          )}
        </Match>
      </Switch>
    </Suspense>
  );
}
