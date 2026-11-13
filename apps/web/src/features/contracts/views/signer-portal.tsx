import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import MacroLogo from '@icon/macro-logo.svg';
import NextIcon from '@icon/system/regular/arrow-down.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import { Key } from '@solid-primitives/keyed';
import { Button, confirmDialog, Dialog, Dropdown, Tabs } from '@ui';
import { createSignal, For, Match, onMount, Show, Switch } from 'solid-js';
import { AdoptSignature } from '../components/adopt-signature';
import { formatDayWithYear } from '../components/format';
import { PdfPage } from '../components/pdf-page';
import { FilledField, SigningField } from '../components/signing-field';
import { recipientTone } from '../components/tone';
import { useSigningContext } from '../context/contracts-context';
import { isMark } from '../core/fields';
import {
  findRecipient,
  type Packet,
  type PacketField,
  type Recipient,
} from '../core/packet';
import { createPacketPdfs } from '../primitives/packet-pdfs';
import { createSigningProgress } from '../primitives/signing-session';

type Outcome = { t: 'signed'; completed: boolean } | { t: 'declined' };

function Notice(props: { title: string; body: string }) {
  return (
    <main class="flex min-h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <MacroLogo class="size-8 text-ink" />
      <h1 class="text-lg font-semibold tracking-tight">{props.title}</h1>
      <p class="max-w-md text-sm text-ink-muted">{props.body}</p>
    </main>
  );
}

