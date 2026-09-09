import { RecipientSelector } from '@core/component/RecipientSelector';
import ChevronDown from '@phosphor/caret-down.svg';
import CaretRight from '@phosphor/caret-right.svg';
import { Button, cn } from '@ui';
import type { Accessor } from 'solid-js';
import { Show } from 'solid-js';
import { FromInboxSelector } from '../components/from-inbox-selector';
import { RecipientDropRow } from '../components/recipient-drop-row';
import type { EmailInbox } from '../context/compose-capabilities';
import type { EmailRecipient, RecipientFieldId } from '../core/email-recipient';
import { getRecipientDisplayName } from '../core/email-recipient';
import type { ReplyType } from '../core/reply-type';
import type { EmailFormRecipients } from '../primitives/email-form-state';
import type { createReplyRecipientFields } from '../primitives/reply-recipient-fields';

type ReplyEnvelopeProps = {
  fields: ReturnType<typeof createReplyRecipientFields>;
  values: Accessor<EmailFormRecipients>;
  options: Accessor<EmailRecipient[]>;
  inboxes: Accessor<EmailInbox[]>;
  activeInboxId: Accessor<string | undefined>;
  senderEmail: Accessor<string | undefined>;
  onSenderChange: (id: string) => void;
  subject: Accessor<string>;
  onSubjectChange: (subject: string) => void;
  showSubject: boolean;
  mobile: Accessor<boolean>;
  portalScope: Accessor<'local' | undefined>;
  replyType: Accessor<ReplyType | undefined>;
};

