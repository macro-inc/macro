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

impl<T, U, E, CS> EmailServiceImpl<T, U, E, CS>
where
    T: EmailRepo,
    U: FrecencyQueryService,
    E: crate::domain::ports::EmailMessageEnqueuer,
    CS: crm::domain::service::CrmService,
    anyhow::Error: From<T::Err>,
{
    #[tracing::instrument(err, skip(self, link, accessible_inboxes, input))]
    pub(crate) async fn create_draft_impl(
        &self,
        link: &Link,
        accessible_inboxes: &[Link],
        input: CreateDraftInput,
    ) -> Result<CreatedDraft, EmailErr> {
        self.prepare_and_insert_db_message(link, accessible_inboxes, input, true)
            .await
    }

    /// Shared pipeline for creating a draft or a sent message.
    ///
    /// Validates existing message / reply-to, decodes HTML body, upserts contacts,
    /// builds thread if needed, and inserts the message row via the repo layer.
    /// `is_draft` controls the `is_draft` flag persisted on the message row.
    #[tracing::instrument(err, skip(self, link, accessible_inboxes, input))]
    pub(crate) async fn prepare_and_insert_db_message(
        &self,
        link: &Link,
        accessible_inboxes: &[Link],
        mut input: CreateDraftInput,
        is_draft: bool,
    ) -> Result<CreatedDraft, EmailErr> {
        let link_id = link.id;
        let accessible_link_ids: Vec<Uuid> = accessible_inboxes.iter().map(|l| l.id).collect();

        self.validate_existing_message(link_id, &accessible_link_ids, &mut input)
            .await?;

        self.validate_replying_to(link_id, &accessible_link_ids, &mut input)
            .await?;

        decode_html_body(&mut input)?;

        // On send (not drafts), inject the inbox's signature into the body per
        // the user's settings + per-message override. Best-effort: never blocks
        // the send.
        if !is_draft {
            self.maybe_inject_signature(link, &mut input).await;
        }

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

    /// Appends the inbox's signature to the outgoing body (send path only).
    /// Gated by the per-message override and the inbox's settings; replies and
    /// forwards (a `replying_to_id` is present) require
    /// `signature_on_replies_forwards`. Best-effort — any failure just skips.
    async fn maybe_inject_signature(&self, link: &Link, input: &mut CreateDraftInput) {
        if input.include_signature == Some(false) {
            // Honor "exclude" literally: drop any server-wrapped signature a
            // client may have baked in, rather than just declining to add one.
            if input
                .body_html
                .as_deref()
                .is_some_and(super::signature::has_signature)
                && let Some(body_html) = input.body_html.take()
            {
                input.body_html = Some(super::signature::strip_signature(&body_html));
            }
            return;
        }
        // Idempotent: if the body already carries a signature — a client still
        // baking it in during the FE cutover, or a re-sent message — don't add
        // another (and leave body_text alone too).
        if input
            .body_html
            .as_deref()
            .is_some_and(super::signature::has_signature)
        {
            return;
        }
        let settings = match self.email_repo.fetch_email_settings(link.id).await {
            Ok(settings) => settings,
            Err(e) => {
                tracing::warn!(error = ?e, "failed to fetch settings for signature; skipping");
                return;
            }
        };
        let Some(signature) = settings.signature.filter(|s| !s.trim().is_empty()) else {
            return;
        };
        let include = match input.include_signature {
            Some(value) => value,
            None => {
                if input.replying_to_id.is_some() {
                    settings.signature_on_replies_forwards
                } else {
                    true
                }
            }
        };
        if !include {
            return;
        }
        if let Some(body_html) = input.body_html.take() {
            input.body_html = Some(super::signature::inject_signature(&body_html, &signature));
        }
        let plain = super::signature::signature_plain_text(&signature);
        if !plain.is_empty()
            && let Some(existing) = input.body_text.take().filter(|s| !s.is_empty())
        {
            // Only append to an existing plain-text body. HTML-only sends
            // (body_text None/empty, e.g. the AI path) keep no text part rather
            // than getting a signature-only one that drops the message body.
            input.body_text = Some(format!("{existing}\n\n{plain}"));
        }
    }

    async fn validate_existing_message(
        &self,
        link_id: Uuid,
        accessible_link_ids: &[Uuid],
        input: &mut CreateDraftInput,
    ) -> Result<(), EmailErr> {
        let Some(db_id) = input.db_id else {
            return Ok(());
        };

        let msg = self
            .email_repo
            .get_simple_message(db_id, accessible_link_ids)
            .await
            .map_err(anyhow::Error::from)?
            .ok_or(EmailErr::MessageNotFound(db_id))?;

        if msg.is_sent || !msg.is_draft {
            return Err(EmailErr::MessageAlreadySent(db_id));
        }

        if msg.link_id != link_id {
            // The sender was switched to a different inbox. A draft belongs to a
            // single inbox, so discard it (and its now-empty thread) and create a
            // fresh draft in the sending inbox; validate_replying_to re-derives
            // the thread from the reply target.
            self.email_repo
                .delete_draft_message(msg.db_id, msg.thread_db_id)
                .await
                .map_err(anyhow::Error::from)?;
            input.db_id = None;
            input.provider_id = None;
            input.thread_db_id = None;
            input.provider_thread_id = None;
            return Ok(());
        }

        input.thread_db_id = Some(msg.thread_db_id);
        input.provider_thread_id = msg.provider_thread_id;

        Ok(())
    }

    async fn validate_replying_to(
        &self,
        link_id: Uuid,
        accessible_link_ids: &[Uuid],
        input: &mut CreateDraftInput,
    ) -> Result<(), EmailErr> {
        let Some(replying_to_id) = input.replying_to_id else {
            return Ok(());
        };

        // The draft replying to this message lives in the inbox being sent from.
        if let Some(existing_draft) = self
            .email_repo
            .get_draft_replying_to(link_id, replying_to_id)
            .await
            .map_err(anyhow::Error::from)?
        {
            self.apply_existing_draft(input, existing_draft);
        } else {
            self.apply_reply_target(link_id, accessible_link_ids, input, replying_to_id)
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
        accessible_link_ids: &[Uuid],
        input: &mut CreateDraftInput,
        replying_to_id: Uuid,
    ) -> Result<(), EmailErr> {
        let reply_target = self
            .email_repo
            .get_simple_message(replying_to_id, accessible_link_ids)
            .await
            .map_err(anyhow::Error::from)?
            .ok_or(EmailErr::MessageNotFound(replying_to_id))?;

        if reply_target.is_draft {
            return Err(EmailErr::CannotReplyToDraft);
        }

        if reply_target.link_id == link_id {
            // Same inbox: thread into the target's existing thread.
            input.thread_db_id = Some(reply_target.thread_db_id);
            input.provider_thread_id = reply_target.provider_thread_id;
        } else {
            // The target lives in a different inbox (a different provider
            // account), so it cannot thread into that account's provider
            // thread. Start a fresh thread in the sending inbox; the
            // Macro-In-Reply-To header below preserves the reference.
            input.thread_db_id = None;
            input.provider_thread_id = None;
        }

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
            project_id: None,
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
