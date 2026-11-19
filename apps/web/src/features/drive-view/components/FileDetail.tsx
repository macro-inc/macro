import {
  DocumentAccessDenied,
  useSharedAccessUpdates,
} from '@app/features/access-requests/access-requests';
import { shareEntity } from '@app/features/access-requests/core/types';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useFlow, usePending } from '@app/observability/flow';
import { useSplitHeaderScope } from '@components/app/SplitHeaderScope';
import {
  DocumentFileSidePanelSections,
  SidePanel,
} from '@components/app/side-panel';
import type { BlockName } from '@core/block';
import { toEntityLoadError } from '@core/component/EntityLoadGate';
import {
  getPermissions,
  hasPermissions,
  Permissions,
} from '@core/component/SharePermissions';
import { useIsAuthenticated } from '@core/context/user';
import { trackOpen } from '@core/internal/track-open';
import { fireAndForget } from '@core/util/fireAndForget';
import { StaleCacheAuthorityError } from '@graphql-cache/authority';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import { type Span, Telemetry } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import { documentLoadKeys } from '@queries/storage/documentLoad/keys';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';
import { Button } from '@ui';
import {
  createEffect,
  createResource,
  ErrorBoundary,
  type JSX,
  Match,
  onCleanup,
  type ParentProps,
  Suspense,
  Switch,
  untrack,
} from 'solid-js';

export type FileDetailLayoutProps = ParentProps<{
  documentId: string;
  documentMetadata: DocumentMetadata;
  userAccessLevel: AccessLevel;
  defaultSidePanelOpen?: boolean;
}>;

export function FileDetailLayout(props: FileDetailLayoutProps) {
  // A hosted split header carries the details toggle, as the block's does.
  const hostedHeader = useSplitHeaderScope();
  const permissions = () => getPermissions(props.userAccessLevel);
  const canEdit = () => hasPermissions(permissions(), Permissions.CAN_EDIT);

  return (
    <SidePanel.Layout
      floating
      defaultOpen={props.defaultSidePanelOpen ?? false}
      persistKey={`file:${props.documentId}`}
      headerToggle={!!hostedHeader}
    >
      <DocumentFileSidePanelSections
        documentId={props.documentId}
        documentName={props.documentMetadata.documentName}
        canEdit={canEdit()}
      />
      <div class="relative size-full min-h-0 min-w-0 overflow-hidden">
        {props.children}
      </div>
    </SidePanel.Layout>
  );
}

function FileDetailBodyState(props: {
  label: string;
  error?: unknown;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div class="grid size-full place-items-center text-ink-muted">
      <Switch
        fallback={
          <SpinnerIcon
            aria-hidden={false}
            aria-label={`Loading ${props.label}`}
            class="size-5 animate-spin"
          />
        }
      >
        <Match when={props.error !== undefined}>
          <div
            class="flex max-w-xl flex-col items-center gap-3 px-6 text-center"
            role="alert"
          >
            <span>This {props.label} couldn’t be displayed.</span>
            <Button variant="secondary" size="sm" onClick={props.onAction}>
              {props.actionLabel ?? 'Reset'}
            </Button>
          </div>
        </Match>
      </Switch>
    </div>
  );
}

export function FileDetailLoadGate<
  T extends { userAccessLevel: AccessLevel },
