import { t } from '@app/lib/i18n';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { fileDrop } from '@core/directive/fileDrop';
import type {
  ImportDroppedPart,
  ImportItemKind,
  ImportSkipReason,
  ParsedImportFolder,
} from '@core/password-import/types';
import FolderIcon from '@icon/system/regular/folder.svg';
import LockIcon from '@icon/system/regular/lock.svg';
import TrayArrowDownIcon from '@icon/system/regular/tray-arrow-down.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import { Button, Checkbox, Dropdown } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import type {
  ImportDestination,
  ImportFileFailure,
  ImportPreview,
} from '../context/passwords-context';
import {
  MAX_FOLDER_DEPTH,
  MAX_TEAM_FOLDERS,
  VAULT_LIST_CAP,
} from '../core/import';
import { folderPath, type PasswordFolder } from '../core/types';
import { KIND_ICONS } from './kind-icon';

false && fileDrop;

const ACCEPTED_EXTENSIONS = ['1pux', 'csv', 'json'];
/** Rows shown before a list says how many more there are. */
const LIST_LIMIT = 50;

export function importFailureText(failure: ImportFileFailure) {
  return match(failure)
    .with({ code: 'invalid_json' }, ({ line }) =>
      t('passwords.importError_invalid_json', { line })
    )
    .with({ code: 'invalid_csv' }, ({ row }) =>
      t('passwords.importError_invalid_csv', { row })
    )
    .with({ code: 'unknown_format' }, () =>
      t('passwords.importError_unknown_format')
    )
    .with({ code: 'too_large' }, () => t('passwords.importError_too_large'))
    .with({ code: 'zip_bomb' }, () => t('passwords.importError_zip_bomb'))
    .with({ code: 'too_many_entries' }, () =>
      t('passwords.importError_too_many_entries')
    )
    .with({ code: 'too_many_items' }, () =>
      t('passwords.importError_too_many_items')
    )
    .with({ code: 'path_traversal' }, () =>
      t('passwords.importError_path_traversal')
    )
    .with({ code: 'invalid_zip' }, () => t('passwords.importError_invalid_zip'))
    .with({ code: 'missing_export_data' }, () =>
      t('passwords.importError_missing_export_data')
    )
    .with({ code: 'encrypted_bitwarden' }, () =>
      t('passwords.importError_encrypted_bitwarden')
    )
    .with({ code: 'unsupported_version' }, () =>
      t('passwords.importError_unsupported_version')
    )
    .with({ code: 'unreadable' }, () => t('passwords.importError_unreadable'))
    .exhaustive();
}

/** Choose or drop one export file. */
export function ImportFilePicker(props: {
  failure?: ImportFileFailure;
  onFile: (file: File) => void;
}) {
  const [dragging, setDragging] = createSignal(false);
  let input: HTMLInputElement | undefined;
  return (
    <div class="flex flex-col gap-3">
      <p class="text-sm text-ink-muted">{t('passwords.importIntro')}</p>
      <div
        class="relative flex min-h-40 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-edge p-6 text-center"
        use:fileDrop={{
          acceptedFileExtensions: ACCEPTED_EXTENSIONS,
          multiple: false,
          onDragStart: (valid) => setDragging(valid),
          onDragEnd: () => setDragging(false),
          onDrop: (files) => {
            setDragging(false);
            const file = files[0];
            if (file) props.onFile(file);
          },
        }}
      >
        <Show when={dragging()}>
          <FileDropOverlay>{t('passwords.importDrop')}</FileDropOverlay>
        </Show>
        <TrayArrowDownIcon class="size-5 text-ink-extra-muted" />
        <p class="text-sm text-ink-muted">{t('passwords.importDrop')}</p>
        <input
          ref={input}
          type="file"
          class="hidden"
          accept={ACCEPTED_EXTENSIONS.map((extension) => `.${extension}`).join(
            ','
          )}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            // Cleared so choosing the same file again still reports it.
            event.currentTarget.value = '';
            if (file) props.onFile(file);
          }}
        />
        <Button variant="secondary" size="sm" onClick={() => input?.click()}>
          {t('passwords.importChoose')}
        </Button>
      </div>
      <Show when={props.failure}>
        {(failure) => (
          <p role="alert" class="text-sm text-failure-ink">
            {importFailureText(failure())}
          </p>
        )}
      </Show>
    </div>
  );
}

function Section(props: { title: string; children: JSX.Element }) {
  return (
    <section class="flex flex-col gap-1.5">
      <h3 class="text-xs font-medium text-ink-muted">{props.title}</h3>
      {props.children}
    </section>
  );
}

function FolderList(props: { folders: ParsedImportFolder[] }) {
  return (
    <ul class="flex max-h-40 flex-col overflow-auto text-sm">
      <For each={props.folders.slice(0, LIST_LIMIT)}>
        {(folder) => (
          <li
            class="flex min-w-0 items-center gap-1.5 py-0.5"
            style={{ 'padding-left': `${(folder.path.length - 1) * 16}px` }}
          >
            <FolderIcon class="size-3.5 shrink-0 text-ink-extra-muted" />
            <span class="truncate">{folder.name}</span>
          </li>
        )}
      </For>
      <Show when={props.folders.length > LIST_LIMIT}>
        <li class="py-0.5 text-ink-muted">
          {t('passwords.importFolderCount', {
            count: props.folders.length - LIST_LIMIT,
          })}
          …
        </li>
      </Show>
    </ul>
  );
}

