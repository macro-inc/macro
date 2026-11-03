import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { fireAndForget } from '@core/util/fireAndForget';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import GlobeIcon from '@icon/system/regular/globe.svg';
import TableIcon from '@icon/system/regular/table.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Key } from '@solid-primitives/keyed';
import {
  Button,
  buttonClasses,
  Dialog,
  EntityComposer,
  Hotkey,
  Panel,
} from '@ui';
import {
  createMemo,
  createSignal,
  createUniqueId,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import {
  GridCell,
  type GridCellProps,
} from '../../database/components/grid-cell';
import { PropertyIcon } from '../../database/components/property-icon';
import type {
  DatabaseCellValue,
  DatabaseViewColumn,
} from '../../database/core/database-view';
import { canEditCell, titleColumn } from '../../database/core/table';
import type { RecordCreation } from '../../database/primitives/record-actions';
import { CompanySelect } from '../components/company-select';
import { RecordSearch } from '../components/record-search';
import type { Pipeline } from '../core/pipeline';
import {
  contactCompany,
  type DomainCompany,
  newRecordChoice,
  type RecordChoice,
  type RecordOption,
  recordChoiceProblem,
  recordDetail,
} from '../core/pipeline-record';
import {
  missingStageFields,
  requiredStageFields,
  type StageRequirement,
} from '../core/stage-requirements';
import { companyCreationError } from './create-company';
import { contactCreationError } from './create-contact';
import {
  useCreateCompanyMutation,
  useCreateContactMutation,
  useQuickAccessCrmCompaniesQuery,
  useQuickAccessCrmContactsQuery,
} from './use-crm';

type CellRenderers = Pick<
  GridCellProps,
  | 'renderTextEditor'
  | 'renderTextValue'
  | 'renderMentionPicker'
  | 'renderMentionValue'
>;

/** A form for a whole pipeline row: its company or contact, then every field the pipeline has. */
export function AddPipelineRecordDialog(
  props: CellRenderers & {
    pipeline: Pick<Pipeline, 'name' | 'recordType'>;
    columns: DatabaseViewColumn[];
    requirements?: StageRequirement[];
    requirementsLoading?: boolean;
    requirementsError?: boolean;
    /** Values the row starts with, such as the stage of the board lane it was added in. */
    initialValues: Record<string, DatabaseCellValue>;
    onCreate: (creation: RecordCreation) => Promise<boolean>;
    onClose: () => void;
  }
) {
  const company = props.pipeline.recordType === 'company';
  const createCompany = useCreateCompanyMutation();
  const createContact = useCreateContactMutation();
  const companies = useQuickAccessCrmCompaniesQuery();
  const contacts = company ? undefined : useQuickAccessCrmContactsQuery();
  const options = (): RecordOption[] =>
    contacts
      ? contacts.contacts().map((contact) => ({
          id: contact.id,
          name: contact.name || contact.email || '',
          detail: contact.email ?? '',
        }))
      : companies.companies().map((entry) => ({
          id: entry.id,
          name: entry.name,
          detail: entry.domains[0]?.domain ?? '',
        }));
  const domainCompanies = () =>
    companies.companies().flatMap<DomainCompany>((entry) =>
      entry.domains.length
        ? entry.domains.map((domain) => ({
            id: entry.id,
            domain: domain.domain,
          }))
        : [{ id: entry.id, domain: undefined }]
    );
  const companyOptions = createMemo(() =>
    companies.companies().map((company) => ({
      id: company.id,
      name: company.name,
      domain: company.domains[0]?.domain,
    }))
  );
  // One intent per dialog, so submitting again never adds a second row.
  const intentId = `pipeline-record:${createUniqueId()}`;
  const [choice, setChoice] = createSignal<RecordChoice>();
  const [draftValues, setDraftValues] = createSignal(props.initialValues);
  const [selectedOptions, setSelectedOptions] = createSignal<
    Record<string, string>
  >(
    Object.fromEntries(
      props.columns.flatMap((column) => {
        if (column.dataType !== 'SELECT_STRING' || column.isMultiSelect)
          return [];
        const option = column.options.find(
          (option) => option.label === props.initialValues[column.id]
        );
        return option ? [[column.id, option.id]] : [];
      })
    )
  );
  // Keep selections tied to option identities while schema polling renames labels.
  // Deleted columns leave the submitted row; surviving drafts retain their edits.
  const values = createMemo<Record<string, DatabaseCellValue>>(() =>
    Object.fromEntries(
      props.columns.flatMap((column) => {
        const value = draftValues()[column.id];
        if (value === undefined) return [];
        const selected = selectedOptions()[column.id];
        const option =
          selected && column.options.find((option) => option.id === selected);
        return [[column.id, option ? option.label : value]];
      })
    )
  );
  const [newOption, setNewOption] = createSignal<string>();
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [dialog, setDialog] = createSignal<HTMLElement>();
  let fieldList: HTMLDivElement | undefined;
  const title = () => titleColumn(props.columns);
  const fields = () =>
    props.columns.filter(
      (column) =>
        column.id !== title()?.id && !column.relation && canEditCell(column)
    );
  const required = () =>
    requiredStageFields(props.columns, props.requirements ?? [], values());
  const noun = company ? 'deal' : 'contact';
  const submitLabel = company ? 'Add deal' : 'Add contact';
  const existing = () => {
    const current = choice();
    return current?.kind === 'existing' ? current.record : undefined;
  };
  const newCompany = () => {
    const current = choice();
    return current?.kind === 'new-company' ? current : undefined;
  };
  const newContact = () => {
    const current = choice();
    return current?.kind === 'new-contact' ? current : undefined;
  };
  const suggestedCompany = () => {
    const match = contactCompany(newContact()?.email ?? '', domainCompanies());
    return companyOptions().find((company) => company.id === match?.id);
  };
  const changeChoice = (next: RecordChoice | undefined) => {
    setChoice(next);
    setError(undefined);
  };
  const write = (columnId: string, value: DatabaseCellValue) => {
    setDraftValues((current) => ({ ...current, [columnId]: value }));
    setSelectedOptions((current) => {
      const next = { ...current };
      const column = props.columns.find((column) => column.id === columnId);
      const option =
        column?.dataType === 'SELECT_STRING' && !column.isMultiSelect
          ? column.options.find((option) => option.label === value)
          : undefined;
      if (option) next[columnId] = option.id;
      else delete next[columnId];
      return next;
    });
    setError(undefined);
    return Promise.resolve(true);
  };

  /** The record's id, creating it first when it is new; a created record stays picked for a retry. */
  async function savedRecordId(current: RecordChoice): Promise<string> {
    if (current.kind === 'existing') return current.record.id;
    if (current.kind === 'new-company') {
      const domain = current.domain.trim().toLowerCase();
      const { id } = await createCompany.mutateAsync({
        name: current.name.trim(),
        domain: domain || undefined,
      });
      setChoice({
        kind: 'existing',
        record: { id, name: current.name.trim(), detail: domain },
      });
      return id;
    }
    const email = current.email.trim().toLowerCase();
    const joins = current.companyId
      ? companies
          .companies()
          .find((company) => company.id === current.companyId)
      : undefined;
    if (!joins) throw new Error('A new contact needs a company.');
    const { id } = await createContact.mutateAsync({
      companyId: joins.id,
      name: current.name.trim(),
      email,
    });
    setChoice({
      kind: 'existing',
      record: { id, name: current.name.trim(), detail: email },
    });
    return id;
  }

  const [attachHotkeys, hotkeyScope] = useHotkeyDOMScope(
    'add-pipeline-record',
    true
  );
  registerHotkey({
    hotkey: 'cmd+enter',
    scopeId: hotkeyScope,
    description: submitLabel,
    keyDownHandler: () => {
      fireAndForget(submit(), 'crm');
      return true;
    },
    runWithInputFocused: true,
  });

  async function submit() {
    // A field still being edited saves its value when it loses focus.
    const editing = document.activeElement;
    if (editing instanceof HTMLElement && fieldList?.contains(editing))
      editing.blur();
    const current = choice();
    const titleField = title();
    if (
      pending() ||
      props.requirementsLoading ||
      props.requirementsError ||
      !current ||
      !titleField
    )
      return;
    const deleted = props.columns.find(
      (column) =>
        column.dataType === 'SELECT_STRING' &&
        !column.isMultiSelect &&
        selectedOptions()[column.id] &&
        !column.options.some(
          (option) => option.id === selectedOptions()[column.id]
        )
    );
    if (deleted) {
      setError(
        `The selected ${deleted.name} option was deleted. Choose another value.`
      );
      return;
    }
    const missing = missingStageFields(
      required().filter((column) => column.id !== titleField.id),
      values()
    );
    if (missing.length) {
      setError(
        `Fill in ${missing.map((column) => column.name).join(', ')} for the selected stage.`
      );
      return;
    }
    const problem = recordChoiceProblem(current, domainCompanies());
    if (problem) {
      setError(problem);
      return;
    }
    setError(undefined);
    setPending(true);
    try {
      const recordId = await savedRecordId(current);
      const saved = await props.onCreate({
        values: { ...values(), [titleField.id]: recordId },
        open: false,
        intentId,
        option: newOption(),
      });
      if (saved) props.onClose();
      else setError(`Could not add this ${noun}. Try again.`);
    } catch (cause) {
      console.error(`Failed to add a pipeline ${noun}`, cause);
      setError(
        company ? companyCreationError(cause) : contactCreationError(cause)
      );
    } finally {
      setPending(false);
    }
  }

  function close() {
    if (!pending()) props.onClose();
  }

  const recordPicker = () => (
    <Switch
      fallback={
        <RecordSearch
          recordType={props.pipeline.recordType}
          options={options()}
          loading={(contacts ?? companies).query.isLoading}
          mount={dialog()}
          onPick={(record) => changeChoice({ kind: 'existing', record })}
          onCreate={(search) =>
            changeChoice(newRecordChoice(props.pipeline.recordType, search))
          }
        />
      }
    >
      <Match when={existing()}>
        {(record) => (
          <PickedRecord
            recordType={props.pipeline.recordType}
            record={record()}
            disabled={pending()}
            onChange={() => changeChoice(undefined)}
          />
        )}
      </Match>
      <Match when={newCompany()}>
        {(draft) => (
          <NewRecordFields
            name={draft().name}
            namePlaceholder="Company name"
            disabled={pending()}
            onName={(name) => changeChoice({ ...draft(), name })}
            onCancel={() => changeChoice(undefined)}
            cancelLabel="Choose an existing company"
          >
            <GlobeIcon
              aria-hidden="true"
              class="size-4 shrink-0 text-ink-muted"
            />
            <input
              aria-label="Domain"
              placeholder="Domain (optional), like acme.com"
              autocomplete="off"
              spellcheck={false}
              data-1p-ignore
              class="ph-no-capture w-full min-w-0 bg-transparent text-ink outline-none placeholder:text-ink-placeholder"
              value={draft().domain}
              disabled={pending()}
              onInput={(event) =>
                changeChoice({
                  ...draft(),
                  domain: event.currentTarget.value,
                })
              }
            />
          </NewRecordFields>
        )}
      </Match>
      <Match when={newContact()}>
        {(draft) => (
          <>
            <NewRecordFields
              name={draft().name}
              namePlaceholder="Contact name"
              disabled={pending()}
              onName={(name) => changeChoice({ ...draft(), name })}
              onCancel={() => changeChoice(undefined)}
              cancelLabel="Choose an existing contact"
            >
              <EnvelopeIcon
                aria-hidden="true"
                class="size-4 shrink-0 text-ink-muted"
              />
              <input
                aria-label="Email"
                placeholder="Email, like jane@example.com"
                type="email"
                autocomplete="off"
                spellcheck={false}
                data-1p-ignore
                class="ph-no-capture w-full min-w-0 bg-transparent text-ink outline-none placeholder:text-ink-placeholder"
                value={draft().email}
                disabled={pending()}
                onInput={(event) =>
                  changeChoice({
                    ...draft(),
                    email: event.currentTarget.value,
                  })
                }
              />
            </NewRecordFields>
            <CompanySelect
              companies={companyOptions()}
              value={companyOptions().find(
                (company) => company.id === draft().companyId
              )}
              onChange={(company) =>
                changeChoice({ ...draft(), companyId: company.id })
              }
              loading={companies.query.isLoading}
              disabled={pending()}
              mount={dialog()}
            />
            <Show when={!draft().companyId && suggestedCompany()} keyed>
              {(suggestion) => (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="max-w-full self-start"
                  tooltip={suggestion.name}
                  disabled={pending()}
                  onClick={() =>
                    changeChoice({ ...draft(), companyId: suggestion.id })
                  }
                >
                  <span class="truncate">
                    Use suggested company: {suggestion.name}
                  </span>
                </Button>
              )}
            </Show>
          </>
        )}
      </Match>
    </Switch>
  );

  const cell = (column: () => DatabaseViewColumn) => (
    <GridCell
      column={column()}
      value={values()[column().id] ?? null}
      emptyLabel="Empty"
      canEdit={!pending()}
      renderTextEditor={props.renderTextEditor}
      renderTextValue={props.renderTextValue}
      renderMentionPicker={props.renderMentionPicker}
      renderMentionValue={props.renderMentionValue}
      popupMount={dialog()}
      onMention={(mention) => write(column().id, mention.id)}
      onWrite={(value) => write(column().id, value)}
      onAddOption={(label, value) => {
        setNewOption(label);
        return write(column().id, value ?? label);
      }}
    />
  );

  return (
    <Dialog
      open
      class="sm:w-140"
      onOpenChange={(open) => !open && close()}
      contentRef={(element) => {
        setDialog(element);
        attachHotkeys(element);
      }}
      onEscapeKeyDown={(event) => {
        // Escape in a field's editor cancels that edit, not the whole form.
        if (
          event.target instanceof HTMLElement &&
          fieldList?.contains(event.target) &&
          event.target.closest('input, textarea, [contenteditable="true"]')
        )
          event.preventDefault();
      }}
    >
      <Panel hideBorder class="bg-transparent rounded-[inherit] *:max-h-[80vh]">
        <Panel.Body>
          <form
            class="h-full min-h-0"
            aria-label={submitLabel}
            onSubmit={(event) => {
              event.preventDefault();
              fireAndForget(submit(), 'crm');
            }}
          >
            <EntityComposer.Root class="gap-0 p-0">
              <EntityComposer.Header class="border-b border-edge-muted/60 px-5 py-3">
                <Dialog.Title class="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold">
                  {submitLabel}
                  <span class="flex min-w-0 items-center gap-1 rounded-md bg-hover px-1.5 py-0.5 text-xs font-medium text-ink-muted">
                    <TableIcon class="size-3.5 shrink-0" />
                    <span class="truncate">{props.pipeline.name}</span>
                  </span>
                </Dialog.Title>
                <Dialog.CloseButton
                  tabIndex={-1}
                  aria-label="Close"
                  class={buttonClasses({ size: 'icon-md' })}
                  disabled={pending()}
                >
                  <XIcon class="size-4 shrink-0 touch:size-6" />
                </Dialog.CloseButton>
              </EntityComposer.Header>
              <EntityComposer.Main class="gap-5 overflow-y-auto px-5 py-5">
                <StackedField column={title()}>
                  <div
                    class={`${FIELD_BOX} flex min-h-9 flex-col justify-center gap-2 px-2.5 py-1.5 [&_input]:text-[13px] [&_input]:font-normal [&_svg]:size-4 [&>label]:border-t [&>label]:border-edge-muted/60 [&>label]:pt-2`}
                  >
                    {recordPicker()}
                  </div>
                </StackedField>
                <div ref={fieldList} class="flex flex-col gap-5">
                  <Key each={fields()} by="id">
                    {(column) => (
                      <StackedField
                        column={column()}
                        required={required().some(
                          (field) => field.id === column().id
                        )}
                      >
                        <div class={FIELD_BOX}>{cell(column)}</div>
                      </StackedField>
                    )}
                  </Key>
                </div>
                <Show
                  when={props.requirementsLoading || props.requirementsError}
                >
                  <p role="status" class="text-sm text-ink-muted">
                    {props.requirementsError
                      ? 'Could not load stage requirements. Reopen this form to retry.'
                      : 'Loading stage requirements…'}
                  </p>
                </Show>
                <Show when={error()}>
                  {(message) => (
                    <p role="alert" class="text-sm text-failure">
                      {message()}
                    </p>
                  )}
                </Show>
              </EntityComposer.Main>
              <EntityComposer.Footer class="items-center justify-end border-t border-edge-muted/60 px-5 py-3">
                <Button
                  variant="secondary"
                  class="gap-3 not-touch:h-[33.75px] not-touch:px-[15px]"
                  disabled={pending()}
                  onClick={close}
                >
                  Cancel
                  <Hotkey shortcut="escape" theme="subtle" />
                </Button>
                <EntityComposer.Submit
                  type="submit"
                  hasContent={!!choice()}
                  disabled={
                    !choice() ||
                    pending() ||
                    props.requirementsLoading ||
                    props.requirementsError
                  }
                >
                  {pending() ? 'Adding…' : submitLabel}
                </EntityComposer.Submit>
              </EntityComposer.Footer>
            </EntityComposer.Root>
          </form>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}

const FIELD_BOX =
  'rounded-lg border border-edge-frame bg-control transition-[border-color,box-shadow] duration-120 focus-within:border-ink/40 focus-within:ring-2 focus-within:ring-ink/10 motion-reduce:transition-none [&_[data-cell-display]]:hover:bg-transparent [&_[data-cell-display]]:focus-visible:ring-0 [&_[data-cell-text-editor]]:border-0 [&_[data-cell-text-editor]]:bg-transparent [&_[data-cell-text-editor]]:ring-0';

/** A field with its label stacked above the input. */
function StackedField(props: {
  column: DatabaseViewColumn | undefined;
  required?: boolean;
  children: JSX.Element;
}) {
  return (
    <div class="flex min-w-0 flex-col gap-1.5">
      <Show when={props.column}>
        {(column) => (
          <div class="flex min-w-0 items-center gap-1.5 text-xs font-medium text-ink-muted">
            <PropertyIcon
              type={column().dataType}
              relation={!!column().relation}
              entityType={column().specificEntityType}
            />
            <span class="truncate">{column().name}</span>
            <Show when={props.required}>
              <span class="text-accent">Required</span>
            </Show>
          </div>
        )}
      </Show>
      {props.children}
    </div>
  );
}

function PickedRecord(props: {
  recordType: Pipeline['recordType'];
  record: RecordOption;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <div class="flex min-w-0 items-center gap-2">
      <span class="min-w-0 truncate text-[13px] font-medium">
        {props.record.name}
      </span>
      <Show when={recordDetail(props.record)}>
        {(detail) => (
          <span class="min-w-0 shrink-[2] truncate text-xs text-ink-extra-muted">
            {detail()}
          </span>
        )}
      </Show>
      <Button
        variant="ghost"
        size="xs"
        class="ml-auto shrink-0"
        disabled={props.disabled}
        onClick={props.onChange}
      >
        Change {props.recordType}
      </Button>
    </div>
  );
}

/** A record being added with the row: its name as the title, then its identifying field. */
function NewRecordFields(props: {
  name: string;
  namePlaceholder: string;
  disabled: boolean;
  cancelLabel: string;
  onName: (name: string) => void;
  onCancel: () => void;
  children: JSX.Element;
}) {
  return (
    <>
      <div class="flex min-w-0 items-center gap-2">
        <input
          ref={(element) => queueMicrotask(() => element.focus())}
          aria-label={props.namePlaceholder}
          placeholder={props.namePlaceholder}
          autocomplete="off"
          data-1p-ignore
          class="ph-no-capture w-full min-w-0 bg-transparent text-xl/7 font-medium outline-none placeholder:text-ink-placeholder"
          value={props.name}
          disabled={props.disabled}
          onInput={(event) => props.onName(event.currentTarget.value)}
        />
        <Button
          variant="ghost"
          size="xs"
          class="shrink-0"
          disabled={props.disabled}
          onClick={props.onCancel}
        >
          {props.cancelLabel}
        </Button>
      </div>
      <label class="flex min-w-0 items-center gap-2 text-sm">
        {props.children}
      </label>
    </>
  );
}
