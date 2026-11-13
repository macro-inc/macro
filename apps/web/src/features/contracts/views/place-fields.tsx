import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowRightIcon from '@icon/system/regular/arrow-right.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import DotsSixIcon from '@icon/system/regular/dots-six-vertical.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import WarningIcon from '@icon/system/regular/warning.svg';
import { Button, Dropdown, RadioGroup, Tabs, ToggleSwitch } from '@ui';
import {
  createSignal,
  For,
  type JSX,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { FieldKindIcon, fieldKindLabel } from '../components/field-kind';
import { PacketStatusPill } from '../components/packet-status-pill';
import { PdfPage } from '../components/pdf-page';
import { PlacedField } from '../components/placed-field';
import { recipientTone, toneVars } from '../components/tone';
import { useContractsContext } from '../context/contracts-context';
import {
  blocksSending,
  fieldsFor,
  type PlacementProblem,
} from '../core/fields';
import {
  FIELD_KINDS,
  type FieldBox,
  type FieldKind,
  findRecipient,
  type Packet,
  type PacketField,
  signers,
} from '../core/packet';
import { createPacketPdfs } from '../primitives/packet-pdfs';
import { createPlacement } from '../primitives/placement';

const FIELD_KIND_MIME = 'application/x-macro-contract-field';
/** Where a field lands when its palette button is pressed, not dragged. */
const DEFAULT_DROP = { xPct: 0.5, yPct: 0.4 };

type Gesture = {
  fieldId: string;
  mode: 'move' | 'resize';
  page: HTMLElement;
  startX: number;
  startY: number;
  startBox: FieldBox;
};

/** One sentence describing what is wrong with the placement. */
export function placementProblemText(
  packet: Pick<Packet, 'recipients' | 'documents'>,
  problem: PlacementProblem
): string {
  if (problem.kind === 'no_documents') return t('contracts.problemDocuments');
  if (problem.kind === 'no_signers') return t('contracts.problemSigners');

  const name = findRecipient(packet, problem.recipientId)?.name ?? '';
  const document = packet.documents.find(
    (each) => each.id === problem.documentId
  );
  if (!document) return t('contracts.problemNoSignature', { name });
  return t('contracts.problemNoSignatureIn', { name, document: document.name });
}

function InspectorRow(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex min-h-8 items-center gap-2">
      <span class="w-(--sidepanel-label-width) shrink-0 text-sm text-ink-extra-muted">
        {props.label}
      </span>
      <span class="flex min-w-0 items-center text-sm">{props.children}</span>
    </div>
  );
}

/**
 * Step two of a new packet: put each signer's fields on the document pages.
 * Fields are dragged from the palette or added with a press, then moved,
 * resized, and assigned. Leaving saves the placement to the draft, however
 * the view is left. Mount it keyed on the packet's id: its placement belongs
 * to the packet it was created with.
 */
