import { EmailAttachmentPill } from '@app/features/email-message/components/attachment-pill';
import { CollapsedMessage } from '@app/features/email-message/components/collapsed-message';
import { EmailMessageTopBar } from '@app/features/email-message/components/email-message-top-bar';
import { MessageCard } from '@app/features/email-message/components/message-card';
import type { EmailMessage } from '@app/features/email-message/core/email-message';
import { EmailMessageBody } from '@app/features/email-message/views/email-message-body';
import { ImageGalleryPreview } from '@core/component/ImageGalleryPreview';
import { VideoPreview } from '@core/component/VideoPreview';
import type { JSX } from 'solid-js';
import { createMemo, createSignal, For, Show } from 'solid-js';
import type { EmailMessageAction } from '../components/message-actions';
import type { EmailAttachment } from '../core/email-message';
export interface EmailMessageViewProps {
  message: EmailMessage;
  renderAvatar?: (message: EmailMessage) => JSX.Element;
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
  children?: JSX.Element;
}

export function EmailMessageView(props: EmailMessageViewProps) {
  const [expandedHeader, setExpandedHeader] = createSignal(false);
  const isBodyExpanded = createMemo(() => {
    return props.isExpanded;
  });

  // Hide attachments that are referenced in inline images
  const inlineContentIds = createMemo(() => {
    const set = new Set<string>();
    const collectFromHtml = (html: string) => {
      const regex = /src=["']cid:([^"']+)["']/gi;
      let match = regex.exec(html);
      while (match !== null) {
        const raw = match[1];
        const normalized = raw.replace(/[<>]/g, '').trim();
        if (normalized) set.add(normalized);
        match = regex.exec(html);
      }
    };
    collectFromHtml(props.message.body_html_sanitized ?? '');
    return set;
  });

  const visibleAttachments = createMemo(() => {
    return props.message.attachments.filter((a) => {
      if (!a.db_id) return false;
      const contentId = a.content_id?.toString();
      if (!contentId) return true;
      const normalized = contentId.replace(/[<>]/g, '').trim();
      return !inlineContentIds().has(normalized);
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

  const draftAttachments = createMemo(() => {
    return props.message.attachments_draft ?? [];
  });

  const forwardedAttachments = createMemo(() => {
    return props.message.attachments_forwarded ?? [];
  });

  return (
    <MessageCard
      messageId={props.message.db_id}
      isSelected={props.isSelected}
      allowHover={props.allowHover}
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
            hiddenActions={
              props.onReply ? undefined : ['reply', 'reply-all', 'forward']
            }
            avatar={
              <div class="shrink-0 flex justify-center items-center size-6">
                {props.renderAvatar?.(props.message)}
              </div>
            }
          />
          <div class="ph-no-capture text-sm text-ink pr-4">
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
              <For each={otherAttachments()}>
                {(attachment) => (
                  <EmailAttachmentPill
                    attachment={{
                      fileName: attachment.filename ?? '',
                      mimeType: attachment.mime_type ?? undefined,
                    }}
                    onClick={
                      props.onOpenAttachment
                        ? () => props.onOpenAttachment?.(attachment)
                        : undefined
                    }
                  />
                )}
              </For>
            </div>
          </Show>

          {/* Draft attachments */}
          <Show
            when={
              draftAttachments().length > 0 || forwardedAttachments().length > 0
            }
          >
            <div class="flex flex-row overflow-x-scroll mt-2 gap-2">
              <For each={draftAttachments()}>
                {(attachment) => (
                  <EmailAttachmentPill
                    attachment={{
                      fileName: attachment.file_name,
                      mimeType: attachment.content_type,
                    }}
                  />
                )}
              </For>
              <For each={forwardedAttachments()}>
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
    </MessageCard>
  );
}
