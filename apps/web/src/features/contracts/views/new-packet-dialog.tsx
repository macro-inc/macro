import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import UploadIcon from '@icon/system/regular/upload-simple.svg';
import XIcon from '@icon/system/regular/x.svg';
import {
  ActionDialogShell,
  Button,
  Checkbox,
  Dialog,
  Dropdown,
  Input,
  TextField,
  ToggleSwitch,
} from '@ui';
import { createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { toneVars } from '../components/tone';
import { useContractsContext } from '../context/contracts-context';
import type { Packet, RecipientRole } from '../core/packet';
import {
  createPacketDraft,
  type DraftProblem,
} from '../primitives/packet-draft';

const EXPIRATION_CHOICES = [7, 14, 30, 60, 90];
const REMINDER_CHOICES = [1, 3, 7];
const SIGNER_TONES = ['blue', 'orange', 'violet', 'teal', 'pink'] as const;

function problemText(problem: DraftProblem): string {
  return match(problem)
    .with('title', () => t('contracts.problemTitle'))
    .with('documents', () => t('contracts.problemDocuments'))
    .with('database', () => t('contracts.problemDatabase'))
    .with('recipient_details', () => t('contracts.problemRecipientDetails'))
    .with('signers', () => t('contracts.problemSigners'))
    .exhaustive();
}

function roleLabel(role: RecipientRole): string {
  return role === 'signer'
    ? t('contracts.roleSigner')
    : t('contracts.roleCopy');
}

function Section(props: {
  title: string;
  hint?: string;
  aside?: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <div class="flex flex-col gap-2">
      <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3 class="text-xs font-medium text-ink-muted">
          {props.title}
          <Show when={props.hint}>
            <span class="font-normal text-ink-extra-muted">
              {' '}
              · {props.hint}
            </span>
          </Show>
        </h3>
        {props.aside}
      </div>
      {props.children}
    </div>
  );
}

/**
 * Step one of a new packet: its documents, who signs and in what order, and
 * where it lives. Creating the draft moves on to placing fields.
 */
export function NewPacketDialog(props: {
  /** The database the packet starts in. */
  databaseId: string;
  onClose: () => void;
  onCreated: (packet: Packet) => void;
}) {
  const context = useContractsContext();
  const draft = createPacketDraft({
    databaseId: props.databaseId,
    newId: () => crypto.randomUUID(),
  });
  const [importing, setImporting] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [attempted, setAttempted] = createSignal(false);
  let fileInput!: HTMLInputElement;
  let closed = false;
  onCleanup(() => {
    closed = true;
  });

  async function addFiles(files: FileList | null) {
    if (!files) return;
    setImporting(true);
    for (const file of Array.from(files)) {
      const imported = await context.importDocument(file);
      if (imported.isOk() && closed) {
        // The dialog closed while this file was being stored: nothing will
        // use it, so it is not kept.
        await context.discardDocument(imported.value.id);
        continue;
      }
      if (imported.isOk()) {
        draft.addDocument(imported.value);
        continue;
      }
      toast.failure(
        imported.error.kind === 'not_pdf'
          ? t('contracts.onlyPdfNamed', { name: file.name })
          : t('contracts.documentUnreadableNamed', { name: file.name })
      );
    }
    setImporting(false);
    fileInput.value = '';
  }

  /** A document taken out of the packet is not kept in storage. */
  function removeDocument(documentId: string) {
    draft.removeDocument(documentId);
    fireAndForget(context.discardDocument(documentId), 'contracts.discard');
  }

  /** Closing without creating the packet forgets what was imported for it. */
  function cancel() {
    // The packet is being created from these documents; it keeps them.
    if (creating()) return;
    for (const document of draft.state.documents) {
      fireAndForget(context.discardDocument(document.id), 'contracts.discard');
    }
    props.onClose();
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    setAttempted(true);
    if (draft.problem()) return;

    setCreating(true);
    const result = await context.createDraft(draft.toInput(context.viewer()));
    setCreating(false);
    if (result.isErr()) {
      toast.failure(t('contracts.actionFailed'));
      return;
    }
    props.onCreated(result.value);
  }

  /** Signers take a hue in signing order; copy recipients stay neutral. */
  const toneOf = (recipientId: string) => {
    const signing = draft.state.recipients.filter(
      (recipient) => recipient.role === 'signer'
    );
    const index = signing.findIndex(
      (recipient) => recipient.id === recipientId
    );
    return index === -1 ? 'neutral' : SIGNER_TONES[index % SIGNER_TONES.length];
  };
  const signerCount = () =>
    draft.state.recipients.filter((recipient) => recipient.role === 'signer')
      .length;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && cancel()}
      position="center"
      class="w-200 max-w-[calc(100vw-2rem)]"
      visibleScrim
    >
      <ActionDialogShell>
        <form
          class="flex min-h-0 flex-col"
          onSubmit={(event) =>
            fireAndForget(create(event), 'contracts.create-draft')
          }
        >
          <ActionDialogShell.Body>
            <ActionDialogShell.Header>
              <div class="flex flex-wrap items-center gap-3">
                <ActionDialogShell.Title class="flex-1">
                  {t('contracts.newPacket')}
                </ActionDialogShell.Title>
                <ol class="flex items-center gap-1.5 text-xs font-medium">
                  <li
                    aria-current="step"
                    class="flex h-6 items-center rounded-full bg-ink/10 px-2.5 text-ink"
                  >
                    {t('contracts.stepSetUp')}
                  </li>
                  <li class="flex h-6 items-center px-2.5 text-ink-extra-muted">
                    {t('contracts.stepPlaceFields')}
                  </li>
                  <li class="flex h-6 items-center px-2.5 text-ink-extra-muted">
                    {t('contracts.stepReview')}
                  </li>
                </ol>
              </div>
            </ActionDialogShell.Header>

            <div class="flex flex-col gap-5">
              <TextField value={draft.state.title} onChange={draft.setTitle}>
                <TextField.Label>{t('contracts.packetTitle')}</TextField.Label>
                <TextField.Input
                  placeholder={t('contracts.packetTitlePlaceholder')}
                />
              </TextField>

              <Section
                title={t('contracts.documents')}
                hint={t('contracts.documentsHint')}
                aside={
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={importing()}
                    onClick={() => fileInput.click()}
                  >
                    <UploadIcon class="size-3.5" />
                    {t('contracts.uploadPdf')}
                  </Button>
                }
              >
                <input
                  ref={fileInput}
                  type="file"
                  accept="application/pdf"
                  multiple
                  class="hidden"
                  aria-hidden="true"
                  tabIndex={-1}
                  onChange={(event) =>
                    fireAndForget(
                      addFiles(event.currentTarget.files),
                      'contracts.import-document'
                    )
                  }
                />
                <Show
                  when={draft.state.documents.length > 0}
                  fallback={
                    <p class="rounded-xl border border-dashed border-edge px-4 py-5 text-center text-sm text-ink-extra-muted">
                      {t('contracts.noDocuments')}
                    </p>
                  }
                >
                  <ul class="overflow-hidden rounded-xl border border-edge-muted">
                    <For each={draft.state.documents}>
                      {(document) => (
                        <li class="flex min-h-11 items-center gap-2.5 border-b border-edge-muted/60 pr-2 pl-3 last:border-b-0">
                          <span class="rounded-sm bg-failure-bg px-1 font-mono text-xxs font-medium text-failure-ink">
                            PDF
                          </span>
                          <span class="min-w-0 flex-1 truncate">
                            {document.name}
                          </span>
                          <span class="shrink-0 text-xs text-ink-extra-muted">
                            {t('contracts.pageCount', {
                              count: document.pageCount,
                            })}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('contracts.removeDocument', {
                              name: document.name,
                            })}
                            onClick={() => removeDocument(document.id)}
                          >
                            <XIcon class="size-3.5" />
                          </Button>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </Section>

              <Section
                title={t('contracts.recipients')}
                aside={
                  <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <Checkbox
                      size="sm"
                      checked={draft.state.includeSelf}
                      onChange={draft.setIncludeSelf}
                      class="gap-2 text-sm"
                    >
                      <Checkbox.Control />
                      <Checkbox.Label>
                        {t('contracts.alsoSigner')}
                      </Checkbox.Label>
                    </Checkbox>
                    <ToggleSwitch
                      size="sm"
                      checked={draft.state.signingOrder === 'sequential'}
                      onChange={(ordered) =>
                        draft.setSigningOrder(
                          ordered ? 'sequential' : 'parallel'
                        )
                      }
                      label={
                        <span class="text-sm">
                          {t('contracts.setSigningOrder')}
                        </span>
                      }
                    />
                  </div>
                }
              >
                <ul class="overflow-hidden rounded-xl border border-edge-muted">
                  <For each={draft.state.recipients}>
                    {(recipient, index) => (
                      <li
                        class="flex min-h-12 flex-wrap items-center gap-2 border-b border-edge-muted/60 py-1.5 pr-2 pl-3"
                        style={toneVars(toneOf(recipient.id))}
                      >
                        <span class="flex size-5 shrink-0 items-center justify-center rounded-md bg-ink/5 text-xs font-medium tabular-nums text-ink-muted">
                          {recipient.role === 'signer'
                            ? draft.state.recipients
                                .slice(0, index() + 1)
                                .filter((each) => each.role === 'signer').length
                            : t('contracts.copyAbbreviation')}
                        </span>
                        <span class="size-2.5 shrink-0 rounded-[3px] bg-(--tone)" />
                        <Input
                          size="md"
                          class="min-w-32 flex-1"
                          aria-label={t('contracts.recipientName')}
                          placeholder={t('contracts.recipientName')}
                          value={recipient.name}
                          onInput={(event) =>
                            draft.updateRecipient(recipient.id, {
                              name: event.currentTarget.value,
                            })
                          }
                        />
                        <Input
                          size="md"
                          type="email"
                          class="min-w-40 flex-[1.4]"
                          aria-label={t('contracts.recipientEmail')}
                          placeholder={t('contracts.recipientEmailPlaceholder')}
                          value={recipient.email}
                          onInput={(event) =>
                            draft.updateRecipient(recipient.id, {
                              email: event.currentTarget.value,
                            })
                          }
                        />
                        <Dropdown>
                          <Dropdown.Trigger
                            as={Button}
                            variant="secondary"
                            size="md"
                            aria-label={t('contracts.recipientRole')}
                          >
                            {roleLabel(recipient.role)}
                            <CaretDownIcon class="size-3" />
                          </Dropdown.Trigger>
                          <Dropdown.Content class="min-w-44">
                            <Dropdown.Group>
                              <Dropdown.RadioGroup
                                value={recipient.role}
                                onChange={(role) =>
                                  draft.updateRecipient(recipient.id, {
                                    role: role === 'copy' ? 'copy' : 'signer',
                                  })
                                }
                              >
                                <Dropdown.RadioItem
                                  value="signer"
                                  closeOnSelect
                                >
                                  {t('contracts.roleSigner')}
                                </Dropdown.RadioItem>
                                <Dropdown.RadioItem value="copy" closeOnSelect>
                                  {t('contracts.roleCopy')}
                                </Dropdown.RadioItem>
                              </Dropdown.RadioGroup>
                            </Dropdown.Group>
                          </Dropdown.Content>
                        </Dropdown>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('contracts.removeRecipient')}
                          disabled={draft.state.recipients.length === 1}
                          onClick={() => draft.removeRecipient(recipient.id)}
                        >
                          <XIcon class="size-3.5" />
                        </Button>
                      </li>
                    )}
                  </For>
                  <Show when={draft.state.includeSelf}>
                    <li
                      class="flex min-h-12 items-center gap-2 border-b border-edge-muted/60 pr-2 pl-3"
                      style={toneVars(
                        SIGNER_TONES[signerCount() % SIGNER_TONES.length]
                      )}
                    >
                      <span class="flex size-5 shrink-0 items-center justify-center rounded-md bg-ink/5 text-xs font-medium tabular-nums text-ink-muted">
                        {signerCount() + 1}
                      </span>
                      <span class="size-2.5 shrink-0 rounded-[3px] bg-(--tone)" />
                      <span class="font-medium">{context.viewer().name}</span>
                      <span class="min-w-0 flex-1 truncate text-sm text-ink-extra-muted">
                        {t('contracts.youCountersign')}
                      </span>
                    </li>
                  </Show>
                  <li>
                    <Button
                      variant="ghost"
                      size="lg"
                      fullWidth
                      class="justify-start rounded-none"
                      onClick={() => draft.addRecipient()}
                    >
                      <PlusIcon class="size-3.5" />
                      {t('contracts.addRecipient')}
                    </Button>
                  </li>
                </ul>
                <p class="text-xs text-ink-extra-muted">
                  {draft.state.signingOrder === 'sequential'
                    ? t('contracts.sequentialHint')
                    : t('contracts.parallelHint')}
                </p>
              </Section>

              <div class="grid grid-cols-[repeat(auto-fit,minmax(min(11rem,100%),1fr))] gap-4">
                <Section title={t('contracts.livesIn')}>
                  <Dropdown>
                    <Dropdown.Trigger
                      as={Button}
                      variant="secondary"
                      size="md"
                      class="justify-between"
                    >
                      <span class="truncate">
                        {t('contracts.databaseCount', {
                          count: draft.state.databaseIds.length,
                        })}
                      </span>
                      <CaretDownIcon class="size-3" />
                    </Dropdown.Trigger>
                    <Dropdown.Content class="max-w-80 min-w-56">
                      <Dropdown.Group>
                        <For each={context.databases()}>
                          {(database) => (
                            <Dropdown.CheckboxItem
                              checked={draft.state.databaseIds.includes(
                                database.id
                              )}
                              onChange={() => draft.toggleDatabase(database.id)}
                            >
                              {database.name}
                            </Dropdown.CheckboxItem>
                          )}
                        </For>
                      </Dropdown.Group>
                    </Dropdown.Content>
                  </Dropdown>
                </Section>

                <Section title={t('contracts.expiresAfter')}>
                  <Dropdown>
                    <Dropdown.Trigger
                      as={Button}
                      variant="secondary"
                      size="md"
                      class="justify-between"
                    >
                      {t('contracts.days', {
                        count: draft.state.expirationDays,
                      })}
                      <CaretDownIcon class="size-3" />
                    </Dropdown.Trigger>
                    <Dropdown.Content class="min-w-40">
                      <Dropdown.Group>
                        <Dropdown.RadioGroup
                          value={String(draft.state.expirationDays)}
                          onChange={(value) =>
                            draft.setExpirationDays(Number(value))
                          }
                        >
                          <For each={EXPIRATION_CHOICES}>
                            {(days) => (
                              <Dropdown.RadioItem
                                value={String(days)}
                                closeOnSelect
                              >
                                {t('contracts.days', { count: days })}
                              </Dropdown.RadioItem>
                            )}
                          </For>
                        </Dropdown.RadioGroup>
                      </Dropdown.Group>
                    </Dropdown.Content>
                  </Dropdown>
                </Section>

                <Section title={t('contracts.remindPending')}>
                  <Dropdown>
                    <Dropdown.Trigger
                      as={Button}
                      variant="secondary"
                      size="md"
                      class="justify-between"
                    >
                      {draft.state.reminderDays === null
                        ? t('contracts.remindersOff')
                        : t('contracts.reminderCadence', {
                            count: draft.state.reminderDays,
                          })}
                      <CaretDownIcon class="size-3" />
                    </Dropdown.Trigger>
                    <Dropdown.Content class="min-w-44">
                      <Dropdown.Group>
                        <Dropdown.RadioGroup
                          value={String(draft.state.reminderDays ?? 'off')}
                          onChange={(value) =>
                            draft.setReminderDays(
                              value === 'off' ? null : Number(value)
                            )
                          }
                        >
                          <For each={REMINDER_CHOICES}>
                            {(days) => (
                              <Dropdown.RadioItem
                                value={String(days)}
                                closeOnSelect
                              >
                                {t('contracts.reminderCadence', {
                                  count: days,
                                })}
                              </Dropdown.RadioItem>
                            )}
                          </For>
                          <Dropdown.RadioItem value="off" closeOnSelect>
                            {t('contracts.remindersOff')}
                          </Dropdown.RadioItem>
                        </Dropdown.RadioGroup>
                      </Dropdown.Group>
                    </Dropdown.Content>
                  </Dropdown>
                </Section>

                <TextField
                  value={draft.state.company}
                  onChange={draft.setCompany}
                >
                  <TextField.Label>
                    {t('contracts.columnCompany')}
                  </TextField.Label>
                  <TextField.Input
                    placeholder={t('contracts.companyPlaceholder')}
                  />
                </TextField>
              </div>
            </div>
          </ActionDialogShell.Body>

          <ActionDialogShell.Footer>
            <span
              role={attempted() && draft.problem() ? 'alert' : undefined}
              class="min-w-48 flex-1 text-xs"
              classList={{
                'text-failure-ink': attempted() && !!draft.problem(),
                'text-ink-extra-muted': !(attempted() && draft.problem()),
              }}
            >
              <Show
                when={attempted() ? draft.problem() : undefined}
                fallback={t('contracts.localNotice')}
              >
                {(problem) => problemText(problem())}
              </Show>
            </span>
            <Button variant="ghost" onClick={cancel}>
              {t('contracts.cancel')}
            </Button>
            <Button type="submit" variant="primary" loading={creating()}>
              {t('contracts.placeFields')}
            </Button>
          </ActionDialogShell.Footer>
        </form>
      </ActionDialogShell>
    </Dialog>
  );
}
