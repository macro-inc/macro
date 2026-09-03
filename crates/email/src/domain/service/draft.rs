use crate::domain::{
    models::{
        CreateDraftInput, CreatedDraft, DeletedUserDraft, EmailErr, Link, ParsedAddresses,
        ResolvedDraftInput, SavedUserDraft, SimpleMessageInfo, ThreadRow,
    },
    ports::EmailRepo,
};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use frecency::domain::ports::FrecencyQueryService;
use uuid::Uuid;

use super::EmailServiceImpl;

#[cfg(test)]
mod test;

impl<T, U, E, CS, Eam, B> EmailServiceImpl<T, U, E, CS, Eam, B>
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

    #[tracing::instrument(err, skip(self, input))]
    pub(crate) async fn save_draft_for_user_impl(
        &self,
        macro_id: macro_user_id::user_id::MacroUserIdStr<'_>,
        link_id: Option<Uuid>,
        mut input: CreateDraftInput,
    ) -> Result<SavedUserDraft, EmailErr> {
        let accessible_inboxes = self
            .email_repo
            .inboxes_for_macro_id(macro_id.clone())
            .await
            .map_err(anyhow::Error::from)?;
        let link = resolve_target_link(&accessible_inboxes, link_id, &macro_id)?.clone();
        let accessible_link_ids: Vec<Uuid> = accessible_inboxes.iter().map(|l| l.id).collect();
        self.resolve_client_handles(&mut input, &accessible_link_ids)
            .await?;
        let draft = self
            .create_draft_impl(&link, &accessible_inboxes, input)
            .await?;
        Ok(SavedUserDraft { draft, link })
    }

    /// Resolve the user-scoped save's client handles into server IDs.
    ///
    /// GraphQL saves carry client-generated identity so offline replays stay
    /// idempotent — but a client-supplied ID must never become a primary key
    /// in the shared email tables. Each handle resolves through its mapping
    /// table (scoped to the caller's inboxes, so identical handles from
    /// different users never interact); an unmapped handle that happens to
    /// name an accessible row is treated as a server ID from a fetched draft
    /// and bound to itself; anything else stays unresolved and gets a
    /// server-minted row, with the binding recorded in the same transaction
    /// as the insert. Resolution reads are advisory — the mapping upsert and
    /// the insert's owner guard are the race-proof enforcement.
    async fn resolve_client_handles(
        &self,
        input: &mut CreateDraftInput,
        accessible_link_ids: &[Uuid],
    ) -> Result<(), EmailErr> {
        if let Some(handle) = input.db_id {
            // Bind on every save, hit or miss: a sender switch deletes and
            // recreates the row, cascading the old binding away — the
            // insert's binding upsert re-points the handle at whatever row
            // the save converges on.
            input.draft_client_binding = Some(handle);
            match self
                .email_repo
                .message_id_for_client_draft_id(handle, accessible_link_ids)
                .await
                .map_err(anyhow::Error::from)?
            {
                Some(message_id) => input.db_id = Some(message_id),
                None => {
                    let is_server_id = self
                        .email_repo
                        .get_simple_message(handle, accessible_link_ids)
                        .await
                        .map_err(anyhow::Error::from)?
                        .is_some();
                    if !is_server_id {
                        input.db_id = None;
                    }
                }
            }
        }
        // Thread handles are a compose concern: replies derive their thread
        // from the reply target, and binding the reply's server-thread hint
        // here would write junk mapping rows — or, for a cross-inbox reply,
        // map the original thread's ID onto the newly created thread.
        if input.replying_to_id.is_none() {
            if let Some(handle) = input.thread_db_id {
                input.thread_client_binding = Some(handle);
                if let Some(thread_id) = self
                    .email_repo
                    .thread_id_for_client_thread_id(handle, accessible_link_ids)
                    .await
                    .map_err(anyhow::Error::from)?
                {
                    input.thread_db_id = Some(thread_id);
                }
                // Unmapped handles stay in place: validate_thread_hint
                // attaches an accessible server thread, and anything else
                // gets a server-minted thread the binding then points at.
            }
        }
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    pub(crate) async fn delete_draft_for_user_impl(
        &self,
        macro_id: macro_user_id::user_id::MacroUserIdStr<'_>,
        draft_id: Uuid,
    ) -> Result<DeletedUserDraft, EmailErr> {
        let accessible_link_ids: Vec<Uuid> = self
            .email_repo
            .inboxes_for_macro_id(macro_id)
            .await
            .map_err(anyhow::Error::from)?
            .iter()
            .map(|link| link.id)
            .collect();

        // The handle resolves like a save's: through the caller-scoped
        // mapping first, else as a server ID from a fetched draft.
        let resolved_id = self
            .email_repo
            .message_id_for_client_draft_id(draft_id, &accessible_link_ids)
            .await
            .map_err(anyhow::Error::from)?
            .unwrap_or(draft_id);

        // Advisory read: classifies the ID for error reporting. Enforcement
        // is the guarded DELETE below, whose WHERE clause re-checks ownership
        // and draft state, so a raced read can at most turn the delete into
        // a no-op — never remove a row the caller doesn't own.
        let Some(msg) = self
            .email_repo
            .get_simple_message(resolved_id, &accessible_link_ids)
            .await
            .map_err(anyhow::Error::from)?
        else {
            // Absent or someone else's (reported identically so the delete is
            // no existence oracle): an idempotent no-op, so a delete queued
            // offline lands cleanly even when it replays after the draft is
            // already gone.
            return Ok(DeletedUserDraft {
                deleted: false,
                thread_deleted: false,
            });
        };

        if msg.is_sent || !msg.is_draft {
            return Err(EmailErr::MessageAlreadySent(draft_id));
        }

        let deletion = self
            .email_repo
            .delete_draft_message(msg.db_id, msg.thread_db_id, &accessible_link_ids)
            .await
            .map_err(anyhow::Error::from)?;

        // `None` means the guarded delete matched nothing: the draft was
        // concurrently deleted or sent. The row is gone from the caller's
        // perspective either way, so report the raced case as the no-op.
        Ok(match deletion {
            Some(deletion) => DeletedUserDraft {
                deleted: true,
                thread_deleted: deletion.thread_deleted,
            },
            None => DeletedUserDraft {
                deleted: false,
                thread_deleted: false,
            },
        })
    }

    /// Shared pipeline for creating a draft or a sent message.
    ///
    /// Validates existing message / reply-to, decodes and sanitizes the HTML
    /// body, upserts contacts, builds thread if needed, and inserts the message
    /// row via the repo layer.
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

        self.validate_thread_hint(link_id, &mut input).await?;

        decode_and_sanitize_html_body(&mut input)?;

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
            actor_id: input.actor.as_ref().map(|actor| actor.as_ref().to_owned()),
            draft_client_id: input.draft_client_binding,
            thread_client_id: input.thread_client_binding,
        };

        let applied = self
            .email_repo
            .insert_message(&resolved, &contacts, link_id, new_thread, is_draft)
            .await
            .map_err(anyhow::Error::from)?;
        if !applied {
            // The upsert's owner guard rejected the write: the ID exists under
            // another inbox or stopped being an unsent draft since validation.
            // Opaque not-found, matching the validation read's failure mode.
            return Err(EmailErr::MessageNotFound(resolved.db_id));
        }

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

        let Some(msg) = self
            .email_repo
            .get_simple_message(db_id, accessible_link_ids)
            .await
            .map_err(anyhow::Error::from)?
        else {
            // A message ID must name an accessible row: REST clients only
            // send IDs learned from responses, and user-scoped (GraphQL)
            // saves arrive here with the client handle already resolved —
            // an unresolvable handle was cleared so the row is server-minted.
            // A miss is therefore a stale/foreign ID, reported opaquely.
            return Err(EmailErr::MessageNotFound(db_id));
        };

        if msg.is_sent || !msg.is_draft {
            return Err(EmailErr::MessageAlreadySent(db_id));
        }

        if msg.link_id != link_id {
            // The sender was switched to a different inbox. A draft belongs to a
            // single inbox, so discard it (and its now-empty thread) and create a
            // fresh draft in the sending inbox; validate_replying_to re-derives
            // the thread from the reply target. The draft keeps its server ID
            // across the move, and the delete's cascade drops any client-handle
            // binding — the save's binding upsert re-points the handle at the
            // recreated row in the same transaction, so queued offline saves
            // keep converging. A raced delete (`None`) is fine — the row is
            // gone either way, and a raced send is caught by the insert's
            // owner guard.
            self.email_repo
                .delete_draft_message(msg.db_id, msg.thread_db_id, accessible_link_ids)
                .await
                .map_err(anyhow::Error::from)?;
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

    /// Validate a client-supplied thread hint on the no-reply-target path.
    /// Reply drafts never reach the decision: their linkage was already
    /// re-derived from the reply target. A hint naming an accessible thread
    /// in the sending inbox attaches to it; any other hint — unknown, or a
    /// thread owned elsewhere, handled identically — gets a fresh
    /// server-minted thread. Compose saves replayed offline still converge
    /// on one thread through the client-handle binding, never by letting
    /// the hint become the thread's primary key.
    async fn validate_thread_hint(
        &self,
        link_id: Uuid,
        input: &mut CreateDraftInput,
    ) -> Result<(), EmailErr> {
        if input.replying_to_id.is_some() {
            return Ok(());
        }
        let Some(thread_db_id) = input.thread_db_id else {
            return Ok(());
        };
        let existing = self
            .email_repo
            .thread_by_id(thread_db_id)
            .await
            .map_err(anyhow::Error::from)?;
        match resolve_thread_hint(existing.as_ref(), link_id) {
            ThreadHintOutcome::Attach { provider_thread_id } => {
                input.provider_thread_id = provider_thread_id;
            }
            ThreadHintOutcome::CreateNew => {
                input.thread_db_id = None;
                input.provider_thread_id = None;
            }
        }
        Ok(())
    }

    /// If the input already has a (validated) thread_db_id, return it with no
    /// new thread. Otherwise, build a server-minted ThreadRow for creation
    /// inside the transaction.
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

/// The decision for a compose draft's client-supplied thread hint.
enum ThreadHintOutcome {
    /// The thread exists in the sending inbox — attach, adopting its
    /// provider thread ID.
    Attach { provider_thread_id: Option<String> },
    /// The hint names no thread in the sending inbox — unknown, or owned
    /// elsewhere. Create a fresh server-minted thread; behaving identically
    /// for both keeps the hint from acting as a thread-existence oracle.
    CreateNew,
}

/// Pure decision for a client-supplied thread hint: attach when the thread
/// exists in the sending inbox, create a fresh server-minted thread
/// otherwise. Hints are untrusted input and never become primary keys.
fn resolve_thread_hint(existing: Option<&ThreadRow>, link_id: Uuid) -> ThreadHintOutcome {
    match existing {
        Some(thread) if thread.link_id == link_id => ThreadHintOutcome::Attach {
            provider_thread_id: thread.provider_id.clone(),
        },
        Some(_) | None => ThreadHintOutcome::CreateNew,
    }
}

/// Resolve the single inbox a draft save targets from the caller's accessible
/// `links`. With an explicit `link_id`, the matching accessible link is used;
/// without one, the caller's own `is_primary` link. The `macro_id` guard
/// matters: the links list includes delegated inboxes, which are primary for
/// *their* account. Mirrors the `X-Email-Link-Id` axum extractor's semantics
/// for transports that carry the inbox by value instead of a header.
fn resolve_target_link<'a>(
    links: &'a [Link],
    link_id: Option<Uuid>,
    caller: &macro_user_id::user_id::MacroUserIdStr<'_>,
) -> Result<&'a Link, EmailErr> {
    match link_id {
        Some(id) => links.iter().find(|link| link.id == id),
        None => links
            .iter()
            .find(|link| link.is_primary && &link.macro_id == caller),
    }
    .ok_or(EmailErr::InboxNotFound)
}

/// Decodes the base64 `body_html` and sanitizes it against the shared email
/// allowlist.
///
/// Sanitizing here is what lets the column be called `body_html_sanitized`: the
/// body is client-supplied, and a stored thread is rendered via `innerHTML` by
/// every user who can see it, so an unsanitized locally-authored body is stored
/// XSS against anyone the thread is shared with. Runs before signature
/// injection so the `.macro-email-signature` marker the server adds survives.
fn decode_and_sanitize_html_body(input: &mut CreateDraftInput) -> Result<(), EmailErr> {
    if let Some(ref html_body) = input.body_html {
        let decoded = URL_SAFE_NO_PAD.decode(html_body.as_bytes())?;
        let decoded_str = String::from_utf8(decoded)?;
        input.body_html = Some(email_utils::sanitize_authored_html(&decoded_str));
    }
    Ok(())
}