>(props: {
  documentId: string;
  /** The block the document opens as, reported on `open_entity`. */
  entityType: BlockName;
  label: string;
  load: (documentId: string, parentSpan?: Span) => Promise<T>;
  /**
   * Releases what a load opened, such as a markdown document's sync source,
   * once its result can no longer be shown: its content replaced or removed,
   * superseded by a newer load, resolved after the gate unmounted, or on
   * unmount.
   */
  dispose?: (data: T) => void;
  /** Releases a result that never reached its viewer; shown viewers own it. */
  discard?: (data: T) => void;
  children: (data: T) => JSX.Element;
}) {
  const analytics = useAnalytics();
  const authenticated = useIsAuthenticated();
  const flow = useFlow();
  // Shown results are released when their content is disposed (after the
  // editor it rendered); the rest here. Each result is released once.
  const released = new WeakSet<T>();
  const handedToViewer = new WeakSet<T>();
  const release = (data: T | undefined) => {
    if (data === undefined || released.has(data)) return;
    released.add(data);
    props.dispose?.(data);
    if (!handedToViewer.has(data)) props.discard?.(data);
  };
  let unmounted = false;
  let latestLoad = 0;
  let current: T | undefined;
  const load = async (documentId: string): Promise<T | undefined> => {
    const request = ++latestLoad;
    const superseded = () => unmounted || request !== latestLoad;
    for (let attempt = 0; attempt < 2; attempt++) {
      const generation = cacheSessionGeneration.capture();
      let data: T | undefined;
      try {
        data = await untrack(() =>
          flow.task('document.load', (span) => {
            span.setAttr('doc.type', props.entityType);
            span.setAttr('document.id', documentId);
            span.setAttr('doc.session_retry', attempt);
            return props.load(documentId, span);
          })
        );
      } catch (error) {
        if (cacheSessionGeneration.isCurrent(generation)) throw error;
      }
      // A disposed or revoked view must not publish its late result or recover.
      if (superseded()) {
        release(data);
        return undefined;
      }
      if (!cacheSessionGeneration.isCurrent(generation)) {
        release(data);
        if (attempt > 0) throw new StaleCacheAuthorityError();
        // A cold load can overlap local retirement. Retry once from identity,
        // after local cleanup, with fresh metadata and authorization credentials.
        await cacheSessionGeneration.settled();
        if (superseded()) return undefined;
        if (cacheSessionGeneration.state().paused)
          throw new StaleCacheAuthorityError();
        await queryClient.invalidateQueries({
          queryKey: documentLoadKeys.bundle(documentId).queryKey,
          exact: true,
          refetchType: 'none',
        });
        if (superseded()) return undefined;
        continue;
      }
      current = data;
      return data;
    }
    throw new StaleCacheAuthorityError();
  };
  const unload = () => {
    latestLoad++;
    const previous = current;
    current = undefined;
    mutate(undefined);
    release(previous);
  };
  onCleanup(() => {
    unmounted = true;
    release(current);
  });
  const [document, { refetch, mutate }] = createResource(
    () => props.documentId,
    load
  );
  usePending('document.resource', () => document.loading);
  // Counts and records the open once per loaded document; access changes and
  // retries reload the same document without reopening it. A load cut short by
  // revoked access is ready without a document and is not an open.
  let trackedDocumentId: string | undefined;
  createEffect(() => {
    if (document.state !== 'ready' || document.latest === undefined) return;
    const documentId = props.documentId;
    if (trackedDocumentId === documentId) return;
    trackedDocumentId = documentId;
    trackOpen(documentId, props.entityType, authenticated);
    analytics.pageView(props.entityType);
    analytics.track('open_entity', {
      entityType: props.entityType,
      entityId: documentId,
    });
  });
  const reload = () => {
    // Dispose the old editor and its sync source before loading a new token.
    unload();
    fireAndForget(refetch(), 'drive-view');
  };
  const sharedAccess = useSharedAccessUpdates(
    () => shareEntity('document', props.documentId),
    (level) => {
      if (level === null) {
        unload();
        return;
      }
      const loaded = document.state === 'ready' ? document.latest : undefined;
      if (loaded?.userAccessLevel !== level) reload();
    }
  );
  const accessDenied = () => {
    if (sharedAccess() === null) return true;
    const error = toEntityLoadError(document.error);
    return error === 'UNAUTHORIZED' || error === 'FORBIDDEN';
  };

  return (
    <Suspense fallback={<FileDetailBodyState label={props.label} />}>
      <Switch>
        <Match when={accessDenied()}>
          <DocumentAccessDenied
            documentId={props.documentId}
            onAccessGranted={() => {
              if (document.error) reload();
            }}
          />
        </Match>
        <Match when={document.error}>
          {(error) => (
            <FileDetailBodyState
              label={props.label}
              error={error()}
              actionLabel="Try again"
              onAction={() => fireAndForget(refetch(), 'drive-view')}
            />
          )}
        </Match>
        <Match when={document()} keyed>
          {(data) => {
            handedToViewer.add(data);
            // Runs after this content, and the editor it renders, is disposed.
            onCleanup(() => release(data));
            return (
              <ErrorBoundary
                fallback={(error, reset) => {
                  // A failed load is already on its `document.load` span.
                  Telemetry.error(error, {
                    surface: 'file-detail',
                    'doc.type': props.entityType,
                    'document.id': props.documentId,
                  });
                  return (
                    <FileDetailBodyState
                      label={props.label}
                      error={error}
                      actionLabel="Try again"
                      onAction={reset}
                    />
                  );
                }}
              >
                {props.children(data)}
              </ErrorBoundary>
            );
          }}
        </Match>
      </Switch>
    </Suspense>
  );
}
