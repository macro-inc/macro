import {
  DocumentAccessDenied,
  useSharedAccessUpdates,
} from '@app/features/access-requests/access-requests';
import { shareEntity } from '@app/features/access-requests/core/types';
import {
  DocumentFileSidePanelSections,
  SidePanel,
} from '@components/app/side-panel';
import { toEntityLoadError } from '@core/component/EntityLoadGate';
import {
  getPermissions,
  hasPermissions,
  Permissions,
} from '@core/component/SharePermissions';
import SpinnerIcon from '@phosphor/spinner.svg';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';
import { Button } from '@ui';
import {
  createResource,
  ErrorBoundary,
  type JSX,
  Match,
  type ParentProps,
  Suspense,
  Switch,
} from 'solid-js';

export type FileDetailLayoutProps = ParentProps<{
  documentId: string;
  documentMetadata: DocumentMetadata;
  userAccessLevel: AccessLevel;
  defaultSidePanelOpen?: boolean;
}>;

export function FileDetailLayout(props: FileDetailLayoutProps) {
  const permissions = () => getPermissions(props.userAccessLevel);
  const canEdit = () => hasPermissions(permissions(), Permissions.CAN_EDIT);

  return (
    <SidePanel.Layout
      floating
      defaultOpen={props.defaultSidePanelOpen ?? false}
      persistKey={`file:${props.documentId}`}
      headerToggle={false}
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
            <pre class="max-h-48 max-w-full overflow-auto whitespace-pre-wrap text-left text-failure text-xs">
              {String(props.error)}
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

export function FileDetailLoadGate<
  T extends { userAccessLevel: AccessLevel },
>(props: {
  documentId: string;
  label: string;
  load: (documentId: string) => Promise<T>;
  children: (data: T) => JSX.Element;
}) {
  const [document, { refetch, mutate }] = createResource(
    () => props.documentId,
    props.load
  );
  const reload = () => {
    // Dispose the old editor and its sync source before loading a new token.
    mutate(undefined);
    void refetch();
  };
  const sharedAccess = useSharedAccessUpdates(
    () => shareEntity('document', props.documentId),
    (level) => {
      if (level === null) {
        mutate(undefined);
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
              onAction={() => void refetch()}
            />
          )}
        </Match>
        <Match when={document()}>
          {(data) => (
            <ErrorBoundary
              fallback={(error, reset) => (
                <FileDetailBodyState
                  label={props.label}
                  error={error}
                  actionLabel="Reset"
                  onAction={reset}
                />
              )}
            >
              {props.children(data())}
            </ErrorBoundary>
          )}
        </Match>
      </Switch>
    </Suspense>
  );
}
