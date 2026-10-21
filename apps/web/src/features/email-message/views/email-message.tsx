import { EmailAttachmentPill } from '@app/features/email-message/components/attachment-pill';
import { CollapsedMessage } from '@app/features/email-message/components/collapsed-message';
import { EmailMessageTopBar } from '@app/features/email-message/components/email-message-top-bar';
import { MessageCard } from '@app/features/email-message/components/message-card';
import type { EmailMessage } from '@app/features/email-message/core/email-message';
import { EmailMessageBody } from '@app/features/email-message/views/email-message-body';
import { ImageGalleryPreview } from '@core/component/ImageGalleryPreview';
import { VideoPreview } from '@core/component/VideoPreview';
import CaretRight from '@icon/system/regular/caret-right.svg';
import { Key } from '@solid-primitives/keyed';
import type { JSX } from 'solid-js';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { CalendarFilePreview } from '../components/calendar-file-preview';
import { CalendarInviteCard } from '../components/calendar-invite-card';
import type { EmailMessageAction } from '../components/message-actions';
import {
  type CalendarInvitation,
  groupCalendarInvitations,
} from '../core/calendar-invitation';
import { type EmailAttachment, isCalendarFile } from '../core/email-message';
import { inlineContentIds, normalizeContentId } from '../core/inline-images';
import type { ReadReceipt } from '../core/read-receipt';

export interface InvitationRenderOptions {
  /** Called before a card action opens something else in the app. */
  onNavigate?: () => void;
  /** The card is shown inside the calendar file it came from. */
  inCalendarFile?: boolean;
}

export interface EmailMessageViewProps {
  message: EmailMessage;
  renderInvitation?: (
    message: EmailMessage,
    invitation: CalendarInvitation,
    options?: InvitationRenderOptions
  ) => JSX.Element;
  renderOperation?: (message: EmailMessage) => JSX.Element;
  renderAvatar?: (message: EmailMessage) => JSX.Element;
  readReceipt?: ReadReceipt;
  viewerEmail?: string;
  isTouch: boolean;
  isPersonal: boolean;
  showFullContent?: boolean;
  isSelected: boolean;
  allowHover: boolean;
  isExpanded: boolean;
  onExpand?: () => void;
  onExpandedChange?: (expanded: boolean) => void;
  onSelect?: () => void;
  onHover?: () => void;
  onUnhover?: () => void;
  onFocus?: (element: HTMLElement) => void;
  onReply?: (action: EmailMessageAction) => void;
  onOpenAttachment?: (attachment: EmailAttachment) => void;
  onDownloadAttachment?: (attachment: EmailAttachment) => void;
  children?: JSX.Element;
}

const DISCLOSURE_SUMMARY =
  'flex min-h-10 list-none items-center gap-1.5 text-sm text-ink-muted [&::-webkit-details-marker]:hidden';
const DISCLOSURE_CARET =
  'size-3.5 shrink-0 text-ink-subtle transition-transform group-open:rotate-90 motion-reduce:transition-none';

