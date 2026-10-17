import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import EnvelopeIcon from '@phosphor/envelope.svg';
import GlobeIcon from '@phosphor/globe.svg';
import TableIcon from '@phosphor/table.svg';
import XIcon from '@phosphor/x.svg';
import { Key } from '@solid-primitives/keyed';
import { Button, buttonClasses, Dialog, EntityComposer, Panel } from '@ui';
import {
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
import { RecordField } from '../../database/components/record-panel';
import type {
  DatabaseCellValue,
  DatabaseViewColumn,
} from '../../database/core/database-view';
import { canEditCell, titleColumn } from '../../database/core/table';
import type { RecordCreation } from '../../database/primitives/record-actions';
import { RecordSearch } from '../components/record-search';
import type { Pipeline } from '../core/pipeline';
import {
  contactCompany,
  newRecordChoice,
  type RecordChoice,
  type RecordOption,
  recordChoiceProblem,
} from '../core/pipeline-record';
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
          name: contact.name || contact.email,
          detail: contact.email,
        }))
      : companies.companies().map((entry) => ({
          id: entry.id,
          name: entry.name,
          detail: entry.domains[0]?.domain ?? '',
        }));
  const domainCompanies = () =>
    companies
      .companies()
      .flatMap((entry) =>
        entry.domains.map((domain) => ({ id: entry.id, domain: domain.domain }))
      );
  // One intent per dialog, so submitting again never adds a second row.
  const intentId = `pipeline-record:${createUniqueId()}`;
  const [choice, setChoice] = createSignal<RecordChoice>();
  const [values, setValues] = createSignal(props.initialValues);
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
  const changeChoice = (next: RecordChoice | undefined) => {
    setChoice(next);
    setError(undefined);
  };
  const write = (columnId: string, value: DatabaseCellValue) => {
    setValues((current) => ({ ...current, [columnId]: value }));
    return Promise.resolve(true);
  };

  /** The record's id, creating it first when it is new; a created record stays picked for a retry. */
  async function savedRecordId(current: RecordChoice): Promise<string> {
    if (current.kind === 'existing') return current.record.id;
    if (current.kind === 'new-company') {
      const domain = current.domain.trim().toLowerCase();
      const { id } = await createCompany.mutateAsync({
        name: current.name.trim(),
        domain,
      });
      setChoice({
        kind: 'existing',
        record: { id, name: current.name.trim(), detail: domain },
      });
      return id;
    }
    const email = current.email.trim().toLowerCase();
    const joins = contactCompany(email, domainCompanies());
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
      void submit();
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
    if (pending() || !current || !titleField) return;
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

  return (
    <Dialog
      open
      class="sm:w-160"
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
              void submit();
            }}
          >
            <EntityComposer.Root>
              <EntityComposer.Header class="items-start">
                <Dialog.Title class="sr-only">
                  New {noun} in {props.pipeline.name}
                </Dialog.Title>
                <EntityComposer.Title class="mb-0 min-h-8 min-w-0 flex-1 flex-col items-stretch justify-center gap-3">
                  <Switch
                    fallback={
                      <RecordSearch
                        recordType={props.pipeline.recordType}
                        options={options()}
                        loading={(contacts ?? companies).query.isLoading}
                        mount={dialog()}
                        onPick={(record) =>
                          changeChoice({ kind: 'existing', record })
                        }
                        onCreate={(search) =>
                          changeChoice(
                            newRecordChoice(props.pipeline.recordType, search)
                          )
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
                            placeholder="Domain, like acme.com"
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
                            placeholder="Email, like jane@acme.com"
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
                      )}
                    </Match>
                  </Switch>
                </EntityComposer.Title>
                <Dialog.CloseButton
                  tabIndex={-1}
                  aria-label="Close"
                  class={buttonClasses({ size: 'icon-composer' })}
                  disabled={pending()}
                >
                  <XIcon />
                </Dialog.CloseButton>
              </EntityComposer.Header>
              <EntityComposer.Main class="-mx-2 overflow-y-auto border-t border-edge-muted/60 px-2 pt-3">
                <div ref={fieldList} class="flex flex-col gap-0.5">
                  <Key each={fields()} by="id">
                    {(column) => (
                      <RecordField
                        column={column()}
                        class="grid-cols-[8.5rem_minmax(0,1fr)] pl-2"
                      >
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
                          onMention={(mention) =>
                            write(column().id, mention.id)
                          }
                          onWrite={(value) => write(column().id, value)}
                          onAddOption={(label, value) => {
                            setNewOption(label);
                            return write(column().id, value ?? label);
                          }}
                        />
                      </RecordField>
                    )}
                  </Key>
                </div>
              </EntityComposer.Main>
              <Show when={error()}>
                {(message) => (
                  <p role="alert" class="px-2 text-sm text-failure">
                    {message()}
                  </p>
                )}
              </Show>
              <EntityComposer.Footer class="items-center">
                <span class="flex min-w-0 items-center gap-1.5 px-2 text-xs text-ink-muted">
                  <TableIcon class="size-4 shrink-0" />
                  <span class="truncate">{props.pipeline.name}</span>
                </span>
                <EntityComposer.Submit
                  type="submit"
                  class="ml-auto"
                  hasContent={!!choice()}
                  disabled={!choice() || pending()}
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

function PickedRecord(props: {
  recordType: Pipeline['recordType'];
  record: RecordOption;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <div class="flex min-w-0 items-center gap-2">
      <span class="min-w-0 truncate text-xl/7 font-medium">
        {props.record.name}
      </span>
      <span class="min-w-0 shrink-[2] truncate text-sm text-ink-extra-muted">
        {props.record.detail}
      </span>
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
