import { EntityDetail } from '@app/components/entity-detail/EntityDetail';
import {
  type EntityDetailTarget,
  entityDetailTarget,
} from '@app/components/entity-detail/entity-detail-target';
import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  type EntityData,
  EntityRowIcon,
  formatDateAndTime,
  isProjectContainedEntity,
  OwnerLabel,
  ProjectBreadCrumb,
} from '@entity';
import ShareIcon from '@icon/share.svg';
import StarFillIcon from '@icon/system/fill/star-fill.svg';
import ArrowUpRightIcon from '@icon/system/regular/arrow-up-right.svg';
import ColumnsIcon from '@icon/system/regular/columns.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import FolderIcon from '@icon/system/regular/folder.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import PencilIcon from '@icon/system/regular/pencil-line.svg';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import StarIcon from '@icon/system/regular/star.svg';
import TrashIcon from '@icon/system/regular/trash-simple.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { Button, Tabs, Tooltip } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { InlineNameInput } from '../../components/redesign/inline-name-input';
import { driveKindLabel } from '../../components/redesign/kind-label';
import { ShareProvenanceBadge } from '../../components/redesign/share-provenance-badge';
import { useDriveView } from '../../context/drive-context';
import { useDriveRedesign } from '../../context/drive-redesign-context';
import { countDirectSubfolders, driveItemKind } from '../../core/drive-items';
import type { DriveInspectorTab } from '../../primitives/drive-inspector';
import { DetailErrorBoundary } from '../MarkdownDetail';

function toPreviewTarget(entity: EntityData): EntityDetailTarget | undefined {
  if (entity.type === 'document') {
    return entityDetailTarget.document({
      id: entity.id,
      fileType: entity.fileType,
      subType: entity.subType,
      fallbackName: entity.name,
    });
  }
  if (entity.type === 'database' || entity.type === 'form') {
    return entityDetailTarget.fromSelection(
      { type: entity.type, id: entity.id },
      entity.name
    );
  }
  return undefined;
}

