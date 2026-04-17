import { SplitDrawer } from '@app/component/split-layout/components/SplitDrawer';
import { EntityIcon } from '@core/component/EntityIcon';
import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { UserIcon } from '@core/component/UserIcon';
import { tryMacroId, useDisplayName } from '@core/user';
import { formatDate, type DateValue } from '@core/util/date';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import { useChatDataQuery } from '@queries/cognition/chat-data';
import { useDocumentMetadataQuery } from '@queries/storage/document-metadata';
import { useProjectDataQuery } from '@queries/storage/project-data';
import { createCallback } from '@solid-primitives/rootless';
import { createMemo, type JSX, Match, Show, Suspense, Switch } from 'solid-js';

export const DETAILS_DRAWER_ID = 'details';

type DetailsTarget =
  | { documentId: string }
  | { projectId: string }
  | { chatId: string };

export function DetailsDrawer(props: DetailsTarget) {
  return (
    <SplitDrawer id={DETAILS_DRAWER_ID} side="left" size={360} title="Details">
      <Suspense fallback={<DetailsLoading />}>
        <Switch>
          <Match when={'projectId' in props ? props.projectId : undefined}>
            {(projectId) => <ProjectDetails projectId={projectId()} />}
          </Match>
          <Match when={'chatId' in props ? props.chatId : undefined}>
            {(chatId) => <ChatDetails chatId={chatId()} />}
          </Match>
          <Match when={'documentId' in props ? props.documentId : undefined}>
            {(documentId) => <DocumentDetails documentId={documentId()} />}
          </Match>
        </Switch>
      </Suspense>
    </SplitDrawer>
  );
}

function DetailsLoading() {
  return (
    <div class="flex justify-center items-center py-8">
      <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-ink-muted" />
    </div>
  );
}

function DocumentDetails(props: { documentId: string }) {
  const query = useDocumentMetadataQuery(() => props.documentId);
  const metadata = createMemo(() => query.data);

  return (
    <DetailsGrid
      owner={() => metadata()?.owner}
      folder={() => {
        const id = metadata()?.projectId;
        const name = metadata()?.projectName;
        return id && name ? { id, name } : undefined;
      }}
      createdAt={() => metadata()?.createdAt}
      updatedAt={() => metadata()?.updatedAt}
    />
  );
}

function ProjectDetails(props: { projectId: string }) {
  const query = useProjectDataQuery(() => props.projectId);
  const metadata = createMemo(() => query.data);

  return (
    <DetailsGrid
      owner={() => metadata()?.userId}
      folder={() => undefined}
      createdAt={() => metadata()?.createdAt}
      updatedAt={() => metadata()?.updatedAt}
    />
  );
}

function ChatDetails(props: { chatId: string }) {
  const query = useChatDataQuery(() => props.chatId);
  const chat = createMemo(() => query.data);
  const projectQuery = useProjectDataQuery(
    () => chat()?.projectId ?? undefined
  );

  return (
    <DetailsGrid
      owner={() => chat()?.userId}
      folder={() => {
        const id = chat()?.projectId;
        const name = projectQuery.data?.name;
        return id && name ? { id, name } : undefined;
      }}
      createdAt={() => chat()?.createdAt}
      updatedAt={() => chat()?.updatedAt}
    />
  );
}

function DetailsGrid(props: {
  owner: () => string | undefined;
  folder: () => { id: string; name: string } | undefined;
  createdAt: () => DateValue | null | undefined;
  updatedAt: () => DateValue | null | undefined;
}) {
  return (
    <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 items-center text-sm px-2 py-1">
      <Show when={props.owner()}>
        {(ownerId) => (
          <Row label="Owner">
            <OwnerValue ownerId={ownerId()} />
          </Row>
        )}
      </Show>
      <Show when={props.folder()}>
        {(folder) => (
          <Row label="Folder">
            <FolderLink projectId={folder().id} projectName={folder().name} />
          </Row>
        )}
      </Show>
      <Show when={props.createdAt()}>
        {(created) => (
          <Row label="Created">
            <span>{formatDate(created(), { showTime: true })}</span>
          </Row>
        )}
      </Show>
      <Show when={props.updatedAt()}>
        {(updated) => (
          <Row label="Last updated">
            <span>{formatDate(updated(), { showTime: true })}</span>
          </Row>
        )}
      </Show>
    </div>
  );
}

function Row(props: { label: string; children: JSX.Element }) {
  return (
    <>
      <span class="text-xs text-ink-muted">{props.label}</span>
      <div class="flex items-center gap-2 min-w-0">{props.children}</div>
    </>
  );
}

function FolderLink(props: { projectId: string; projectName: string }) {
  const open = createCallback((e: MouseEvent) => {
    // Default: open in new split. Shift-click: replace current split.
    openDocument('project', props.projectId, undefined, !e.shiftKey);
  });
  const navHandlers = useSplitNavigationHandler<HTMLSpanElement>(open);
  return (
    <span
      {...navHandlers}
      class="pointer-events-auto min-w-0 truncate py-0.5 rounded-xs hover:bg-hover focus:bg-active"
    >
      <span class="relative top-[0.125em] size-[1em] inline-flex mx-1">
        <EntityIcon targetType="project" size="fill" />
      </span>
      <span class="underline decoration-current/20 decoration-[max(1px,0.1em)] underline-offset-2">
        {props.projectName}
      </span>
    </span>
  );
}

function OwnerValue(props: { ownerId: string }) {
  const [displayName] = useDisplayName(tryMacroId(props.ownerId));
  return (
    <>
      <UserIcon id={props.ownerId} size="xs" showTooltip suppressClick />
      <span class="truncate">{displayName()}</span>
    </>
  );
}