export function PlaceFields(props: {
  packet: Packet;
  onBack: () => void;
  onReview: () => void;
}) {
  const context = useContractsContext();
  const placement = createPlacement({
    packet: props.packet,
    newId: () => crypto.randomUUID(),
  });
  const pdfs = createPacketPdfs(context.openDocument, () =>
    props.packet.documents.map((document) => document.id)
  );
  const [documentId, setDocumentId] = createSignal(
    props.packet.documents[0]?.id ?? ''
  );
  const [activePage, setActivePage] = createSignal(0);
  const [saving, setSaving] = createSignal(false);
  let gesture: Gesture | undefined;
  let palette!: HTMLDivElement;

  const packetId = props.packet.id;
  const placed = () => JSON.stringify(placement.fields());
  let saved = placed();
  // Leaving by any other way, such as the sidebar, still keeps the work.
  onCleanup(() => {
    if (placed() === saved) return;
    fireAndForget(
      context.saveFields(packetId, placement.snapshot()),
      'contracts.place-fields'
    );
  });

  const pdf = () => pdfs.pdf(documentId());
  const pages = () =>
    Array.from({ length: pdf()?.pageCount ?? 0 }, (_, index) => index);
  const signing = () => signers(props.packet);
  const toneOf = (recipientId: string) =>
    recipientTone(props.packet, recipientId);
  const fieldsOn = (page: number) =>
    placement
      .fields()
      .filter(
        (field) => field.documentId === documentId() && field.page === page
      );

  function chooseDocument(next: string) {
    setDocumentId(next);
    setActivePage(0);
    placement.select(undefined);
  }

  function pointOn(
    page: HTMLElement,
    event: { clientX: number; clientY: number }
  ) {
    const bounds = page.getBoundingClientRect();
    return {
      xPct: (event.clientX - bounds.left) / bounds.width,
      yPct: (event.clientY - bounds.top) / bounds.height,
    };
  }

  function drop(event: DragEvent, page: number) {
    const kind = FIELD_KINDS.find(
      (each) => each === event.dataTransfer?.getData(FIELD_KIND_MIME)
    );
    if (!kind || !(event.currentTarget instanceof HTMLElement)) return;
    event.preventDefault();
    setActivePage(page);
    placement.add(
      kind,
      documentId(),
      page,
      pointOn(event.currentTarget, event)
    );
  }

  function beginGesture(
    event: PointerEvent & { currentTarget: HTMLElement },
    field: PacketField,
    mode: Gesture['mode']
  ) {
    const page = event.currentTarget.closest<HTMLElement>('[data-pdf-page]');
    if (!page) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    placement.select(field.id);
    setActivePage(field.page);
    gesture = {
      fieldId: field.id,
      mode,
      page,
      startX: event.clientX,
      startY: event.clientY,
      startBox: { ...field.box },
    };
  }

  function continueGesture(event: PointerEvent) {
    if (!gesture) return;
    const bounds = gesture.page.getBoundingClientRect();
    const dx = (event.clientX - gesture.startX) / bounds.width;
    const dy = (event.clientY - gesture.startY) / bounds.height;
    const start = gesture.startBox;

    if (gesture.mode === 'move') {
      placement.move(gesture.fieldId, {
        ...start,
        xPct: start.xPct + dx,
        yPct: start.yPct + dy,
      });
      return;
    }
    placement.resize(gesture.fieldId, {
      ...start,
      widthPct: start.widthPct + dx,
      heightPct: start.heightPct + dy,
    });
  }

  function endGesture() {
    gesture = undefined;
  }

  function fieldKey(event: KeyboardEvent, field: PacketField) {
    const direction = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    }[event.key];
    if (direction) {
      event.preventDefault();
      placement.nudge(field.id, direction);
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      removeField(field);
    }
  }

  /**
   * Delete a field and move focus to the field palette, so the keyboard is
   * not left on a control that no longer exists.
   */
  function removeField(field: PacketField) {
    placement.remove(field.id);
    palette.querySelector<HTMLElement>('button')?.focus();
  }

  async function save(): Promise<boolean> {
    setSaving(true);
    const saving = placed();
    const result = await context.saveFields(packetId, placement.snapshot());
    setSaving(false);
    if (result.isErr()) {
      toast.failure(t('contracts.actionFailed'));
      return false;
    }
    saved = saving;
    return true;
  }

  async function back() {
    if (await save()) props.onBack();
  }

  async function review() {
    if (await save()) props.onReview();
  }

  const selected = placement.selected;
  const blocked = () => placement.problems().some(blocksSending);

  return (
    <section
      aria-label={t('contracts.placeFieldsFor', { title: props.packet.title })}
      class="flex h-full min-h-0 flex-col"
      onPointerMove={continueGesture}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
    >
      <header class="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-edge-muted px-3">
        <h2 class="min-w-0 truncate text-sm font-semibold tracking-tight">
          {props.packet.title}
        </h2>
        <span class="text-sm text-ink-extra-muted">
          {t('contracts.stepPlaceFields')}
        </span>
        <PacketStatusPill status="draft" />
        <div class="flex-1" />
        <Button
          variant="ghost"
          size="md"
          disabled={saving()}
          onClick={() => fireAndForget(back(), 'contracts.place-fields')}
        >
          {t('contracts.saveAndClose')}
        </Button>
        <Button
          variant="primary"
          size="md"
          loading={saving()}
          onClick={() => fireAndForget(review(), 'contracts.place-fields')}
        >
          {t('contracts.reviewAndSend')}
          <ArrowRightIcon class="size-3.5" />
        </Button>
      </header>

      <div class="flex min-h-0 flex-1">
        <aside
          aria-label={t('contracts.fields')}
          class="flex w-58 shrink-0 flex-col gap-5 overflow-auto border-r border-edge-muted p-3"
        >
          <RadioGroup
            value={placement.recipientId()}
            onChange={(recipientId) => placement.chooseRecipient(recipientId)}
            class="flex flex-col gap-1"
          >
            <RadioGroup.Label class="px-1 pb-1 text-xs font-medium text-ink-extra-muted">
              {t('contracts.placingFor')}
            </RadioGroup.Label>
            <For each={signing()}>
              {(signer, index) => (
                <RadioGroup.Item
                  value={signer.id}
                  class="flex min-h-11 items-center gap-2.5 rounded-xl px-2.5 data-[checked]:bg-(--tone-bg) data-[checked]:shadow-[inset_0_0_0_1px_var(--tone)]"
                  style={toneVars(toneOf(signer.id))}
                >
                  <RadioGroup.ItemControl />
                  <RadioGroup.ItemLabel class="flex min-h-11 min-w-0 flex-1 items-center gap-2.5">
                    <span class="size-3 shrink-0 rounded-[3px] bg-(--tone)" />
                    <span class="flex min-w-0 flex-col leading-tight">
                      <span class="truncate text-sm font-medium">
                        {signer.name}
                      </span>
                      <span class="truncate text-xs text-ink-extra-muted">
                        {t('contracts.signerFieldSummary', {
                          position: index() + 1,
                          count: placement
                            .fields()
                            .filter((field) => field.recipientId === signer.id)
                            .length,
                        })}
                      </span>
                    </span>
                  </RadioGroup.ItemLabel>
                </RadioGroup.Item>
              )}
            </For>
          </RadioGroup>

          <div
            ref={palette}
            class="flex flex-col gap-1"
            style={toneVars(toneOf(placement.recipientId()))}
          >
            <span class="px-1 pb-1 text-xs font-medium text-ink-extra-muted">
              {t('contracts.dragOntoPage')}
            </span>
            <For each={FIELD_KINDS}>
              {(kind: FieldKind) => (
                <Button
                  variant="secondary"
                  size="lg"
                  fullWidth
                  class="justify-start"
                  draggable
                  onDragStart={(event: DragEvent) => {
                    event.dataTransfer?.setData(FIELD_KIND_MIME, kind);
                  }}
                  onClick={() =>
                    placement.add(
                      kind,
                      documentId(),
                      activePage(),
                      DEFAULT_DROP
                    )
                  }
                >
                  <span class="flex size-5.5 shrink-0 items-center justify-center rounded-md bg-(--tone-bg) text-(--tone-ink)">
                    <FieldKindIcon kind={kind} class="size-3.5" />
                  </span>
                  <span class="flex-1 text-left">{fieldKindLabel(kind)}</span>
                  <DotsSixIcon class="size-3 text-ink-placeholder" />
                </Button>
              )}
            </For>
          </div>
        </aside>

        <div class="flex min-w-0 flex-1 flex-col">
          <div class="flex min-h-12 shrink-0 items-center gap-2 px-4">
            <Tabs
              aria-label={t('contracts.documents')}
              variant="pills"
              options={props.packet.documents.map((document) => ({
                value: document.id,
                label: document.name,
              }))}
              value={documentId()}
              onChange={chooseDocument}
            />
            <div class="flex-1" />
            <Show when={pdf()}>
              {(open) => (
                <span class="text-sm font-medium tabular-nums">
                  {activePage() + 1}{' '}
                  <span class="text-ink-muted">/ {open().pageCount}</span>
                </span>
              )}
            </Show>
          </div>

          <div class="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-auto px-4 pb-6">
            <Switch>
              <Match when={pdf()}>
                {(open) => (
                  <For each={pages()}>
                    {(page) => (
                      <div
                        data-pdf-page
                        class="w-full max-w-170 shrink-0"
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => drop(event, page)}
                        onPointerDown={() => {
                          setActivePage(page);
                          placement.select(undefined);
                        }}
                      >
                        <PdfPage
                          pdf={open()}
                          page={page}
                          class="rounded-xl overflow-visible"
                          label={t('contracts.pageLabel', {
                            page: page + 1,
                            total: open().pageCount,
                          })}
                        >
                          <For each={fieldsOn(page)}>
                            {(field) => (
                              <PlacedField
                                field={field}
                                tone={toneOf(field.recipientId)}
                                recipientName={
                                  findRecipient(props.packet, field.recipientId)
                                    ?.name ?? ''
                                }
                                selected={selected()?.id === field.id}
                                onPointerDown={(event) =>
                                  beginGesture(event, field, 'move')
                                }
                                onResizePointerDown={(event) =>
                                  beginGesture(event, field, 'resize')
                                }
                                onKeyDown={(event) => fieldKey(event, field)}
                                onFocus={() => placement.select(field.id)}
                              >
                                <div
                                  class="menu-surface absolute bottom-[calc(100%+0.5rem)] left-0 z-10 flex h-8 items-center gap-1 rounded-full pr-1 pl-2.5 text-xs font-medium whitespace-nowrap"
                                  onPointerDown={(event) =>
                                    event.stopPropagation()
                                  }
                                >
                                  <span class="size-2 rounded-[2px] bg-(--tone)" />
                                  {
                                    findRecipient(
                                      props.packet,
                                      field.recipientId
                                    )?.name
                                  }
                                  <span class="font-normal text-ink-muted">
                                    {field.required
                                      ? t('contracts.required')
                                      : t('contracts.optional')}
                                  </span>
                                  <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={t('contracts.duplicateField')}
                                    onClick={() =>
                                      placement.duplicate(field.id)
                                    }
                                  >
                                    <CopyIcon class="size-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={t('contracts.deleteField')}
                                    onClick={() => removeField(field)}
                                  >
                                    <TrashIcon class="size-3.5" />
                                  </Button>
                                </div>
                              </PlacedField>
                            )}
                          </For>
                        </PdfPage>
                      </div>
                    )}
                  </For>
                )}
              </Match>
              <Match when={pdfs.failed().includes(documentId())}>
                <p role="alert" class="p-8 text-sm text-ink-muted">
                  {t('contracts.documentUnreadable')}
                </p>
              </Match>
              <Match when={true}>
                <p role="status" class="p-8 text-sm text-ink-muted">
                  {t('contracts.loadingDocument')}
                </p>
              </Match>
            </Switch>
          </div>
        </div>

        <aside
          aria-label={t('contracts.selectedField')}
          class="flex w-64 shrink-0 flex-col gap-5 overflow-auto border-l border-edge-muted p-4"
        >
          <div class="flex flex-col gap-1">
            <h3 class="pb-1 text-xs font-medium text-ink-extra-muted">
              {t('contracts.selectedField')}
            </h3>
            <Show
              when={selected()}
              fallback={
                <p class="text-sm text-ink-extra-muted">
                  {t('contracts.noFieldSelected')}
                </p>
              }
            >
              {(field) => (
                <>
                  <InspectorRow label={t('contracts.fieldType')}>
                    {fieldKindLabel(field().kind)}
                  </InspectorRow>
                  <InspectorRow label={t('contracts.assignedTo')}>
                    <Dropdown>
                      <Dropdown.Trigger
                        as={Button}
                        variant="secondary"
                        size="sm"
                        aria-label={t('contracts.assignedTo')}
                      >
                        <span
                          class="size-2 rounded-[2px] bg-(--tone)"
                          style={toneVars(toneOf(field().recipientId))}
                        />
                        <span class="truncate">
                          {
                            findRecipient(props.packet, field().recipientId)
                              ?.name
                          }
                        </span>
                        <CaretDownIcon class="size-3" />
                      </Dropdown.Trigger>
                      <Dropdown.Content class="max-w-72 min-w-48">
                        <Dropdown.Group>
                          <Dropdown.RadioGroup
                            value={field().recipientId}
                            onChange={(recipientId) =>
                              placement.assign(field().id, recipientId)
                            }
                          >
                            <For each={signing()}>
                              {(signer) => (
                                <Dropdown.RadioItem
                                  value={signer.id}
                                  closeOnSelect
                                >
                                  {signer.name}
                                </Dropdown.RadioItem>
                              )}
                            </For>
                          </Dropdown.RadioGroup>
                        </Dropdown.Group>
                      </Dropdown.Content>
                    </Dropdown>
                  </InspectorRow>
                  <InspectorRow label={t('contracts.required')}>
                    <ToggleSwitch
                      size="sm"
                      checked={field().required}
                      onChange={(required) =>
                        placement.setRequired(field().id, required)
                      }
                      label={
                        <span class="sr-only">{t('contracts.required')}</span>
                      }
                    />
                  </InspectorRow>
                  <InspectorRow label={t('contracts.page')}>
                    {t('contracts.pageOf', {
                      page: field().page + 1,
                      total: pdf()?.pageCount ?? field().page + 1,
                    })}
                  </InspectorRow>
                </>
              )}
            </Show>
          </div>

          <div class="flex flex-col gap-2.5">
            <h3 class="text-xs font-medium text-ink-extra-muted">
              {t('contracts.beforeYouSend')}
            </h3>
            <For each={signing()}>
              {(signer) => (
                <Show
                  when={
                    !placement
                      .problems()
                      .some(
                        (problem) =>
                          problem.kind === 'no_signature_field' &&
                          problem.recipientId === signer.id
                      ) && fieldsFor({ fields: placement.fields() }, signer.id)
                  }
                >
                  <p class="flex gap-2 text-sm text-ink-muted">
                    <CheckIcon class="mt-0.5 size-4 shrink-0 text-success" />
                    {t('contracts.signsEveryDocument', { name: signer.name })}
                  </p>
                </Show>
              )}
            </For>
            <For each={placement.problems()}>
              {(problem) => (
                <p class="flex gap-2 text-sm text-ink-muted">
                  <WarningIcon
                    class="mt-0.5 size-4 shrink-0"
                    classList={{
                      'text-failure': blocksSending(problem),
                      'text-warning': !blocksSending(problem),
                    }}
                  />
                  {placementProblemText(props.packet, problem)}
                </p>
              )}
            </For>
            <Show when={blocked()}>
              <p class="text-xs text-ink-extra-muted">
                {t('contracts.blockedHint')}
              </p>
            </Show>
          </div>
        </aside>
      </div>
    </section>
  );
}
