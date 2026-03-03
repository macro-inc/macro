use crate::domain::{
    assembler::{message_from_row, split_recipients, thread_from_row},
    models::{EmailErr, Message, Thread},
    ports::EmailRepo,
};
use entity_access::domain::models::{
    AccessLevel, EntityAccessReceipt, EntityPermission, ViewAccessLevel,
};
use frecency::domain::ports::FrecencyQueryService;
use uuid::Uuid;

use super::EmailServiceImpl;

impl<T, U> EmailServiceImpl<T, U>
where
    T: EmailRepo,
    U: FrecencyQueryService,
    anyhow::Error: From<T::Err>,
{
    #[tracing::instrument(err, skip(self, receipt))]
    pub(crate) async fn get_thread_with_messages_impl(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        offset: i64,
        limit: i64,
    ) -> Result<Option<Thread>, EmailErr> {
        let thread_id = Uuid::parse_str(&receipt.entity().entity_id)
            .map_err(|e| EmailErr::RepoErr(anyhow::anyhow!("invalid thread id: {}", e)))?;

        let thread_row = self
            .email_repo
            .thread_by_id(thread_id)
            .await
            .map_err(anyhow::Error::from)?;

        let Some(thread_row) = thread_row else {
            return Ok(None);
        };

        let message_rows = self
            .email_repo
            .messages_by_thread_id_paginated(thread_id, offset, limit)
            .await
            .map_err(anyhow::Error::from)?;

        if message_rows.is_empty() {
            return Ok(Some(thread_from_row(thread_row, vec![])));
        }

        let message_ids: Vec<Uuid> = message_rows.iter().map(|m| m.db_id).collect();
        let message_ids_with_attachments: Vec<Uuid> = message_rows
            .iter()
            .filter(|m| m.has_attachments)
            .map(|m| m.db_id)
            .collect();
        let draft_message_ids: Vec<Uuid> = message_rows
            .iter()
            .filter(|m| m.provider_id.is_none())
            .map(|m| m.db_id)
            .collect();

        let (
            senders_result,
            recipients_result,
            scheduled_result,
            labels_result,
            attachments_result,
            draft_attachments_result,
            forwarded_attachments_result,
        ) = tokio::try_join!(
            async {
                self.email_repo
                    .senders_by_message_ids(&message_ids)
                    .await
                    .map_err(anyhow::Error::from)
            },
            async {
                self.email_repo
                    .recipients_by_message_ids(&message_ids)
                    .await
                    .map_err(anyhow::Error::from)
            },
            async {
                self.email_repo
                    .scheduled_send_times_by_message_ids(&message_ids)
                    .await
                    .map_err(anyhow::Error::from)
            },
            async {
                self.email_repo
                    .labels_by_message_ids(&message_ids)
                    .await
                    .map_err(anyhow::Error::from)
            },
            async {
                self.email_repo
                    .attachments_by_message_ids(&message_ids_with_attachments)
                    .await
                    .map_err(anyhow::Error::from)
            },
            async {
                self.email_repo
                    .draft_attachments_by_message_ids(&draft_message_ids)
                    .await
                    .map_err(anyhow::Error::from)
            },
            async {
                self.email_repo
                    .forwarded_attachments_by_message_ids(&draft_message_ids)
                    .await
                    .map_err(anyhow::Error::from)
            },
        )?;

        let mut senders = senders_result;
        let mut recipients = recipients_result;
        let mut scheduled = scheduled_result;
        let mut labels = labels_result;
        let mut attachments = attachments_result;
        let mut draft_attachments = draft_attachments_result;
        let mut forwarded_attachments = forwarded_attachments_result;

        let is_owner = matches!(
            receipt.entity_permission(),
            EntityPermission::AccessLevel {
                access_level: AccessLevel::Owner
            }
        );

        let messages: Vec<Message> = message_rows
            .into_iter()
            // don't include drafts for non-owners
            .filter(|row| is_owner || !row.is_draft)
            .map(|row| {
                let sender = senders.remove(&row.db_id);
                let recipient_list = recipients.remove(&row.db_id).unwrap_or_default();
                let scheduled_send_time = scheduled.remove(&row.db_id);
                let message_labels = labels.remove(&row.db_id).unwrap_or_default();
                let message_attachments = attachments.remove(&row.db_id).unwrap_or_default();
                let message_draft_attachments =
                    draft_attachments.remove(&row.db_id).unwrap_or_default();
                let message_forwarded_attachments =
                    forwarded_attachments.remove(&row.db_id).unwrap_or_default();

                let (to, cc, bcc) = split_recipients(recipient_list);

                let body_replyless = email_utils::body_replyless::compute_body_replyless(
                    row.subject.as_deref(),
                    row.body_html_sanitized.as_deref(),
                    row.body_text.as_deref(),
                );

                message_from_row(
                    row,
                    sender,
                    to,
                    cc,
                    bcc,
                    message_labels,
                    message_attachments,
                    message_draft_attachments,
                    message_forwarded_attachments,
                    scheduled_send_time,
                    body_replyless,
                )
            })
            .collect();

        Ok(Some(thread_from_row(thread_row, messages)))
    }
}