function FolderQuickPreview(props: { folder: EntityData }) {
  const { state, sidebar, actions } = useDriveView();
  const { createFolderContents } = useDriveRedesign();
  const contents = createFolderContents(() => props.folder.id);
  const subfolderCounts = createMemo(() =>
    countDirectSubfolders(sidebar.folders())
  );

  const previewItems = createMemo(() =>
    contents
      .items()
      .map((row) => row.entity)
      .slice(0, 12)
  );

  return (
    <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div class="flex items-center gap-3 rounded-xl border border-edge-muted bg-surface p-3.5">
        <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-inset">
          <EntityRowIcon entity={props.folder} class="size-6" />
        </span>
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-semibold text-ink">
            {props.folder.name}
          </div>
          <div class="text-xs text-ink-muted">
            {(() => {
              const subs = subfolderCounts().get(props.folder.id) ?? 0;
              if (subs > 0) return t('drive.subfolderCount', { count: subs });
              return t('drive.itemCount', { count: contents.items().length });
            })()}
          </div>
        </div>
        <Button
          variant="secondary"
          size="xs"
          onClick={() => state.selectFolder(props.folder.id)}
        >
          {t('drive.openFolder')}
        </Button>
      </div>

      <div class="flex flex-col gap-2">
        <div class="text-xs font-semibold text-ink-muted">
          {t('drive.inspectorContents')}
        </div>
        <Show
          when={!contents.isLoading() || previewItems().length > 0}
          fallback={
            <div class="flex items-center gap-2 py-4 text-xs text-ink-muted">
              <SpinnerIcon class="size-3.5 animate-spin" aria-hidden="true" />
              <span>{t('drive.loadingMore')}</span>
            </div>
          }
        >
          <Show
            when={previewItems().length > 0}
            fallback={
              <p class="rounded-lg border border-dashed border-edge-muted px-3 py-6 text-center text-xs text-ink-subtle">
                {t('drive.inspectorFolderEmpty')}
              </p>
            }
          >
            <ul class="flex flex-col gap-0.5">
              <For each={previewItems()}>
                {(item) => (
                  <li>
                    <button
                      type="button"
                      class="flex h-9 w-full min-w-0 items-center gap-2.5 rounded-lg px-2 text-left text-sm text-ink transition-colors hover:bg-hover"
                      onClick={(event) => actions.openEntity(item, event)}
                    >
                      <span class="flex size-4 shrink-0 items-center justify-center">
                        <EntityRowIcon entity={item} />
                      </span>
                      <span class="min-w-0 flex-1 truncate">{item.name}</span>
                      <span class="shrink-0 text-[11px] text-ink-subtle">
                        {driveKindLabel(driveItemKind(item))}
                      </span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </div>
    </div>
  );
}

/**
 * Finder-inspired Quick Look & Details Inspector side pane.
 * Toggled with Space or the header Inspector icon; follows list/grid/column
 * focus automatically so arrowing through files scrubs live previews smoothly.
 */
export function DriveRedesignInspector() {
  const { actions } = useDriveView();
  const {
    inlineEdit,
    inspector,
    host,
    shareProvenance,
    inspectedEntity,
    selectedEntities,
    clearActiveSelection,
  } = useDriveRedesign();

  // Debounce live EntityDetail mount by 120ms so holding ArrowDown stays smooth.
  const [debouncedPreviewEntity, setDebouncedPreviewEntity] = createSignal<
    EntityData | undefined
  >();

  createEffect(() => {
    const entity = inspectedEntity();
    if (!inspector.isOpen() || inspector.tab() !== 'preview') {
      setDebouncedPreviewEntity(undefined);
      return;
    }
    if (!entity || entity.type === 'project') {
      setDebouncedPreviewEntity(entity);
      return;
    }
    const timer = window.setTimeout(() => {
      setDebouncedPreviewEntity(entity);
    }, 120);
    onCleanup(() => window.clearTimeout(timer));
  });

  const multiSelection = () => selectedEntities().length > 1;
  const multiBreakdown = createMemo(() => {
    const counts = new Map<string, number>();
    for (const entity of selectedEntities()) {
      const label = driveKindLabel(driveItemKind(entity));
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()];
  });

  return (
    <Show when={inspector.isOpen()}>
      <aside
        aria-label={t('drive.inspectorTitle')}
        class="flex h-full w-90 shrink-0 flex-col border-l border-edge-muted bg-panel"
      >
        {/* Inspector Header */}
        <div class="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-edge-muted px-3">
          <Show
            when={!multiSelection()}
            fallback={
              <span class="truncate text-sm font-semibold text-ink">
                {t('drive.selectedSummary', {
                  count: selectedEntities().length,
                })}
              </span>
            }
          >
            <Tabs<DriveInspectorTab>
              aria-label={t('drive.inspectorTitle')}
              size="sm"
              value={inspector.tab()}
              onChange={inspector.setTab}
              options={[
                { value: 'preview', label: t('drive.inspectorPreviewTab') },
                { value: 'details', label: t('drive.inspectorDetailsTab') },
              ]}
            />
          </Show>

          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('drive.inspectorClose')}
            tooltip={`${t('drive.inspectorClose')} (Space / Esc)`}
            onClick={inspector.close}
          >
            <CloseIcon class="size-4" aria-hidden="true" />
          </Button>
        </div>

        {/* Multi-selection inspector */}
        <Switch>
          <Match when={multiSelection()}>
            <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
              <div class="rounded-xl border border-edge-muted bg-surface p-4">
                <div class="text-sm font-semibold text-ink">
                  {t('drive.selectedSummary', {
                    count: selectedEntities().length,
                  })}
                </div>
                <p class="mt-1 text-xs text-ink-muted">
                  {t('drive.inspectorMultiHint')}
                </p>
                <div class="mt-3 flex flex-wrap gap-1.5">
                  <For each={multiBreakdown()}>
                    {([label, count]) => (
                      <span class="rounded-full bg-inset px-2.5 py-0.5 text-xs text-ink-muted">
                        {count} {label}
                      </span>
                    )}
                  </For>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => host.openMoveDialog(selectedEntities())}
                >
                  <FolderIcon class="size-3.5" aria-hidden="true" />
                  <span>{t('drive.move')}</span>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => host.shareEntities(selectedEntities())}
                >
                  <ShareIcon class="size-3.5" aria-hidden="true" />
                  <span>{t('drive.share')}</span>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    fireAndForget(
                      host.toggleStarEntities(selectedEntities()),
                      'drive-inspector-star'
                    )
                  }
                >
                  <StarIcon class="size-3.5" aria-hidden="true" />
                  <span>{t('drive.star')}</span>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    fireAndForget(
                      host.duplicateEntities(selectedEntities()),
                      'drive-inspector-dup'
                    )
                  }
                >
                  <CopyIcon class="size-3.5" aria-hidden="true" />
                  <span>{t('drive.duplicate')}</span>
                </Button>
              </div>

              <Show
                when={selectedEntities().some((entity) =>
                  host.canMutateEntity(entity)
                )}
              >
                <Button
                  variant="secondary"
                  size="sm"
                  class="text-failure-ink hover:text-failure-ink"
                  onClick={() => {
                    const targets = selectedEntities();
                    clearActiveSelection();
                    fireAndForget(
                      host.trashEntitiesWithUndo(targets),
                      'drive-inspector-bulk-trash'
                    );
                  }}
                >
                  <TrashIcon class="size-3.5" aria-hidden="true" />
                  <span>{t('drive.moveToTrash')}</span>
                </Button>
              </Show>
            </div>
          </Match>

          <Match when={!inspectedEntity()}>
            <div class="flex flex-1 flex-col items-center justify-center gap-1.5 p-6 text-center">
              <p class="text-sm font-medium text-ink">
                {t('drive.inspectorNoSelection')}
              </p>
              <p class="text-xs text-ink-muted">
                {t('drive.inspectorNoSelectionHint')}
              </p>
            </div>
          </Match>

          <Match when={inspectedEntity()}>
            {(entity) => {
              const kind = () => driveItemKind(entity());
              const starred = () => host.isStarred(entity());
              const canMutate = () => host.canMutateEntity(entity());
              const isRenamingHere = () => {
                const target = inlineEdit.renaming();
                return (
                  target?.surface === 'inspector' && target.id === entity().id
                );
              };
              const ownerId = () =>
                'ownerId' in entity() ? entity().ownerId : undefined;
              const projectEntity = createMemo(() => {
                const current = entity();
                return isProjectContainedEntity(current) ? current : undefined;
              });
              const updatedAt = () =>
                entity().type === 'database' || entity().type === 'form'
                  ? entity().createdAt
                  : entity().updatedAt;
              const createdAt = () =>
                'createdAt' in entity() ? entity().createdAt : undefined;
              const viewedAt = () =>
                'viewedAt' in entity() ? entity().viewedAt : undefined;

              const previewTarget = createMemo(() => {
                const current = debouncedPreviewEntity();
                return current ? toPreviewTarget(current) : undefined;
              });

              return (
                <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
                  {/* Compact item identity + primary Open strip */}
                  <div class="flex shrink-0 items-center gap-2 border-b border-edge-muted bg-surface/60 px-3 py-2.5">
                    <span class="flex size-5 shrink-0 items-center justify-center">
                      <EntityRowIcon entity={entity()} />
                    </span>
                    <Show
                      when={isRenamingHere()}
                      fallback={
                        <Tooltip label={entity().name} class="min-w-0 flex-1">
                          <span class="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                            {entity().name}
                          </span>
                        </Tooltip>
                      }
                    >
                      <InlineNameInput
                        initialValue={entity().name}
                        isFolder={entity().type === 'project'}
                        ariaLabel={t('drive.renameInputLabel', {
                          name: entity().name,
                        })}
                        disabled={inlineEdit.isPending()}
                        onCommit={(nextName) =>
                          inlineEdit.runCommit(async () => {
                            await host.renameEntityInline(entity(), nextName);
                          })
                        }
                        onCancel={inlineEdit.cancelRename}
                      />
                    </Show>
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={(event) => actions.openEntity(entity(), event)}
                    >
                      <ArrowUpRightIcon class="size-3" aria-hidden="true" />
                      <span>{t('drive.openFullView')}</span>
                    </Button>
                  </div>

                  {/* Preview Tab */}
                  <Show
                    when={inspector.tab() === 'preview'}
                    fallback={
                      /* Details Tab */
                      <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
                        <dl class="flex flex-col gap-3 text-xs">
                          <div class="flex items-center justify-between gap-3">
                            <dt class="text-ink-muted">
                              {t('drive.inspectorKind')}
                            </dt>
                            <dd class="font-medium text-ink">
                              {driveKindLabel(kind())}
                            </dd>
                          </div>

                          <div class="flex items-center justify-between gap-3">
                            <dt class="text-ink-muted">
                              {t('drive.inspectorLocation')}
                            </dt>
                            <dd class="min-w-0 text-right">
                              <Show
                                when={projectEntity()}
                                fallback={
                                  <span class="text-ink">
                                    {t('drive.unfiledLocation')}
                                  </span>
                                }
                              >
                                {(contained) => (
                                  <ProjectBreadCrumb
                                    entity={contained()}
                                    onClick={(project, event) =>
                                      actions.openEntity(project, event)
                                    }
                                  />
                                )}
                              </Show>
                            </dd>
                          </div>

                          <div class="flex items-center justify-between gap-3">
                            <dt class="text-ink-muted">
                              {t('drive.inspectorOwner')}
                            </dt>
                            <dd class="min-w-0 text-ink">
                              <OwnerLabel
                                ownerId={ownerId()}
                                viewerLabel={t('drive.ownerYou')}
                                iconClass="size-4"
                                suppressClick
                              />
                            </dd>
                          </div>

                          <Show when={shareProvenance?.get(entity())}>
                            {(prov) => (
                              <div class="flex items-center justify-between gap-3">
                                <dt class="text-ink-muted">
                                  {t('drive.inspectorSharedVia')}
                                </dt>
                                <dd class="min-w-0">
                                  <ShareProvenanceBadge provenance={prov()} />
                                </dd>
                              </div>
                            )}
                          </Show>

                          <Show when={updatedAt()}>
                            {(date) => (
                              <div class="flex items-center justify-between gap-3">
                                <dt class="text-ink-muted">
                                  {t('drive.inspectorModified')}
                                </dt>
                                <dd class="tabular-nums text-ink">
                                  {formatDateAndTime(date())}
                                </dd>
                              </div>
                            )}
                          </Show>

                          <Show when={createdAt()}>
                            {(date) => (
                              <div class="flex items-center justify-between gap-3">
                                <dt class="text-ink-muted">
                                  {t('drive.inspectorCreated')}
                                </dt>
                                <dd class="tabular-nums text-ink">
                                  {formatDateAndTime(date())}
                                </dd>
                              </div>
                            )}
                          </Show>

                          <Show when={viewedAt()}>
                            {(date) => (
                              <div class="flex items-center justify-between gap-3">
                                <dt class="text-ink-muted">
                                  {t('drive.inspectorViewed')}
                                </dt>
                                <dd class="tabular-nums text-ink">
                                  {formatDateAndTime(date())}
                                </dd>
                              </div>
                            )}
                          </Show>
                        </dl>

                        <div class="grid grid-cols-2 gap-2 border-t border-edge-muted pt-4">
                          <Show when={actions.canOpenNewSplit()}>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={(event) =>
                                actions.openEntity(
                                  entity(),
                                  event,
                                  undefined,
                                  true
                                )
                              }
                            >
                              <ColumnsIcon
                                class="size-3.5"
                                aria-hidden="true"
                              />
                              <span>{t('drive.openInNewSplit')}</span>
                            </Button>
                          </Show>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => host.shareEntities([entity()])}
                          >
                            <ShareIcon class="size-3.5" aria-hidden="true" />
                            <span>{t('drive.share')}</span>
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() =>
                              fireAndForget(
                                host.toggleStarEntities([entity()]),
                                'drive-inspector-star'
                              )
                            }
                          >
                            <Show
                              when={starred()}
                              fallback={
                                <StarIcon class="size-3.5" aria-hidden="true" />
                              }
                            >
                              <StarFillIcon
                                class="size-3.5 text-warning"
                                aria-hidden="true"
                              />
                            </Show>
                            <span>
                              {starred() ? t('drive.unstar') : t('drive.star')}
                            </span>
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() =>
                              fireAndForget(
                                host.copyLink(entity()),
                                'drive-inspector-link'
                              )
                            }
                          >
                            <LinkIcon class="size-3.5" aria-hidden="true" />
                            <span>{t('entityActions.copyLink')}</span>
                          </Button>
                          <Show when={canMutate()}>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() =>
                                inlineEdit.startRename({
                                  id: entity().id,
                                  name: entity().name,
                                  isFolder: entity().type === 'project',
                                  surface: 'inspector',
                                })
                              }
                            >
                              <PencilIcon class="size-3.5" aria-hidden="true" />
                              <span>{t('drive.rename')}</span>
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => host.openMoveDialog([entity()])}
                            >
                              <FolderIcon class="size-3.5" aria-hidden="true" />
                              <span>{t('drive.move')}</span>
                            </Button>
                          </Show>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() =>
                              fireAndForget(
                                host.duplicateEntities([entity()]),
                                'drive-inspector-dup'
                              )
                            }
                          >
                            <CopyIcon class="size-3.5" aria-hidden="true" />
                            <span>{t('drive.duplicate')}</span>
                          </Button>
                          <Show when={canMutate()}>
                            <Button
                              variant="secondary"
                              size="sm"
                              class="text-failure-ink hover:text-failure-ink"
                              onClick={() =>
                                fireAndForget(
                                  host.trashEntitiesWithUndo([entity()]),
                                  'drive-inspector-trash'
                                )
                              }
                            >
                              <TrashIcon class="size-3.5" aria-hidden="true" />
                              <span>{t('drive.moveToTrash')}</span>
                            </Button>
                          </Show>
                        </div>
                      </div>
                    }
                  >
                    <Show
                      when={entity().type !== 'project'}
                      fallback={<FolderQuickPreview folder={entity()} />}
                    >
                      <div class="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-surface">
                        <Show
                          when={previewTarget()}
                          keyed
                          fallback={
                            <div class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-xs text-ink-muted">
                              <span class="size-10">
                                <EntityRowIcon entity={entity()} />
                              </span>
                              <span>{driveKindLabel(kind())}</span>
                            </div>
                          }
                        >
                          {(target) => (
                            <DetailErrorBoundary
                              entityType={target.type}
                              entityId={target.id}
                            >
                              <Suspense
                                fallback={
                                  <div class="grid size-full place-items-center text-ink-muted">
                                    <SpinnerIcon
                                      class="size-5 animate-spin"
                                      aria-hidden="true"
                                    />
                                  </div>
                                }
                              >
                                <div class="size-full min-h-0 overflow-auto">
                                  <EntityDetail target={target} />
                                </div>
                              </Suspense>
                            </DetailErrorBoundary>
                          )}
                        </Show>
                      </div>
                    </Show>
                  </Show>
                </div>
              );
            }}
          </Match>
        </Switch>
      </aside>
    </Show>
  );
}