export function EmailMessageView(props: EmailMessageViewProps) {
  const [expandedHeader, setExpandedHeader] = createSignal(false);
  const isBodyExpanded = () => props.isExpanded;
  const invitationGroups = createMemo(() =>
    groupCalendarInvitations(props.message.calendar_invitations ?? [])
  );
  // A calendar file whose event the message already shows opens as that
  // event; any other file, and a cloud reference with no bytes to download,
  // goes to the host.
  const [calendarFile, setCalendarFile] = createSignal<EmailAttachment>();
  // Closing the dialog returns focus to the chip that opened it.
  let calendarFileChip: HTMLElement | undefined;
  const openAttachment = (attachment: EmailAttachment, chip: HTMLElement) => {
    if (
      invitationGroups().length > 0 &&
      !attachment.reference_url &&
      isCalendarFile(attachment.filename, attachment.mime_type)
    ) {
      calendarFileChip = chip;
      setCalendarFile(attachment);
      return;
    }
    props.onOpenAttachment?.(attachment);
  };
  // A card action that opens the calendar closes the dialog first, so it
  // neither covers the destination nor pulls focus back to the email.
  const closeForNavigation = () => {
    calendarFileChip = undefined;
    setCalendarFile(undefined);
  };
  const renderInvitation = (
    invitation: CalendarInvitation,
    options?: InvitationRenderOptions
  ) =>
    props.renderInvitation ? (
      props.renderInvitation(props.message, invitation, options)
    ) : (
      <CalendarInviteCard
        invitation={invitation}
        inCalendarFile={options?.inCalendarFile}
      />
    );
  const body = () => (
    <div class="ph-no-capture text-base text-ink pr-4 mobile:pr-0">
      <EmailMessageBody
        message={props.message}
        isPersonal={props.isPersonal}
        isBodyExpanded={isBodyExpanded}
        setExpandedMessageBody={() => props.onExpandedChange?.(true)}
        setFocusedMessageId={() => props.onSelect?.()}
        showFullContent={props.showFullContent}
        isFocused={props.isSelected}
      />
    </div>
  );

  // Hide attachments that are referenced in inline images
  const shownInline = createMemo(() =>
    inlineContentIds(props.message.body_html_sanitized ?? '')
  );

  const visibleAttachments = createMemo(() => {
    return props.message.attachments.filter((a) => {
      if (!a.db_id) return false;
      const contentId = a.content_id?.toString();
      if (!contentId) return true;
      return !shownInline().has(normalizeContentId(contentId));
    });
  });

  const imageAttachmentsWithSfs = createMemo(() => {
    return visibleAttachments().filter(
      (a) => a.mime_type?.startsWith('image/') && a.sfs_id
    );
  });

  const videoAttachmentsWithSfs = createMemo(() => {
    return visibleAttachments().filter(
      (a) => a.mime_type?.startsWith('video/') && a.sfs_id
    );
  });

  const otherAttachments = createMemo(() => {
    return visibleAttachments().filter(
      (a) =>
        !a.sfs_id ||
        (!a.mime_type?.startsWith('image/') &&
          !a.mime_type?.startsWith('video/'))
    );
  });

  return (
    <MessageCard
      messageId={props.message.db_id}
      isSelected={props.isSelected}
      allowHover={props.allowHover}
      isTouch={props.isTouch}
      onActivate={isBodyExpanded() ? undefined : props.onExpand}
      onSelect={props.onSelect}
      onHover={props.onHover}
      onUnhover={props.onUnhover}
      onFocus={props.onFocus}
    >
      <Show
        when={isBodyExpanded()}
        fallback={
          <CollapsedMessage
            message={props.message}
            currentUserEmail={props.viewerEmail}
            avatar={props.renderAvatar?.(props.message)}
          />
        }
      >
        <div class="flex flex-col min-w-0 gap-2 overflow-hidden">
          <EmailMessageTopBar
            message={props.message}
            focused={props.isSelected}
            setExpandedBodyId={(_id, expanded) =>
              props.onExpandedChange?.(expanded)
            }
            isBodyExpanded={isBodyExpanded}
            expandedHeader={expandedHeader}
            setExpandedHeader={setExpandedHeader}
            setFocusedMessageId={() => props.onSelect?.()}
            onReply={props.onReply}
            isTouch={props.isTouch}
            viewerEmail={props.viewerEmail}
            readReceipt={props.readReceipt}
            hiddenActions={
              props.onReply ? undefined : ['reply', 'reply-all', 'forward']
            }
            avatar={
              <div class="shrink-0 flex justify-center items-center size-6">
                {props.renderAvatar?.(props.message)}
              </div>
            }
          />
          {props.renderOperation?.(props.message)}
          {/* Keyed by component so thread refreshes keep each card's state. */}
          <Key each={invitationGroups()} by={(group) => group.primary.id}>
            {(group) => {
              const primary = renderInvitation(group().primary);
              return (
                <div>
                  {primary}
                  <Show when={group().related.length > 0}>
                    <details class="group border-t border-edge-muted">
                      <summary class={DISCLOSURE_SUMMARY}>
                        <CaretRight class={DISCLOSURE_CARET} />
                        View {group().related.length} related{' '}
                        {group().related.length === 1
                          ? 'occurrence'
                          : 'occurrences'}
                      </summary>
                      <Key each={group().related} by={(invite) => invite.id}>
                        {(invite) => renderInvitation(invite())}
                      </Key>
                    </details>
                  </Show>
                </div>
              );
            }}
          </Key>
          <Show when={invitationGroups().length > 0} fallback={body()}>
            {/* The card replaces the body; the original stays one click away. */}
            <details class="group mb-3 border-t border-edge-muted">
              <summary class={DISCLOSURE_SUMMARY}>
                <CaretRight class={DISCLOSURE_CARET} />
                View original email
              </summary>
              {body()}
            </details>
          </Show>
          {/* Image attachments */}
          <Show when={imageAttachmentsWithSfs().length > 0}>
            <div class="flex flex-wrap gap-2 mt-2">
              <ImageGalleryPreview
                images={imageAttachmentsWithSfs().map((a) => ({
                  id: a.sfs_id!,
                }))}
                variant="small"
                attachmentIds={imageAttachmentsWithSfs().map((a) => a.db_id!)}
              />
            </div>
          </Show>

          {/* Video attachments */}
          <Show when={videoAttachmentsWithSfs().length > 0}>
            <For each={videoAttachmentsWithSfs()}>
              {(attachment) => (
                <VideoPreview id={attachment.sfs_id!} variant="dynamic" />
              )}
            </For>
          </Show>

          {/* Other attachments (non-media or without sfs_id) */}
          <Show when={otherAttachments().length > 0}>
            <div class="flex flex-row overflow-x-scroll mt-2 gap-2">
              {/* Keyed so a thread refresh keeps each chip, and with it the
                  calendar file dialog's focus target. */}
              <Key
                each={otherAttachments()}
                by={(attachment) => attachment.db_id}
              >
                {(attachment) => (
                  <EmailAttachmentPill
                    attachment={{
                      fileName: attachment().filename ?? '',
                      mimeType: attachment().mime_type ?? undefined,
                    }}
                    onClick={
                      props.onOpenAttachment
                        ? (chip) => openAttachment(attachment(), chip)
                        : undefined
                    }
                  />
                )}
              </Key>
            </div>
          </Show>

          {/* Draft attachments */}
          <Show
            when={
              props.message.attachments_draft.length > 0 ||
              props.message.attachments_forwarded.length > 0
            }
          >
            <div class="flex flex-row overflow-x-scroll mt-2 gap-2">
              <For each={props.message.attachments_draft}>
                {(attachment) => (
                  <EmailAttachmentPill
                    attachment={{
                      fileName: attachment.file_name,
                      mimeType: attachment.content_type,
                    }}
                  />
                )}
              </For>
              <For each={props.message.attachments_forwarded}>
                {(attachment) => (
                  <EmailAttachmentPill
                    attachment={{
                      fileName: attachment.filename ?? '',
                      mimeType: attachment.mime_type ?? undefined,
                    }}
                  />
                )}
              </For>
            </div>
          </Show>
        </div>
        {props.children}
      </Show>
      <Show when={calendarFile()}>
        {(file) => (
          <CalendarFilePreview
            fileName={file().filename ?? ''}
            open
            onClose={() => setCalendarFile(undefined)}
            returnFocus={() => calendarFileChip}
            onDownload={
              props.onDownloadAttachment
                ? () => props.onDownloadAttachment?.(file())
                : undefined
            }
          >
            <Key each={invitationGroups()} by={(group) => group.primary.id}>
              {(group) =>
                renderInvitation(group().primary, {
                  onNavigate: closeForNavigation,
                  inCalendarFile: true,
                })
              }
            </Key>
          </CalendarFilePreview>
        )}
      </Show>
    </MessageCard>
  );
}
