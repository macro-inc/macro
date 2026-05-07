import { useBlockId } from '@core/block';
import { EntityIcon } from '@core/component/EntityIcon';
import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { UserIcon } from '@core/component/UserIcon';
import { tryMacroId, useDisplayName } from '@core/user';
import { formatDate, type DateValue } from '@core/util/date';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import { useDocumentMetadataQuery } from '@queries/storage/document-metadata';
import { createCallback } from '@solid-primitives/rootless';
import { createMemo, type JSX, Show, Suspense } from 'solid-js';

/**
 * "Details" section content for the SidePanel — clones DocumentDetails
 * from `@core/component/DetailsDrawer` so the same metadata grid is
 * surfaced in the right rail without depending on the drawer's open state.
 */
export function DocumentDetailsSection() {
  const blockId = useBlockId();
  const query = useDocumentMetadataQuery(() => blockId);
  const metadata = createMemo(() => query.data);

  return (
    <Suspense fallback={<DetailsLoading />}>
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
    </Suspense>
  );
}

function DetailsLoading() {
  return (
    <div class="flex justify-center items-center py-8">
      <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-ink-muted" />
    </div>
  );
}

function DetailsGrid(props: {
  owner: () => string | undefined;
  folder: () => { id: string; name: string } | undefined;
  createdAt: () => DateValue | null | undefined;
  updatedAt: () => DateValue | null | undefined;
}) {
  return (
    <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 items-center text-sm">
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
      <UserIcon id={props.ownerId} size="sm" showTooltip suppressClick />
      <span class="truncate">{displayName()}</span>
    </>
  );
}
