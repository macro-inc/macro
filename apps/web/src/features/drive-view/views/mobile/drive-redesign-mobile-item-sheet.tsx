import { t } from '@app/lib/i18n';
import {
  MobileDrawer,
  scrollToFocusedInput,
} from '@components/app/mobile/MobileDrawer';
import { triggerFocusNewElement } from '@core/directive/focusInput';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  type EntityData,
  EntityRowIcon,
  formatRelativeTimestamp,
} from '@entity';
import ShareIcon from '@icon/share.svg';
import StarFillIcon from '@icon/system/fill/star-fill.svg';
import ArrowUpRightIcon from '@icon/system/regular/arrow-up-right.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import FolderIcon from '@icon/system/regular/folder.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import PencilIcon from '@icon/system/regular/pencil-line.svg';
import StarIcon from '@icon/system/regular/star.svg';
import TrashIcon from '@icon/system/regular/trash-simple.svg';
import { Button } from '@ui';
import { createEffect, createSignal, Show } from 'solid-js';
import { driveKindLabel } from '../../components/redesign/kind-label';
import { useDriveView } from '../../context/drive-context';
import { useDriveRedesign } from '../../context/drive-redesign-context';
import { driveItemKind, renameSelectionRange } from '../../core/drive-items';

/**
 * Bottom touch action sheet for a Drive file or folder: shows metadata,
 * supports extension-preserving inline rename inside the sheet, and exposes
 * Open, Move, Star, Share, Duplicate, Copy Link, and undoable Move to Trash.
 */
