use crate::domain::{
    assembler::{message_from_row, split_recipients, thread_from_row},
    models::{
        ContactInfo, EmailErr, Message, MessageLabel, MessageRow, ParsedLabel, ParsedMessage,
        ParsedThread, Thread, ThreadRow,
    },
    ports::{EmailRepo, RecipientsByMessageId},
};
use entity_access::domain::models::{
    AccessLevel, EntityAccessReceipt, EntityPermission, ViewAccessLevel,
};
use frecency::domain::ports::FrecencyQueryService;
use std::collections::HashMap;
use uuid::Uuid;

use super::EmailServiceImpl;

/// The shared ingredients fetched for any thread query: thread row, message rows,
/// senders, recipients, labels, and whether the caller is the owner.
struct ThreadFetchResult {
    thread_row: ThreadRow,
    message_rows: Vec<MessageRow>,
    message_ids: Vec<Uuid>,
    senders: HashMap<Uuid, ContactInfo>,
    recipients: RecipientsByMessageId,
    labels: HashMap<Uuid, Vec<MessageLabel>>,
    is_owner: bool,
}

impl<T, U, E, CS, Eam> EmailServiceImpl<T, U, E, CS, Eam>
where
    T: EmailRepo,
    U: FrecencyQueryService,
    E: crate::domain::ports::EmailMessageEnqueuer,
    CS: crm::domain::service::CrmService,
    anyhow::Error: From<T::Err>,
{
    /// Fetch thread row, paginated messages, and their core sub-resources
    /// (senders, recipients, labels). Returns `None` if the thread doesn't exist.
    async fn fetch_thread_core(
        &self,
        receipt: &EntityAccessReceipt<ViewAccessLevel>,
        offset: i64,
        limit: i64,
    ) -> Result<Option<ThreadFetchResult>, EmailErr> {
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

        let mut message_rows = self
            .email_repo
            .messages_by_thread_id_paginated(thread_id, offset, limit)
            .await
            .map_err(anyhow::Error::from)?;

        let is_owner = matches!(
            receipt.entity_permission(),
            EntityPermission::AccessLevel {
                access_level: AccessLevel::Owner
            }
        );

        let mut message_ids: Vec<Uuid> = message_rows.iter().map(|m| m.db_id).collect();

        if message_ids.is_empty() {
            return Ok(Some(ThreadFetchResult {
                thread_row,
                message_rows: vec![],
                message_ids: vec![],
                senders: HashMap::new(),
                recipients: HashMap::new(),
                labels: HashMap::new(),
                is_owner,
            }));
        }

        // Surface a reply draft the caller moved to another of their inboxes by
        // switching the sender: it lives in a different thread, so pull it in here
        // (matched by the message it replies to) and let the reply reopen with it.
        if let Ok(macro_id) = receipt.get_authenticated_user() {
            let accessible = self
                .email_repo
                .inboxes_for_macro_id(macro_id.clone())
                .await
                .map_err(anyhow::Error::from)?;
            let link_ids: Vec<Uuid> = accessible.iter().map(|l| l.id).collect();
            let moved_drafts = self
                .email_repo
                .cross_inbox_reply_drafts(&message_ids, &link_ids, thread_id)
                .await
                .map_err(anyhow::Error::from)?;
            for draft in moved_drafts {
                message_ids.push(draft.db_id);
                message_rows.push(draft);
            }
        }

        let (senders, recipients, labels) = tokio::try_join!(
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
                    .labels_by_message_ids(&message_ids)
                    .await
                    .map_err(anyhow::Error::from)
            },
        )?;

        Ok(Some(ThreadFetchResult {
            thread_row,
            message_rows,
            message_ids,
            senders,
            recipients,
            labels,
            is_owner,
        }))
    }

    #[tracing::instrument(err, skip(self, receipt))]
    pub(crate) async fn get_thread_with_messages_impl(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        offset: i64,
        limit: i64,
    ) -> Result<Option<Thread>, EmailErr> {
        let Some(ThreadFetchResult {
            thread_row,
            message_rows,
            message_ids,
            mut senders,
            mut recipients,
            mut labels,
            is_owner,
        }) = self.fetch_thread_core(&receipt, offset, limit).await?
        else {
            return Ok(None);
        };

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

        let (mut scheduled, mut attachments, mut draft_attachments, mut forwarded_attachments) = tokio::try_join!(
            async {
                self.email_repo
                    .scheduled_send_times_by_message_ids(&message_ids)
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

        let messages: Vec<Message> = message_rows
            .into_iter()
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

    #[tracing::instrument(err, skip(self, receipt))]
    pub(crate) async fn get_thread_parsed_impl(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        offset: i64,
        limit: i64,
    ) -> Result<Option<ParsedThread>, EmailErr> {
        let Some(ThreadFetchResult {
            thread_row,
            message_rows,
            message_ids: _,
            mut senders,
            mut recipients,
            mut labels,
            is_owner,
        }) = self.fetch_thread_core(&receipt, offset, limit).await?
        else {
            return Ok(None);
        };

        let messages: Vec<ParsedMessage> = message_rows
            .into_iter()
            .filter(|row| is_owner || !row.is_draft)
            .map(|row| {
                let message_id = row.db_id;
                parsed_message_from_row(
                    row,
                    senders.remove(&message_id),
                    recipients.remove(&message_id).unwrap_or_default(),
                    labels.remove(&message_id).unwrap_or_default(),
                )
            })
            .collect();

        // Thread labels are the distinct set across ALL the thread's messages,
        // independent of the fetched message page (unlike per-message labels).
        let labels = self
            .email_repo
            .labels_by_thread_ids(&[thread_row.db_id])
            .await
            .map_err(anyhow::Error::from)?
            .into_iter()
            .map(|l| ParsedLabel {
                id: Some(l.id),
                link_id: l.link_id,
                provider_id: l.provider_label_id,
                name: l.name,
                created_at: l.created_at,
                message_list_visibility: Some(l.message_list_visibility),
                label_list_visibility: Some(l.label_list_visibility),
                type_: Some(l.type_),
            })
            .collect();

        Ok(Some(ParsedThread {
            row: thread_row,
            messages,
            labels,
        }))
    }

    /// Fetch the newest non-draft content message for each authorized thread in one
    /// repository batch, then assemble senders, recipients, and labels in bulk.
    pub(crate) async fn get_latest_messages_parsed_impl(
        &self,
        receipts: Vec<EntityAccessReceipt<ViewAccessLevel>>,
    ) -> Result<HashMap<Uuid, ParsedMessage>, EmailErr> {
        let mut thread_ids = Vec::with_capacity(receipts.len());
        for receipt in receipts {
            let thread_id = Uuid::parse_str(&receipt.entity().entity_id)
                .map_err(|err| EmailErr::RepoErr(anyhow::anyhow!("invalid thread id: {err}")))?;
            thread_ids.push(thread_id);
        }

        if thread_ids.is_empty() {
            return Ok(HashMap::new());
        }

        let rows = self
            .email_repo
            .latest_content_message_rows(&thread_ids)
            .await
            .map_err(anyhow::Error::from)?;
        let message_ids = rows.iter().map(|row| row.db_id).collect::<Vec<_>>();
        let (mut senders, mut recipients, mut labels) = tokio::try_join!(
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
                    .labels_by_message_ids(&message_ids)
                    .await
                    .map_err(anyhow::Error::from)
            },
        )?;

        Ok(rows
            .into_iter()
            .map(|row| {
                let message_id = row.db_id;
                let thread_id = row.thread_db_id;
                let message = parsed_message_from_row(
                    row,
                    senders.remove(&message_id),
                    recipients.remove(&message_id).unwrap_or_default(),
                    labels.remove(&message_id).unwrap_or_default(),
                );
                (thread_id, message)
            })
            .collect())
    }
}

fn parsed_message_from_row(
    row: MessageRow,
    sender: Option<ContactInfo>,
    recipients: Vec<(ContactInfo, crate::domain::models::RecipientType)>,
    labels: Vec<MessageLabel>,
) -> ParsedMessage {
    let (to, cc, bcc) = split_recipients(recipients);
    let body_replyless = email_utils::body_replyless::compute_body_replyless(
        row.subject.as_deref(),
        row.body_html_sanitized.as_deref(),
        row.body_text.as_deref(),
    );
    let body_parsed = email_utils::body_parsed::compute_body_parsed(
        row.body_html_sanitized.is_some(),
        &body_replyless,
    );

    ParsedMessage {
        db_id: row.db_id,
        link_id: row.link_id,
        thread_db_id: row.thread_db_id,
        subject: row.subject,
        snippet: row.snippet,
        from: sender,
        to,
        cc,
        bcc,
        labels: labels
            .into_iter()
            .map(|label| ParsedLabel {
                id: label.id,
                link_id: label.link_id,
                provider_id: label.provider_label_id,
                name: label.name.unwrap_or_default(),
                created_at: label.created_at,
                message_list_visibility: label.message_list_visibility,
                label_list_visibility: label.label_list_visibility,
                type_: label.type_,
            })
            .collect(),
        body_parsed,
        body_text: row.body_text,
        body_html_sanitized: row.body_html_sanitized,
        body_macro: row.body_macro,
        body_replyless,
        internal_date_ts: row.internal_date_ts,
        sent_at: row.sent_at,
        is_read: row.is_read,
        is_starred: row.is_starred,
        is_sent: row.is_sent,
        is_draft: row.is_draft,
        has_attachments: row.has_attachments,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}
