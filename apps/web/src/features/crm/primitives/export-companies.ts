import type { CrmCompanyEntity } from '@entity';
import { createMemo, createSignal, onCleanup } from 'solid-js';
import type {
  DealStages,
  ExportDefinitionsSource,
} from '../context/crm-sources';
import {
  companyExportRecord,
  type ExportColumn,
  type ExportRecord,
  personExportRecord,
} from '../core/export';
import type { CrmPerson } from '../core/people';

export type CrmExportOptions = {
  kind: 'companies' | 'people';
  currentView: string;
  onLoad: (
    scope: 'current' | 'all',
    signal: AbortSignal,
    progress: (count: number) => void
  ) => Promise<{ companies?: CrmCompanyEntity[]; people?: CrmPerson[] }>;
};
export function createCrmExport(
  props: CrmExportOptions,
  dependencies: {
    baseColumns: ExportColumn[];
    definitions: ExportDefinitionsSource;
    stages: DealStages;
    userEmail(id: string): string;
    ownerId(company: CrmCompanyEntity): string | undefined;
    stageId: string;
    ownerPropertyId: string;
  }
) {
  const { definitions, stages, userEmail: idToEmail } = dependencies;
  const baseColumns = dependencies.baseColumns;
  const [scope, setScope] = createSignal<'current' | 'all'>('current');
  const [selected, setSelected] = createSignal(
    baseColumns.filter((column) => column.default).map((column) => column.id)
  );
  const [rows, setRows] = createSignal<ExportRecord[]>();
  const [pending, setPending] = createSignal(false);
  const [progress, setProgress] = createSignal(0);
  const [error, setError] = createSignal('');
  let controller: AbortController | undefined;
  onCleanup(() => controller?.abort());
  const propertyDefinitions = () =>
    props.kind === 'companies' && definitions.isSuccess ? definitions.data : [];
  const columns = createMemo<ExportColumn[]>(() => [
    ...baseColumns,
    ...propertyDefinitions().flatMap((entry) => {
      const definition = 'definition' in entry ? entry.definition : entry;
      if (
        definition.is_metadata ||
        baseColumns.some(
          (column) => column.id === `property:${definition.id}`
        ) ||
        [
          dependencies.stageId,
          dependencies.ownerPropertyId,
          stages.stageDefinitionId(),
        ].includes(definition.id)
      )
        return [];
      return [
        { id: `property:${definition.id}`, label: definition.display_name },
      ];
    }),
  ]);
  const selectedColumns = () =>
    columns().filter((column) => selected().includes(column.id));
  const options = createMemo(
    () =>
      new Map(
        propertyDefinitions().flatMap((entry) =>
          'property_options' in entry
            ? entry.property_options.map(
                (option) => [option.id, String(option.value.value)] as const
              )
            : []
        )
      )
  );
  const formatProperty = (
    property: NonNullable<CrmCompanyEntity['properties']>[number]
  ) => {
    const value = property.value;
    if (!value) return '';
    if (value.type === 'SelectOption')
      return value.value.map((id) => options().get(id) ?? id).join('; ');
    if (value.type === 'EntityReference')
      return value.value
        .map((ref) =>
          ref.entity_id.startsWith('macro|')
            ? idToEmail(ref.entity_id)
            : ref.entity_id
        )
        .join('; ');
    return Array.isArray(value.value) ? value.value.join('; ') : value.value;
  };
  const metadataLoading = () =>
    props.kind === 'companies' && (definitions.isPending || stages.isLoading());
  const metadataError = () =>
    props.kind === 'companies' && (definitions.isError || stages.isError());
  const filename = () =>
    `macro-${
      scope() === 'all'
        ? `all-${props.kind}`
        : props.currentView
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || props.kind
    }-${new Date().toISOString().slice(0, 10)}.csv`;
  async function prepare() {
    if (pending()) return;
    controller = new AbortController();
    const signal = controller.signal;
    setPending(true);
    setError('');
    setProgress(0);
    setRows(undefined);
    try {
      const result = await props.onLoad(scope(), signal, setProgress);
      signal.throwIfAborted();
      setRows(
        result.people
          ? result.people.map(personExportRecord)
          : (result.companies ?? []).map((company) => {
              const stageId = stages.resolveStage(company);
              const owner = dependencies.ownerId(company);
              return companyExportRecord(
                company,
                stageId ? (stages.stageLabel(stageId) ?? stageId) : '',
                owner ? idToEmail(owner) : '',
                formatProperty
              );
            })
      );
    } catch (cause) {
      if (!signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : 'Could not prepare the export. Please retry.'
        );
    } finally {
      if (!signal.aborted) setPending(false);
    }
  }
  return {
    baseColumns,
    scope,
    setScope,
    selected,
    setSelected,
    rows,
    setRows,
    pending,
    progress,
    error,
    setError,
    columns,
    selectedColumns,
    metadataLoading,
    metadataError,
    filename,
    prepare,
  };
}