export function DriveRedesignMobileItemSheet(props: {
  entity: EntityData | undefined;
  onClose: () => void;
}) {
  const { actions, sidebar } = useDriveView();
  const { host } = useDriveRedesign();

  const [renaming, setRenaming] = createSignal(false);
  const [draftName, setDraftName] = createSignal('');
  const [pending, setPending] = createSignal(false);
  let renameInputRef: HTMLInputElement | undefined;

  createEffect(() => {
    const current = props.entity;
    setRenaming(false);
    setDraftName(current?.name ?? '');
  });

  const startRename = () => {
    const current = props.entity;
    if (!current) return;
    setDraftName(current.name);
    // Register the focus watcher BEFORE mounting the rename input so Solid's
    // synchronous render effect doesn't beat the observer on iOS.
    triggerFocusNewElement('[data-drive-mobile-rename-input]', {
      touchOnly: false,
    });
    setRenaming(true);
    requestAnimationFrame(() => {
      if (!renameInputRef) return;
      const range = renameSelectionRange(
        current.name,
        current.type === 'project'
      );
      try {
        renameInputRef.setSelectionRange(range.start, range.end);
      } catch {
        renameInputRef.select();
      }
    });
  };

  const commitRename = async () => {
    const current = props.entity;
    const trimmed = draftName().trim();
    if (!current || !trimmed || trimmed === current.name) {
      setRenaming(false);
      return;
    }
    setPending(true);
    try {
      await host.renameEntityInline(current, trimmed);
      setRenaming(false);
      props.onClose();
    } finally {
      setPending(false);
    }
  };

  const parentFolderName = () => {
    const current = props.entity;
    if (!current || !('projectId' in current) || !current.projectId) {
      return t('drive.unfiledLocation');
    }
    return (
      sidebar.folders().find((f) => f.id === current.projectId)?.name ??
      t('drive.unfiledLocation')
    );
  };

  const updatedAt = () => {
    const current = props.entity;
    if (!current) return undefined;
    const raw =
      current.type === 'database' || current.type === 'form'
        ? current.createdAt
        : current.updatedAt;
    if (raw == null) return undefined;
    return typeof raw === 'number' ? new Date(raw) : raw;
  };

  return (
    <MobileDrawer
      side="bottom"
      open={Boolean(props.entity)}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content
          aria-label={props.entity?.name ?? t('drive.moreActions')}
          maxHeight={85}
        >
          <MobileDrawer.Handle />
          <Show when={props.entity}>
            {(entity) => {
              const kind = () => driveItemKind(entity());
              const starred = () => host.isStarred(entity());
              const canMutate = () => host.canMutateEntity(entity());
              const isFolder = () => entity().type === 'project';

              return (
                <>
                  {/* Sheet identity header */}
                  <div class="flex shrink-0 items-center gap-3 px-5 pb-3">
                    <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-inset">
                      <EntityRowIcon entity={entity()} class="size-5" />
                    </span>
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-base font-semibold text-ink">
                        {entity().name}
                      </div>
                      <div class="truncate text-xs text-ink-muted">
                        {driveKindLabel(kind())} · {parentFolderName()}
                        <Show when={updatedAt()}>
                          {(date) => ` · ${formatRelativeTimestamp(date())}`}
                        </Show>
                      </div>
                    </div>
                  </div>

                  <MobileDrawer.ScrollBody
                    class="gap-3 px-1"
                    onFocusIn={(event) => scrollToFocusedInput(event)}
                  >
                    <Show
                      when={renaming()}
                      fallback={
                        <>
                          <MobileDrawer.Section>
                            <MobileDrawer.Item
                              onClick={(event) => {
                                const target = entity();
                                props.onClose();
                                actions.openEntity(target, event);
                              }}
                            >
                              <ArrowUpRightIcon
                                class="size-5 shrink-0 text-ink-muted"
                                aria-hidden="true"
                              />
                              <span>
                                {isFolder()
                                  ? t('drive.openFolder')
                                  : t('drive.openFullView')}
                              </span>
                            </MobileDrawer.Item>

                            <Show when={canMutate()}>
                              <MobileDrawer.Item onClick={startRename}>
                                <PencilIcon
                                  class="size-5 shrink-0 text-ink-muted"
                                  aria-hidden="true"
                                />
                                <span>{t('drive.rename')}</span>
                              </MobileDrawer.Item>
                              <MobileDrawer.Item
                                onClick={() => {
                                  const target = entity();
                                  props.onClose();
                                  host.openMoveDialog([target]);
                                }}
                              >
                                <FolderIcon
                                  class="size-5 shrink-0 text-ink-muted"
                                  aria-hidden="true"
                                />
                                <span>{t('drive.move')}</span>
                              </MobileDrawer.Item>
                            </Show>

                            <MobileDrawer.Item
                              onClick={() => {
                                const target = entity();
                                props.onClose();
                                fireAndForget(
                                  host.toggleStarEntities([target]),
                                  'drive-mobile-star'
                                );
                              }}
                            >
                              <Show
                                when={starred()}
                                fallback={
                                  <StarIcon
                                    class="size-5 shrink-0 text-ink-muted"
                                    aria-hidden="true"
                                  />
                                }
                              >
                                <StarFillIcon
                                  class="size-5 shrink-0 text-warning"
                                  aria-hidden="true"
                                />
                              </Show>
                              <span>
                                {starred()
                                  ? t('drive.unstar')
                                  : t('drive.star')}
                              </span>
                            </MobileDrawer.Item>

                            <MobileDrawer.Item
                              onClick={() => {
                                const target = entity();
                                props.onClose();
                                host.shareEntities([target]);
                              }}
                            >
                              <ShareIcon
                                class="size-5 shrink-0 text-ink-muted"
                                aria-hidden="true"
                              />
                              <span>{t('drive.share')}</span>
                            </MobileDrawer.Item>

                            <Show when={entity().type === 'document'}>
                              <MobileDrawer.Item
                                onClick={() => {
                                  const target = entity();
                                  props.onClose();
                                  fireAndForget(
                                    host.duplicateEntities([target]),
                                    'drive-mobile-duplicate'
                                  );
                                }}
                              >
                                <CopyIcon
                                  class="size-5 shrink-0 text-ink-muted"
                                  aria-hidden="true"
                                />
                                <span>{t('drive.duplicate')}</span>
                              </MobileDrawer.Item>
                            </Show>

                            <MobileDrawer.Item
                              onClick={() => {
                                const target = entity();
                                props.onClose();
                                fireAndForget(
                                  host.copyLink(target),
                                  'drive-mobile-copy-link'
                                );
                              }}
                            >
                              <LinkIcon
                                class="size-5 shrink-0 text-ink-muted"
                                aria-hidden="true"
                              />
                              <span>Copy link</span>
                            </MobileDrawer.Item>
                          </MobileDrawer.Section>

                          <Show when={canMutate()}>
                            <MobileDrawer.Section>
                              <MobileDrawer.Item
                                class="text-failure-ink"
                                onClick={() => {
                                  const target = entity();
                                  props.onClose();
                                  fireAndForget(
                                    host.trashEntitiesWithUndo([target]),
                                    'drive-mobile-trash'
                                  );
                                }}
                              >
                                <TrashIcon
                                  class="size-5 shrink-0"
                                  aria-hidden="true"
                                />
                                <span>{t('drive.moveToTrash')}</span>
                              </MobileDrawer.Item>
                            </MobileDrawer.Section>
                          </Show>
                        </>
                      }
                    >
                      <div class="flex flex-col gap-3 px-4 pb-2">
                        <label class="text-xs font-medium text-ink-muted">
                          {t('drive.rename')}
                        </label>
                        <input
                          ref={renameInputRef}
                          type="text"
                          data-rename-field
                          data-drive-mobile-rename-input
                          aria-label={t('drive.renameInputLabel', {
                            name: entity().name,
                          })}
                          value={draftName()}
                          disabled={pending()}
                          class="h-11 w-full rounded-xl border border-edge-focus bg-surface px-3 text-base text-ink outline-none ring-2 ring-accent/20"
                          onInput={(event) =>
                            setDraftName(event.currentTarget.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              fireAndForget(
                                commitRename(),
                                'drive-mobile-rename'
                              );
                            }
                          }}
                        />
                        <div class="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="md"
                            onClick={() => setRenaming(false)}
                          >
                            Cancel
                          </Button>
                          <Button
                            variant="primary"
                            size="md"
                            disabled={pending() || !draftName().trim()}
                            onClick={() =>
                              fireAndForget(
                                commitRename(),
                                'drive-mobile-rename'
                              )
                            }
                          >
                            Save
                          </Button>
                        </div>
                      </div>
                    </Show>
                  </MobileDrawer.ScrollBody>
                </>
              );
            }}
          </Show>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