function skipReasonText(reason: ImportSkipReason) {
  return t(`passwords.importSkip_${reason}`);
}

function destinationLabel(
  destination: ImportDestination,
  preview: ImportPreview,
  folders: PasswordFolder[]
) {
  if (destination === 'new')
    return t('passwords.importNewFolder', { name: preview.newFolderName });
  if (destination === 'root') return t('passwords.importRoot');
  return folderPath(folders, destination.slice('folder:'.length)).join(' / ');
}

/** Counts, folders, what is left out, and where the items go. */
export function ImportPreviewStep(props: {
  preview: ImportPreview;
  vaultFolders: PasswordFolder[];
  destination: ImportDestination;
  onDestination: (destination: ImportDestination) => void;
  skipDuplicates: boolean;
  onSkipDuplicates: (skip: boolean) => void;
  makePrivate: boolean;
  onPrivate: (value: boolean) => void;
  folderCheck?: {
    total: number;
    depth: number;
    tooMany: boolean;
    tooDeep: boolean;
  };
}) {
  const kinds = () =>
    Object.entries(props.preview.summary.itemsByKind) as [
      ImportItemKind,
      number,
    ][];
  const skippedReasons = () =>
    Object.entries(props.preview.summary.skippedByReason) as [
      ImportSkipReason,
      number,
    ][];
  const dropped = () =>
    Object.entries(props.preview.summary.droppedByPart) as [
      ImportDroppedPart,
      number,
    ][];
  return (
    <div class="flex flex-col gap-4" data-passwords-import-preview>
      <p class="text-sm">
        <span class="font-medium">
          {t(`passwords.importSource_${props.preview.format}`)}
        </span>
        {' · '}
        {t('passwords.importItems', { count: props.preview.itemCount })}
        <Show when={props.preview.folders.length > 0}>
          {' · '}
          {t('passwords.importFolderCount', {
            count: props.preview.folders.length,
          })}
        </Show>
      </p>
      <Show when={props.preview.resumed}>
        <p class="text-sm text-ink-muted">{t('passwords.importResumed')}</p>
      </Show>
      <Show when={props.preview.restarted}>
        <p class="text-sm text-ink-muted">{t('passwords.importRestarted')}</p>
      </Show>
      <ul class="flex flex-wrap gap-2" aria-label={t('passwords.kind')}>
        <For each={kinds()}>
          {([kind, count]) => (
            <li class="flex items-center gap-1.5 rounded-full border border-edge-muted px-2.5 py-1 text-xs">
              <Dynamic component={KIND_ICONS[kind]} class="size-3.5 shrink-0" />
              <span>{t(`passwords.${kind}`)}</span>
              <span class="text-ink-muted">{count}</span>
            </li>
          )}
        </For>
      </ul>
      <Show when={props.preview.folders.length > 0}>
        <Section title={t('passwords.folders')}>
          <FolderList folders={props.preview.folders} />
        </Section>
      </Show>
      <Show when={props.preview.duplicatesPartial}>
        <p class="text-sm text-ink-muted">
          {t('passwords.importDuplicatesPartial', { count: VAULT_LIST_CAP })}
        </p>
      </Show>
      <Show when={props.preview.duplicates > 0}>
        <div class="flex flex-col gap-1.5">
          <p class="text-sm">
            {t('passwords.importDuplicates', {
              count: props.preview.duplicates,
            })}
          </p>
          <Checkbox
            checked={props.skipDuplicates}
            onChange={props.onSkipDuplicates}
          >
            <Checkbox.Control />
            <Checkbox.Label>
              {t('passwords.importSkipDuplicates')}
            </Checkbox.Label>
          </Checkbox>
          <Show
            when={
              props.skipDuplicates &&
              props.preview.duplicates === props.preview.itemCount
            }
          >
            <p class="text-sm text-ink-muted" data-passwords-import-all-present>
              {t('passwords.importAllPresent')}
            </p>
          </Show>
        </div>
      </Show>
      <Show when={props.preview.skipped.length > 0}>
        <Section title={t('passwords.importSkippedTitle')}>
          <ul class="flex flex-col text-sm">
            <For each={skippedReasons()}>
              {([reason, count]) => (
                <li class="flex justify-between gap-2">
                  <span>{skipReasonText(reason)}</span>
                  <span class="text-ink-muted">{count}</span>
                </li>
              )}
            </For>
          </ul>
          <details class="text-sm">
            <summary class="text-ink-muted">
              {t('passwords.importShowSkipped')}
            </summary>
            <ul class="mt-1 flex max-h-40 flex-col overflow-auto">
              <For each={props.preview.skipped.slice(0, LIST_LIMIT)}>
                {(skipped) => (
                  <li class="flex min-w-0 justify-between gap-2">
                    <span class="truncate">
                      {skipped.name ?? t('passwords.importUnnamed')}
                    </span>
                    <span class="shrink-0 text-ink-muted">
                      {skipReasonText(skipped.reason)}
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </details>
        </Section>
      </Show>
      <Show when={dropped().length > 0}>
        <Section title={t('passwords.importDroppedTitle')}>
          <ul class="flex flex-col text-sm">
            <For each={dropped()}>
              {([part, count]) => (
                <li>{t(`passwords.importDropped_${part}`, { count })}</li>
              )}
            </For>
          </ul>
        </Section>
      </Show>
      <div class="flex flex-col gap-2 border-t border-edge-muted pt-4">
        <span class="text-xs font-medium text-ink-muted">
          {t('passwords.importDestination')}
        </span>
        <div class="flex flex-wrap items-center gap-2">
          <p class="flex min-w-0 basis-full items-start gap-1.5 text-sm">
            <FolderIcon class="mt-0.5 size-4 shrink-0" />
            <span class="min-w-0 break-words" data-passwords-import-target>
              {destinationLabel(
                props.destination,
                props.preview,
                props.vaultFolders
              )}
            </span>
          </p>
          <Dropdown>
            <Dropdown.Trigger
              variant="secondary"
              size="sm"
              disabled={props.preview.resumed}
              aria-label={t('passwords.importDestinationChange')}
            >
              {t('passwords.importDestinationChange')}
            </Dropdown.Trigger>
            <Dropdown.Content class="min-w-56 max-w-[calc(100vw-2rem)]">
              <Dropdown.Item onSelect={() => props.onDestination('new')}>
                <span class="min-w-0 break-words">
                  {t('passwords.importNewFolder', {
                    name: props.preview.newFolderName,
                  })}
                </span>
              </Dropdown.Item>
              <Dropdown.Item onSelect={() => props.onDestination('root')}>
                {t('passwords.importRoot')}
              </Dropdown.Item>
              <For each={props.vaultFolders}>
                {(folder) => (
                  <Dropdown.Item
                    onSelect={() => props.onDestination(`folder:${folder.id}`)}
                  >
                    <span class="min-w-0 break-words">
                      {folderPath(props.vaultFolders, folder.id).join(' / ')}
                    </span>
                  </Dropdown.Item>
                )}
              </For>
            </Dropdown.Content>
          </Dropdown>
          <Checkbox
            checked={props.makePrivate}
            onChange={props.onPrivate}
            disabled={props.preview.resumed}
          >
            <Checkbox.Control />
            <Checkbox.Label class="flex items-center gap-1.5">
              <Show
                when={props.makePrivate}
                fallback={<UsersIcon class="size-4 shrink-0" />}
              >
                <LockIcon class="size-4 shrink-0" />
              </Show>
              {t('passwords.importPrivate')}
            </Checkbox.Label>
          </Checkbox>
        </div>
        <Show when={props.folderCheck?.tooMany}>
          <p role="alert" class="text-sm text-failure-ink">
            {t('passwords.importTooManyFolders', {
              total: props.folderCheck?.total ?? 0,
              limit: MAX_TEAM_FOLDERS,
            })}
          </p>
        </Show>
        <Show when={props.folderCheck?.tooDeep}>
          <p role="alert" class="text-sm text-failure-ink">
            {t('passwords.importTooDeep', {
              depth: props.folderCheck?.depth ?? 0,
              limit: MAX_FOLDER_DEPTH,
            })}
          </p>
        </Show>
      </div>
    </div>
  );
}

export function ImportProgressStep(props: { done: number; total: number }) {
  return (
    <div class="flex flex-col gap-2" aria-live="polite">
      <p class="text-sm">
        {t('passwords.importProgress', {
          done: props.done,
          total: props.total,
        })}
      </p>
      <progress
        class="h-1.5 w-full overflow-hidden rounded-full accent-accent"
        max={Math.max(props.total, 1)}
        value={props.done}
      />
    </div>
  );
}

export function ImportResultStep(props: {
  created: number;
  alreadyPresent: number;
  skipped: number;
  failed: number;
}) {
  return (
    <div class="flex flex-col gap-2" data-passwords-import-result>
      <p class="text-sm font-medium">{t('passwords.importDone')}</p>
      <ul class="flex flex-col text-sm">
        <li>{t('passwords.importCreated', { count: props.created })}</li>
        <Show when={props.alreadyPresent > 0}>
          <li>
            {t('passwords.importAlreadyPresent', {
              count: props.alreadyPresent,
            })}
          </li>
        </Show>
        <Show when={props.skipped > 0}>
          <li>{t('passwords.importSkippedCount', { count: props.skipped })}</li>
        </Show>
        <Show when={props.failed > 0}>
          <li class="text-failure-ink">
            {t('passwords.importFailedCount', { count: props.failed })}
          </li>
        </Show>
      </ul>
      <Show when={props.failed > 0}>
        <p class="text-sm text-ink-muted">{t('passwords.importRetryHint')}</p>
      </Show>
    </div>
  );
}
