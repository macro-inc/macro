import {
  DocumentFileSidePanelSections,
  SidePanel,
} from '@components/app/side-panel';
import type { BlockAlias, BlockName } from '@core/block';
import {
  getPermissions,
  hasPermissions,
  Permissions,
} from '@core/component/SharePermissions';
import {
  ShareDialogContext,
  ShareModal,
} from '@core/component/TopBar/ShareButton';
import SpinnerIcon from '@phosphor/spinner.svg';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';
import { Button } from '@ui';
import {
  createResource,
  createSignal,
  ErrorBoundary,
  type JSX,
  Match,
  type ParentProps,
  type Setter,
  Suspense,
  Switch,
} from 'solid-js';

export type FileDetailShareProps = {
  shareOpen?: boolean;
  onShareOpenChange?: (open: boolean) => void;
};

export type FileDetailLayoutProps = ParentProps<
  FileDetailShareProps & {
    documentId: string;
    documentMetadata: DocumentMetadata;
    userAccessLevel: AccessLevel;
    blockType: BlockName | BlockAlias;
    defaultSidePanelOpen?: boolean;
  }
>;

export function FileDetailLayout(props: FileDetailLayoutProps) {
  const [localShareOpen, setLocalShareOpen] = createSignal(false);
  const shareOpen = () => props.shareOpen ?? localShareOpen();
  const setShareOpen: Setter<boolean> = (next) => {
    const open = typeof next === 'function' ? next(shareOpen()) : next;
    props.onShareOpenChange?.(open);
    if (props.shareOpen === undefined) setLocalShareOpen(() => open);
    return open;
  };
  const permissions = () => getPermissions(props.userAccessLevel);
  const canEdit = () => hasPermissions(permissions(), Permissions.CAN_EDIT);
  const documentName = () => props.documentMetadata.documentName;

  return (
    <ShareDialogContext.Provider
      value={{
        isOpen: shareOpen,
        open: () => setShareOpen(true),
        close: () => setShareOpen(false),
      }}
    >
      <SidePanel.Layout
        defaultOpen={props.defaultSidePanelOpen ?? false}
        persistKey={`file:${props.documentId}`}
        headerToggle={false}
      >
        <DocumentFileSidePanelSections
          documentId={props.documentId}
          documentName={documentName()}
          canEdit={canEdit()}
        />
        <div class="relative size-full min-h-0 min-w-0 overflow-hidden">
          {props.children}
        </div>
      </SidePanel.Layout>
      <Suspense>
        <ShareModal
          isSharePermOpen={shareOpen()}
          setIsSharePermOpen={setShareOpen}
          id={props.documentId}
          blockAlias={props.blockType}
          itemType="document"
          name={documentName()}
          userPermissions={permissions()}
          owner={props.documentMetadata.owner}
        />
      </Suspense>
    </ShareDialogContext.Provider>
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
