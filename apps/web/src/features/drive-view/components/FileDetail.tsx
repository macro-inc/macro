import {
  DocumentFileSidePanelSections,
  SidePanel,
} from '@components/app/side-panel';
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

export function FileDetailLoadGate<T extends object>(props: {
  documentId: string;
  label: string;
  load: (documentId: string) => Promise<T>;
  children: (data: T) => JSX.Element;
}) {
  const [document, { refetch }] = createResource(
    () => props.documentId,
    props.load
  );

  return (
    <Suspense fallback={<FileDetailBodyState label={props.label} />}>
      <Switch>
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
