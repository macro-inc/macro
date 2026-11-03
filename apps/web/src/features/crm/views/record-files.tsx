import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import { catchToResult } from '@core/util/result';
import type { EntityData } from '@entity';
import { Button } from '@ui';
import { createMemo, createSignal, Show } from 'solid-js';
import { FileTypeSelect } from '../components/file-type-select';
import { RecordSection } from '../components/record-section';
import { useCrmContext } from '../context/crm-context';
import type { FileTypesSource } from '../context/file-types';
import { groupFilesByType } from '../core/file-types';
import type { CrmRecordScope } from '../core/record';
import { AttachFileDialog } from './attach-file-dialog';
import { ManageFileTypes } from './manage-file-types';
import { RecordItemList } from './record-item-list';

/** Both surfaces read classification from the file, never from its record link. */
export function RecordFiles(props: {
  scope?: CrmRecordScope;
  overview?: boolean;
}) {
  const context = useCrmContext();
  const files = context.createRecordFiles(() => props.scope);
  const types = context.createFileTypes();
  const navigation = context.createNavigation();
  const ids = createMemo(() =>
    files.isPending || files.isError
      ? []
      : (files.data?.entities.map((entity) => entity.id) ?? [])
  );
  const classifications = types.classifications(ids);
  const [search, setSearch] = createSignal('');
  const [dialog, setDialog] = createSignal<'attach' | 'manage'>();
  const [setupPending, setSetupPending] = createSignal(false);
  const [error, setError] = createSignal(false);
  async function setup() {
    if (setupPending()) return;
    setSetupPending(true);
    setError(false);
    const result = await catchToResult(() => types.initialize());
    setError(result.isErr());
    setSetupPending(false);
  }
  const actions = () => (
    <Show when={types.canManage()}>
      <Show
        when={types.data()}
        fallback={
          <Button
            variant="outline"
            disabled={types.pending() || setupPending()}
            onClick={() => fireAndForget(setup(), 'crm-files')}
          >
            {t('crmFiles.setupTypes')}
          </Button>
        }
      >
        <Button variant="ghost" onClick={() => setDialog('manage')}>
          {t('crmFiles.manageTypes')}
        </Button>
        <Button
          variant="outline"
          disabled={!props.scope}
          onClick={() => setDialog('attach')}
        >
          {t('crmFiles.addFile')}
        </Button>
      </Show>
    </Show>
  );
  const list = () => (
    <>
      <Show when={error()}>
        <p role="alert" class="p-3 text-sm text-failure">
          {t('crmFiles.setupFailed')}
        </p>
      </Show>
      <Show when={types.error() || classifications.error()}>
        <div class="flex items-center gap-2 p-3 text-sm text-ink-muted">
          <span>{t('crmFiles.refreshTypesFailed')}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              fireAndForget(
                Promise.all([types.refresh(), classifications.refresh()]),
                'crm-files'
              )
            }
          >
            {t('crmFiles.retry')}
          </Button>
        </div>
      </Show>
      <Show
        when={
          types.canManage() &&
          !types.error() &&
          (types.pending() || classifications.pending())
        }
      >
        <p class="px-3 py-2 text-xs text-ink-muted">
          {t('crmFiles.loadingTypes')}
        </p>
      </Show>
      <RecordItemList
        source={files}
        pending={!props.scope}
        search={search()}
        groupScopeKey={JSON.stringify([
          types.sessionKey(),
          props.scope?.type,
          props.scope?.id,
        ])}
        empty={
          props.scope?.type === 'company'
            ? t('crmFiles.noCompanyFiles')
            : props.scope?.type === 'contact'
              ? t('crmFiles.noContactFiles')
              : t('crmFiles.noRecordFiles')
        }
        messages={{
          loading: t('crmFiles.loadingFiles'),
          loadFailed: t('crmFiles.loadFailed'),
          searchingMore: t('crmFiles.searchingMore'),
          noMatches: t('crmFiles.noMatchingFiles'),
          loadMoreFailed: t('crmFiles.loadMoreFailed'),
          loadingMore: t('crmFiles.loadingMore'),
          retry: t('crmFiles.retry'),
          more: t('crmFiles.moreFiles'),
        }}
        groupItems={(items) => {
          const catalog = types.data();
          const values = classifications.data();
          if (catalog === undefined || values === undefined)
            return [{ id: 'all', name: '', files: items }];
          return groupFilesByType(items, catalog?.options ?? [], values, {
            unclassified: t('crmFiles.unclassified'),
            unavailable: t('crmFiles.unavailable'),
          });
        }}
        rowActions={(entity) => (
          <Show when={classifications.data() !== undefined}>
            <FileTypeEditor
              entity={entity}
              source={types}
              value={classifications.data()?.get(entity.id)}
            />
          </Show>
        )}
      />
    </>
  );
  return (
    <>
      <Show
        when={props.overview}
        fallback={
          <RecordSection
            title={t('crmFiles.files')}
            searchLabel={t('crmFiles.searchFiles')}
            searchPlaceholder={t('crmFiles.searchFilesPlaceholder')}
            search={search()}
            onSearchChange={setSearch}
            actions={actions()}
          >
            {list()}
          </RecordSection>
        }
      >
        <section aria-label={t('crmFiles.files')} class="min-w-0">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-sm font-medium">{t('crmFiles.files')}</h2>
            <div class="flex flex-wrap items-center gap-2">{actions()}</div>
          </div>
          {list()}
        </section>
      </Show>
      <Show when={dialog() === 'manage'}>
        <ManageFileTypes source={types} onClose={() => setDialog(undefined)} />
      </Show>
      <Show when={dialog() === 'attach' && props.scope} keyed>
        {(scope) => (
          <AttachFileDialog
            source={types}
            record={scope}
            onClose={() => setDialog(undefined)}
            onOpenCreated={(id) => navigation.openWithSplit({ type: 'md', id })}
          />
        )}
      </Show>
    </>
  );
}

function FileTypeEditor(props: {
  entity: EntityData;
  source: FileTypesSource;
  value: string | null | undefined;
}) {
  const editable = props.source.canEdit(() => props.entity.id);
  const value = () =>
    props.value === null ||
    props.source.data()?.options.some((option) => option.id === props.value)
      ? props.value
      : undefined;
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal(false);
  async function save(value: string | null) {
    if (pending() || !editable()) return;
    setPending(true);
    setError(false);
    const result = await catchToResult(() =>
      props.source.classify(props.entity.id, value)
    );
    setError(result.isErr());
    setPending(false);
  }
  return (
    <Show when={props.source.data()}>
      <FileTypeSelect
        options={props.source.data()?.options ?? []}
        value={value() ?? null}
        emptyLabel={
          value() === undefined ? t('crmFiles.unavailable') : undefined
        }
        disabled={!editable() || pending() || value() === undefined}
        label={t('crmFiles.fileTypeFor', { name: props.entity.name })}
        onChange={(value) => fireAndForget(save(value), 'crm-files')}
      />
      <Show when={error()}>
        <p role="alert" class="text-xs text-failure">
          {t('crmFiles.saveTypeFailed')}
        </p>
      </Show>
    </Show>
  );
}
