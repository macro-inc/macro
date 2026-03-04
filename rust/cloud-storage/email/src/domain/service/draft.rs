use crate::domain::{
    models::{
        CreateDraftInput, CreatedDraft, EmailErr, Link, ParsedAddresses, ResolvedDraftInput,
        SimpleMessageInfo, ThreadRow,
    },
    ports::EmailRepo,
};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use frecency::domain::ports::FrecencyQueryService;
use uuid::Uuid;

use super::EmailServiceImpl;

impl<T, U, E> EmailServiceImpl<T, U, E>
where
    T: EmailRepo,
    U: FrecencyQueryService,
    E: crate::domain::ports::EmailMessageEnqueuer,
    anyhow::Error: From<T::Err>,
{
    #[tracing::instrument(err, skip(self, link, input))]
    pub(crate) async fn create_draft_impl(
        &self,
        link: &Link,
        input: CreateDraftInput,
    ) -> Result<CreatedDraft, EmailErr> {
        self.prepare_and_insert_db_message(link, input, true).await
    }

    /// Shared pipeline for creating a draft or a sent message.
    ///
    /// Validates existing message / reply-to, decodes HTML body, upserts contacts,
    /// builds thread if needed, and inserts the message row via the repo layer.
    /// `is_draft` controls the `is_draft` flag persisted on the message row.
    #[tracing::instrument(err, skip(self, link, input))]
    pub(crate) async fn prepare_and_insert_db_message(
        &self,
        link: &Link,
        mut input: CreateDraftInput,
        is_draft: bool,
    ) -> Result<CreatedDraft, EmailErr> {
        let link_id = link.id;

        self.validate_existing_message(link_id, &mut input).await?;

        self.validate_replying_to(link_id, &mut input).await?;

        decode_html_body(&mut input)?;

        // Build parsed addresses
        let from_email = String::from(link.email_address.clone());
        let addresses = ParsedAddresses {
            from_email: from_email.clone(),
            from_name: None,
            to: input.to.clone(),
            cc: input.cc.clone(),
            bcc: input.bcc.clone(),
        };

        // Upsert contacts (outside transaction to avoid deadlocks)
        let contacts = self
            .email_repo
            .upsert_contacts(link_id, addresses)
            .await
            .map_err(anyhow::Error::from)?;

        // Build new thread if one doesn't already exist
        let (thread_db_id, new_thread) = self.build_new_thread_if_needed(link_id, &input);

        // Resolve all IDs and build the insert-ready struct
        let message_db_id = input.db_id.unwrap_or_else(macro_uuid::generate_uuid_v7);

        let resolved = ResolvedDraftInput {
            db_id: message_db_id,
            provider_id: input.provider_id,
            replying_to_id: input.replying_to_id,
            provider_thread_id: input.provider_thread_id,
            thread_db_id,
            subject: input.subject,
            to: input.to,
            cc: input.cc,
            bcc: input.bcc,
            body_text: input.body_text,
            body_html: input.body_html,
            body_macro: input.body_macro,
            headers_json: input.headers_json,
            send_time: input.send_time,
        };

        self.email_repo
            .insert_message(&resolved, &contacts, link_id, new_thread, is_draft)
            .await
            .map_err(anyhow::Error::from)?;

        Ok(CreatedDraft {
            db_id: resolved.db_id,
            provider_id: resolved.provider_id,
            replying_to_id: resolved.replying_to_id,
            provider_thread_id: resolved.provider_thread_id,
            thread_db_id: resolved.thread_db_id,
            link_id,
            subject: resolved.subject,
            to: resolved.to,
            cc: resolved.cc,
            bcc: resolved.bcc,
            body_text: resolved.body_text,
            body_html: resolved.body_html,
            body_macro: resolved.body_macro,
            headers_json: resolved.headers_json,
            send_time: resolved.send_time,
        })
    }

    async fn validate_existing_message(
        &self,
        link_id: Uuid,
        input: &mut CreateDraftInput,
    ) -> Result<(), EmailErr> {
        let Some(db_id) = input.db_id else {
            return Ok(());
        };

        let msg = self
            .email_repo
            .get_simple_message(db_id, link_id)
            .await
            .map_err(anyhow::Error::from)?
            .ok_or(EmailErr::MessageNotFound(db_id))?;

        if msg.is_sent || !msg.is_draft {
            return Err(EmailErr::MessageAlreadySent(db_id));
        }

        input.thread_db_id = Some(msg.thread_db_id);
        input.provider_thread_id = msg.provider_thread_id;

        Ok(())
    }

    async fn validate_replying_to(
        &self,
        link_id: Uuid,
        input: &mut CreateDraftInput,
    ) -> Result<(), EmailErr> {
        let Some(replying_to_id) = input.replying_to_id else {
            return Ok(());
        };

        // Check if a draft already exists replying to this message
        if let Some(existing_draft) = self
            .email_repo
            .get_draft_replying_to(link_id, replying_to_id)
            .await
            .map_err(anyhow::Error::from)?
        {
            self.apply_existing_draft(input, existing_draft);
        } else {
            self.apply_reply_target(link_id, input, replying_to_id)
                .await?;
        }

        Ok(())
    }

    fn apply_existing_draft(
        &self,
        input: &mut CreateDraftInput,
        existing_draft: SimpleMessageInfo,
    ) {
        input.db_id = Some(existing_draft.db_id);
        input.thread_db_id = Some(existing_draft.thread_db_id);
        input.provider_thread_id = existing_draft.provider_thread_id;
        input.headers_json = existing_draft.headers_json;
    }

    async fn apply_reply_target(
        &self,
        link_id: Uuid,
        input: &mut CreateDraftInput,
        replying_to_id: Uuid,
    ) -> Result<(), EmailErr> {
        let reply_target = self
            .email_repo
            .get_simple_message(replying_to_id, link_id)
            .await
            .map_err(anyhow::Error::from)?
            .ok_or(EmailErr::MessageNotFound(replying_to_id))?;

        if reply_target.is_draft {
            return Err(EmailErr::CannotReplyToDraft);
        }

        input.thread_db_id = Some(reply_target.thread_db_id);
        input.provider_thread_id = reply_target.provider_thread_id;

        // Generate Macro-In-Reply-To header
        input.headers_json = Some(serde_json::json!([{
            "Macro-In-Reply-To": reply_target.db_id.to_string()
        }]));

        Ok(())
    }

    /// If the input already has a thread_db_id, return it with no new thread.
    /// Otherwise, build a ThreadRow for creation inside the transaction.
    fn build_new_thread_if_needed(
        &self,
        link_id: Uuid,
        input: &CreateDraftInput,
    ) -> (Uuid, Option<ThreadRow>) {
        if let Some(id) = input.thread_db_id {
            return (id, None);
        }

        let now = chrono::Utc::now();
        let thread = ThreadRow {
            db_id: macro_uuid::generate_uuid_v7(),
            provider_id: None,
            link_id,
            inbox_visible: false,
            is_read: true,
            latest_inbound_message_ts: None,
            latest_outbound_message_ts: None,
            latest_non_spam_message_ts: None,
            created_at: now,
            updated_at: now,
        };

        let thread_db_id = thread.db_id;
        (thread_db_id, Some(thread))
    }
}

fn decode_html_body(input: &mut CreateDraftInput) -> Result<(), EmailErr> {
    if let Some(ref html_body) = input.body_html {
        let decoded = URL_SAFE_NO_PAD.decode(html_body.as_bytes())?;
        let decoded_str = String::from_utf8(decoded)?;
        input.body_html = Some(decoded_str);
    }
    Ok(())
}