function SigningDesk(props: {
  packet: Packet;
  recipient: Recipient;
  onOutcome: (outcome: Outcome) => void;
}) {
  const signing = useSigningContext();
  const progress = createSigningProgress(
    () => props.packet,
    () => props.recipient
  );
  const pdfs = createPacketPdfs(signing.openDocument, () =>
    props.packet.documents.map((document) => document.id)
  );
  const [documentId, setDocumentId] = createSignal(
    props.packet.documents[0]?.id ?? ''
  );
  const [adopting, setAdopting] = createSignal(false);
  const [finishing, setFinishing] = createSignal(false);
  let scroller!: HTMLDivElement;

  onMount(() =>
    fireAndForget(signing.recordView(navigator.userAgent), 'contracts.view')
  );

  const pdf = () => pdfs.pdf(documentId());
  const pages = () =>
    Array.from({ length: pdf()?.pageCount ?? 0 }, (_, index) => index);
  const tone = () => recipientTone(props.packet, props.recipient.id);
  const remainingIn = (id: string) =>
    progress.remaining().filter((field) => field.documentId === id).length;
  const fieldsOn = (page: number) =>
    props.packet.fields.filter(
      (field) => field.documentId === documentId() && field.page === page
    );
  const markFor = (field: PacketField) =>
    field.kind === 'signature'
      ? progress.adoption()?.signature
      : progress.adoption()?.initials;

  /** Bring the next required field into view, switching documents if needed. */
  function goToNext() {
    const next = progress.next();
    if (!next) return;
    setDocumentId(next.documentId);
    requestAnimationFrame(() => {
      scroller
        .querySelector(`[data-field-id="${next.id}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  /**
   * Signing covers every document in the packet, so all of them must have
   * opened for the signer before they can finish.
   */
  const canFinish = () => progress.canFinish() && pdfs.allOpen();

  async function finish() {
    const input = progress.input();
    if (!input || !canFinish()) return;

    setFinishing(true);
    // Consent is recorded first; without it nothing is signed.
    const result = await signing
      .acceptDisclosure()
      .andThen(() => signing.sign(input));
    setFinishing(false);
    if (result.isErr()) {
      toast.failure(t('contracts.signFailed'));
      return;
    }
    props.onOutcome({ t: 'signed', completed: !!result.value.completedAt });
  }

  async function decline() {
    const confirmed = await confirmDialog({
      title: t('contracts.declineTitle'),
      body: t('contracts.declineBody', { sender: props.packet.owner.name }),
      confirmLabel: t('contracts.declineToSign'),
      tone: 'danger',
    });
    if (!confirmed) return;

    const result = await signing.decline('');
    if (result.isErr()) {
      toast.failure(t('contracts.signFailed'));
      return;
    }
    props.onOutcome({ t: 'declined' });
  }

  return (
    <div class="@container/signing flex h-full min-h-0 flex-col bg-page text-ink">
      <header class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-edge-muted bg-panel px-4 py-2 @min-[640px]/signing:px-5">
        <MacroLogo class="size-6 shrink-0" />
        <div class="flex min-w-48 flex-1 flex-col leading-tight">
          <h1 class="truncate text-[0.9375rem] font-semibold tracking-tight">
            {props.packet.title}
          </h1>
          <span class="truncate text-xs text-ink-muted">
            {t('contracts.sentYou', {
              sender: props.packet.owner.name,
              count: props.packet.documents.length,
            })}
          </span>
        </div>
        <div class="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            class="flex h-1.5 w-28 overflow-hidden rounded-full bg-ink/10"
          >
            <span
              class="rounded-full bg-ink"
              style={{
                width: `${(progress.doneCount() / Math.max(progress.totalCount(), 1)) * 100}%`,
              }}
            />
          </span>
          <span class="text-sm whitespace-nowrap text-ink-muted">
            {t('contracts.fieldsDone', {
              done: progress.doneCount(),
              count: progress.totalCount(),
            })}
          </span>
        </div>
        <Dropdown placement="bottom-end">
          <Dropdown.Trigger as={Button} variant="secondary" size="md">
            {t('contracts.otherActions')}
            <CaretDownIcon class="size-3" />
          </Dropdown.Trigger>
          <Dropdown.Content class="max-w-72 min-w-48">
            <Dropdown.Group>
              <Dropdown.Item
                closeOnSelect
                onSelect={() => fireAndForget(decline(), 'contracts.decline')}
              >
                <span class="text-failure-ink">
                  {t('contracts.declineToSign')}
                </span>
              </Dropdown.Item>
            </Dropdown.Group>
          </Dropdown.Content>
        </Dropdown>
        <Button
          variant="primary"
          size="md"
          disabled={!canFinish()}
          loading={finishing()}
          onClick={() => fireAndForget(finish(), 'contracts.finish')}
        >
          {t('contracts.finish')}
        </Button>
      </header>

      <div class="flex min-h-0 flex-1">
        <nav
          aria-label={t('contracts.documentsInPacket')}
          class="hidden w-64 shrink-0 flex-col gap-1 overflow-auto py-5 pr-3 pl-4 @min-[860px]/signing:flex"
        >
          <span class="px-2 pb-2 text-xs font-medium text-ink-muted">
            {t('contracts.documents')}
          </span>
          <For each={props.packet.documents}>
            {(document, index) => (
              <button
                type="button"
                aria-current={documentId() === document.id ? 'page' : undefined}
                class="flex min-h-13 items-center gap-2.5 rounded-xl px-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-edge-focus"
                classList={{
                  'bg-panel shadow-[0_0_0_1px_var(--color-edge-muted)]':
                    documentId() === document.id,
                }}
                onClick={() => setDocumentId(document.id)}
              >
                <span
                  class="flex size-5 shrink-0 items-center justify-center rounded-full text-xxs font-semibold"
                  classList={{
                    'bg-ink text-page': remainingIn(document.id) === 0,
                    'border-2 border-ink-extra-muted text-ink-muted':
                      remainingIn(document.id) > 0,
                  }}
                >
                  <Show
                    when={remainingIn(document.id) === 0}
                    fallback={index() + 1}
                  >
                    <CheckIcon class="size-3" />
                  </Show>
                </span>
                <span class="flex min-w-0 flex-col leading-tight">
                  <span class="truncate text-sm font-medium">
                    {document.name}
                  </span>
                  <span class="truncate text-xs text-ink-muted">
                    {remainingIn(document.id) === 0
                      ? t('contracts.documentDone', {
                          count: document.pageCount,
                        })
                      : t('contracts.documentFieldsLeft', {
                          pages: document.pageCount,
                          count: remainingIn(document.id),
                        })}
                  </span>
                </span>
              </button>
            )}
          </For>
          <div class="min-h-4 flex-1" />
          <p class="px-2 text-xs text-ink-muted">
            {props.packet.expiresAt
              ? t('contracts.noAccountNeededExpires', {
                  email: props.recipient.email,
                  date: formatDayWithYear(props.packet.expiresAt),
                })
              : t('contracts.noAccountNeeded', {
                  email: props.recipient.email,
                })}
          </p>
        </nav>

        <main
          ref={scroller}
          class="flex min-w-0 flex-1 flex-col items-center gap-3.5 overflow-auto px-3 pt-4 pb-7 @min-[640px]/signing:px-4"
        >
          <Show when={props.packet.documents.length > 1}>
            <div class="w-full max-w-170 @min-[860px]/signing:hidden">
              <Tabs
                aria-label={t('contracts.documentsInPacket')}
                variant="pills"
                wrap
                options={props.packet.documents.map((document) => ({
                  value: document.id,
                  label: document.name,
                }))}
                value={documentId()}
                onChange={setDocumentId}
              />
            </div>
          </Show>

          <div class="flex w-full max-w-170 items-center gap-2.5">
            <span class="min-w-0 flex-1 truncate text-sm text-ink-muted">
              <Show when={pdf()}>
                {(open) =>
                  t('contracts.pageCount', { count: open().pageCount })
                }
              </Show>
            </span>
            <Show
              when={progress.next()}
              fallback={
                <Show
                  when={pdfs.allOpen()}
                  fallback={
                    <span class="text-sm text-ink-muted">
                      {pdfs.failed().length > 0
                        ? t('contracts.documentsMissing')
                        : t('contracts.documentsOpening')}
                    </span>
                  }
                >
                  <span class="text-sm font-medium text-success-ink">
                    {t('contracts.readyToFinish')}
                  </span>
                </Show>
              }
            >
              <Button variant="accent" size="md" onClick={goToNext}>
                {t('contracts.nextField')}
                <NextIcon class="size-3.5" />
              </Button>
            </Show>
          </div>

          <Switch>
            <Match when={pdf()}>
              {(open) => (
                <For each={pages()}>
                  {(page) => (
                    <PdfPage
                      pdf={open()}
                      page={page}
                      class="max-w-170 shrink-0 rounded-xl border border-edge-muted"
                      label={t('contracts.pageLabel', {
                        page: page + 1,
                        total: open().pageCount,
                      })}
                    >
                      {/* Keyed on the field's id: a field being typed in keeps
                          its focus when the packet is stored again. */}
                      <Key each={fieldsOn(page)} by="id">
                        {(field) => (
                          <Show
                            when={field().recipientId === props.recipient.id}
                            fallback={
                              <Show
                                when={findRecipient(
                                  props.packet,
                                  field().recipientId
                                )}
                              >
                                {(other) => (
                                  <FilledField
                                    field={field()}
                                    recipient={other()}
                                  />
                                )}
                              </Show>
                            }
                          >
                            <SigningField
                              field={field()}
                              recipient={props.recipient}
                              tone={tone()}
                              mark={
                                isMark(field().kind)
                                  ? markFor(field())
                                  : undefined
                              }
                              value={progress.value(field().id)}
                              current={progress.next()?.id === field().id}
                              onSign={() => setAdopting(true)}
                              onValue={(value) =>
                                progress.setValue(field().id, value)
                              }
                            />
                          </Show>
                        )}
                      </Key>
                    </PdfPage>
                  )}
                </For>
              )}
            </Match>
            <Match when={pdfs.failed().includes(documentId())}>
              <div
                role="alert"
                class="flex flex-col items-center gap-3 p-8 text-sm text-ink-muted"
              >
                <p>{t('contracts.documentUnreadable')}</p>
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => pdfs.retry(documentId())}
                >
                  {t('contracts.tryAgain')}
                </Button>
              </div>
            </Match>
            <Match when={true}>
              <p role="status" class="p-8 text-sm text-ink-muted">
                {t('contracts.loadingDocument')}
              </p>
            </Match>
          </Switch>

          <p class="max-w-170 text-center text-xs text-ink-muted">
            {t('contracts.disclosure')}
          </p>
        </main>
      </div>

      <Show when={adopting()}>
        <Dialog
          open
          onOpenChange={(open) => !open && setAdopting(false)}
          position="center"
          class="w-120 max-w-[calc(100vw-2rem)] p-5"
          visibleScrim
        >
          <Dialog.Title class="pb-4 text-lg font-semibold tracking-tight">
            {t('contracts.adoptTitle')}
          </Dialog.Title>
          <AdoptSignature
            name={props.recipient.name}
            onAdopt={(adoption) => {
              progress.adopt(adoption);
              setAdopting(false);
            }}
          />
        </Dialog>
      </Show>
    </div>
  );
}

/**
 * The public signing page. A recipient opens it from their link, with no
 * Macro account, completes their fields, and finishes or declines.
 */
export function SignerPortal() {
  const signing = useSigningContext();
  const [outcome, setOutcome] = createSignal<Outcome>();
  const signed = () => {
    const current = outcome();
    return current?.t === 'signed' ? current : undefined;
  };
  const ready = () => {
    const session = signing.session();
    return session.t === 'ready' ? session : undefined;
  };

  return (
    <Switch>
      <Match when={outcome()?.t === 'declined'}>
        <Notice
          title={t('contracts.declinedTitle')}
          body={t('contracts.declinedBody')}
        />
      </Match>
      <Match when={signed()}>
        {(done) => (
          <Notice
            title={t('contracts.signedTitle')}
            body={
              done().completed
                ? t('contracts.signedBodyCompleted')
                : t('contracts.signedBodyWaiting')
            }
          />
        )}
      </Match>
      <Match when={ready()}>
        {(session) => (
          <SigningDesk
            packet={session().packet}
            recipient={session().recipient}
            onOutcome={setOutcome}
          />
        )}
      </Match>
      <Match when={signing.session().t === 'loading'}>
        <p role="status" class="p-12 text-center text-sm text-ink-muted">
          {t('contracts.loadingDocument')}
        </p>
      </Match>
      <Match when={true}>
        <Notice
          title={t('contracts.linkUnavailableTitle')}
          body={t('contracts.linkUnavailableBody')}
        />
      </Match>
    </Switch>
  );
}