/** Sender, recipients and subject, sharing field behavior across both layouts. */
export function ReplyEnvelope(props: ReplyEnvelopeProps) {
  const {
    showExpandedRecipients,
    setShowExpandedRecipients,
    setToRef,
    ccRef,
    setCcRef,
    bccRef,
    setBccRef,
    showCc,
    setShowCc,
    showBcc,
    setShowBcc,
    recipientDragState,
    handleChipDragStart,
    handleChipDragEnd,
    handleRecipientDrop,
    mobileDrawerCcBccOpen,
    toggleMobileDrawerCcBcc,
  } = props.fields;
  const summary = () => {
    const values = props.values();
    const recipients = [...values.to, ...values.cc, ...values.bcc];
    const first = recipients[0];
    const action =
      props.replyType() === 'forward' ? 'Forwarding' : 'Replying to';
    if (!first) return action;
    const suffix = recipients.length > 1 ? ` + ${recipients.length - 1}` : '';
    return `${action} ${getRecipientDisplayName(first)}${suffix}`;
  };
  const RecipientInput = (field: {
    field: RecipientFieldId;
    mobile?: boolean;
  }) => (
    <RecipientSelector<EmailRecipient['kind']>
      disabled={props.fields.disabled()}
      openOnFocus={false}
      class={
        field.mobile
          ? 'min-w-0 flex-1 bg-transparent rounded-none! [&_input]:ml-0! [&_input]:min-w-0! [&_input]:text-[17px] [&_input]:leading-6 [&_input]:text-ink [&_input]:placeholder:text-ink-placeholder'
          : 'min-w-0 bg-transparent rounded-none! [&_input]:ml-0!'
      }
      inputRef={
        field.field === 'to'
          ? setToRef
          : field.field === 'cc'
            ? setCcRef
            : setBccRef
      }
      options={props.options}
      selfEmail={props.senderEmail()}
      selectedOptions={props.values()[field.field]}
      setSelectedOptions={(values) =>
        props.fields.setRecipients(field.field, values)
      }
      triggerMode="input"
      portalScope={field.mobile ? props.portalScope() : undefined}
      hideBorder
      noPadding
      onChipDragStart={(option, event) =>
        handleChipDragStart(field.field, option, event)
      }
      onChipDragEnd={handleChipDragEnd}
      hideMenuOnEscape
    />
  );
  return (
    <Show
      when={props.mobile()}
      fallback={
        <>
          <div
            class={cn(
              'relative mb-4 min-w-0 text-sm text-ink-muted flex items-center gap-2 wrap',
              !showExpandedRecipients() && 'py-3'
            )}
          >
            <Show
              when={showExpandedRecipients()}
              fallback={
                <div class="flex flex-1 min-w-0">
                  <button
                    type="button"
                    class="flex w-full min-w-0 items-center gap-2 text-sm text-ink-muted"
                    onClick={() => setShowExpandedRecipients(true)}
                  >
                    <span class="block min-w-0 flex-1 truncate text-left">
                      {summary()}
                    </span>
                    <CaretRight class="size-3 shrink-0 text-ink-extra-muted" />
                  </button>
                </div>
              }
            >
              <div class="min-w-0 w-full">
                <div class="flex items-center gap-2 min-w-0 border-b border-edge-muted">
                  <div class="flex items-center gap-2 min-w-0 flex-1 py-3">
                    <div class="w-14 shrink-0 text-sm text-ink-placeholder">
                      From
                    </div>
                    <FromInboxSelector
                      pill
                      class="min-w-0"
                      links={props.inboxes()}
                      activeInboxId={props.activeInboxId()}
                      onSelect={props.onSenderChange}
                      portalScope={props.portalScope()}
                    />
                  </div>
                  <div class="flex items-center ml-auto shrink-0">
                    <Show when={!showCc()}>
                      <Button
                        size="sm"
                        class="rounded-lg"
                        onClick={() => {
                          setShowCc(true);
                          queueMicrotask(() => ccRef()?.focus());
                        }}
                      >
                        Cc
                      </Button>
                    </Show>
                    <Show when={!showBcc()}>
                      <Button
                        size="sm"
                        class="rounded-lg"
                        onClick={() => {
                          setShowBcc(true);
                          queueMicrotask(() => bccRef()?.focus());
                        }}
                      >
                        Bcc
                      </Button>
                    </Show>
                  </div>
                </div>

                <RecipientDropRow
                  field="to"
                  class="w-full gap-2 py-3 border-b border-edge-muted focus-within:border-accent items-center"
                  dragState={recipientDragState}
                  onDrop={handleRecipientDrop}
                >
                  <div class="w-14 shrink-0 text-sm text-ink-placeholder">
                    To
                  </div>
                  <RecipientInput field="to" />
                </RecipientDropRow>
                {/* Expanded CC */}
                <Show when={showCc() || props.values().cc.length > 0}>
                  <RecipientDropRow
                    field="cc"
                    class="w-full gap-2 py-3 border-b border-edge-muted focus-within:border-accent items-center"
                    dragState={recipientDragState}
                    onDrop={handleRecipientDrop}
                  >
                    <div class="w-14 shrink-0 text-sm text-ink-placeholder">
                      Cc
                    </div>
                    <RecipientInput field="cc" />
                  </RecipientDropRow>
                </Show>
                {/* Expanded BCC */}
                <Show when={showBcc() || props.values().bcc.length > 0}>
                  <RecipientDropRow
                    field="bcc"
                    class="w-full gap-2 py-3 border-b border-edge-muted focus-within:border-accent items-center"
                    dragState={recipientDragState}
                    onDrop={handleRecipientDrop}
                  >
                    <div class="w-14 shrink-0 text-sm text-ink-placeholder">
                      Bcc
                    </div>
                    <RecipientInput field="bcc" />
                  </RecipientDropRow>
                </Show>
              </div>
            </Show>
          </div>
          <div
            class={cn(
              'flex-row items-center',
              props.showSubject ? 'flex' : 'hidden'
            )}
          >
            <div class="text-sm min-w-16 pl-4">Subject</div>
            <input
              type="text"
              class="flex-1 text-sm bg-transparent outline-none border-0 px-3 py-1"
              value={props.subject()}
              onInput={(e) => {
                props.onSubjectChange(e.currentTarget.value);
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Escape') return;
                e.preventDefault();
                e.currentTarget.blur();
              }}
              placeholder="Subject"
            />
          </div>
        </>
      }
    >
      <div class="pt-1 relative min-w-0 leading-6 text-ink-muted px-5">
        <RecipientDropRow
          field="to"
          class={cn(
            'w-full gap-2 min-h-16 border-b border-edge-muted/70 focus-within:border-accent',
            'items-center py-2'
          )}
          dragState={recipientDragState}
          onDrop={handleRecipientDrop}
        >
          <div class="shrink-0 text-ink-placeholder">To:</div>
          <RecipientInput field="to" mobile />
          <Button
            variant="ghost"
            size="icon-sm"
            class="shrink-0 rounded-full bg-transparent text-ink-placeholder"
            tooltip={mobileDrawerCcBccOpen() ? 'Hide Cc/Bcc' : 'Show Cc/Bcc'}
            aria-expanded={mobileDrawerCcBccOpen()}
            onClick={toggleMobileDrawerCcBcc}
          >
            <Show
              when={mobileDrawerCcBccOpen()}
              fallback={<CaretRight class="size-4" />}
            >
              <ChevronDown class="size-4" />
            </Show>
          </Button>
        </RecipientDropRow>

        <Show when={showCc() || props.values().cc.length > 0}>
          <RecipientDropRow
            field="cc"
            class={cn(
              'w-full gap-2 min-h-16 border-b border-edge-muted/70 focus-within:border-accent',
              'items-center py-2'
            )}
            dragState={recipientDragState}
            onDrop={handleRecipientDrop}
          >
            <div class="shrink-0 text-ink-placeholder">Cc:</div>
            <RecipientInput field="cc" mobile />
          </RecipientDropRow>
        </Show>

        <Show when={showBcc() || props.values().bcc.length > 0}>
          <RecipientDropRow
            field="bcc"
            class={cn(
              'w-full gap-2 min-h-16 border-b border-edge-muted/70 focus-within:border-accent',
              'items-center py-2'
            )}
            dragState={recipientDragState}
            onDrop={handleRecipientDrop}
          >
            <div class="shrink-0 text-ink-placeholder">Bcc:</div>
            <RecipientInput field="bcc" mobile />
          </RecipientDropRow>
        </Show>

        <div
          class="min-h-14 border-b border-edge-muted/70 flex items-center min-w-0"
          data-corvu-no-drag=""
        >
          <span class="shrink-0 text-ink-placeholder">From:&nbsp;</span>
          <FromInboxSelector
            compact
            class="min-w-0 truncate text-ink-muted"
            links={props.inboxes()}
            activeInboxId={props.activeInboxId()}
            onSelect={props.onSenderChange}
            portalScope={props.portalScope()}
          />
        </div>

        <div class="min-h-14 border-b border-edge-muted/70 flex items-center">
          <input
            type="text"
            class="w-full bg-transparent outline-none border-0 text-[17px] leading-6 text-ink placeholder:text-ink-placeholder"
            value={props.subject()}
            onInput={(e) => {
              props.onSubjectChange(e.currentTarget.value);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              e.preventDefault();
              e.currentTarget.blur();
            }}
            placeholder="Subject:"
          />
        </div>
      </div>
    </Show>
  );
}
