use std::{future::Future, marker::PhantomData, pin::Pin, sync::Arc};

use async_graphql::{Context, ErrorExtensions, ID, InputObject, Object, OutputType, SimpleObject};
use chrono::Utc;
use email::domain::{
    models::{
        ContactInfo, CreateDraftInput, DeletedUserDraft, EmailErr, Message, SavedUserDraft,
        UpdateThreadLabelsResult,
    },
    ports::EmailService,
};

use crate::loaders::EmailContentMessage;
use crate::objects::GraphqlSoupEmailMessage;
use graphql_common::{parse_id, require_authenticated_user};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Domain-facing capability required by email thread mutations.
pub trait EmailMutationService: Send + Sync + 'static {
    /// Mark an accessible email thread as seen by the authenticated user.
    fn mark_email_thread_seen(
        &self,
        user_id: MacroUserIdStr<'static>,
        thread_id: Uuid,
    ) -> impl Future<Output = Result<(), EmailErr>> + Send;

    /// Add or remove one label from every message in an accessible email thread.
    fn update_email_thread_label(
        &self,
        user_id: MacroUserIdStr<'static>,
        thread_id: Uuid,
        label_id: Uuid,
        value: bool,
    ) -> impl Future<Output = Result<UpdateThreadLabelsResult, EmailErr>> + Send;

    /// Create or update a draft for the authenticated user, resolving the
    /// sending inbox from `link_id` (or the caller's primary inbox).
    fn save_email_draft(
        &self,
        user_id: MacroUserIdStr<'static>,
        link_id: Option<Uuid>,
        input: CreateDraftInput,
    ) -> impl Future<Output = Result<SavedUserDraft, EmailErr>> + Send;

    /// Delete a draft for the authenticated user, idempotently: an ID that
    /// is already gone is a successful no-op.
    fn delete_email_draft(
        &self,
        user_id: MacroUserIdStr<'static>,
        draft_id: Uuid,
    ) -> impl Future<Output = Result<DeletedUserDraft, EmailErr>> + Send;
}

impl<S> EmailMutationService for S
where
    S: EmailService,
{
    async fn mark_email_thread_seen(
        &self,
        user_id: MacroUserIdStr<'static>,
        thread_id: Uuid,
    ) -> Result<(), EmailErr> {
        self.mark_thread_seen(user_id, thread_id).await
    }

    async fn update_email_thread_label(
        &self,
        user_id: MacroUserIdStr<'static>,
        thread_id: Uuid,
        label_id: Uuid,
        value: bool,
    ) -> Result<UpdateThreadLabelsResult, EmailErr> {
        self.update_thread_labels_for_user(user_id, thread_id, label_id, value)
            .await
    }

    async fn save_email_draft(
        &self,
        user_id: MacroUserIdStr<'static>,
        link_id: Option<Uuid>,
        input: CreateDraftInput,
    ) -> Result<SavedUserDraft, EmailErr> {
        self.save_draft_for_user(user_id, link_id, input).await
    }

    async fn delete_email_draft(
        &self,
        user_id: MacroUserIdStr<'static>,
        draft_id: Uuid,
    ) -> Result<DeletedUserDraft, EmailErr> {
        self.delete_draft_for_user(user_id, draft_id).await
    }
}

/// Boxed future that reloads an email thread after a mutation.
pub type EmailThreadMutationLoadFuture<'ctx, T> =
    Pin<Box<dyn Future<Output = async_graphql::Result<Option<T>>> + Send + 'ctx>>;

/// Supplies the canonical email-thread GraphQL object returned after a mutation.
///
/// The complete schema implements this boundary with its Soup email-thread type,
/// keeping `graphql_email` independent from the higher-level schema composition.
pub trait EmailThreadMutationOutput: Send + Sync + 'static {
    /// Canonical email-thread output object.
    type Thread: OutputType + Send + Sync + 'static;

    /// Reload the mutated thread for the authenticated viewer.
    fn load_email_thread<'ctx>(
        ctx: &'ctx Context<'_>,
        user_id: MacroUserIdStr<'static>,
        thread_id: Uuid,
    ) -> EmailThreadMutationLoadFuture<'ctx, Self::Thread>;
}

/// Root GraphQL adapter for email mutations.
pub struct GraphqlEmailMutation<S, O>(PhantomData<fn() -> (S, O)>);

impl<S, O> GraphqlEmailMutation<S, O> {
    /// Construct an email mutation root.
    pub fn new() -> Self {
        Self(PhantomData)
    }
}

impl<S, O> Default for GraphqlEmailMutation<S, O> {
    fn default() -> Self {
        Self::new()
    }
}

/// Input for marking an email thread as seen.
#[derive(InputObject)]
pub struct MarkEmailThreadSeenInput {
    /// Email thread to mark as seen.
    pub thread_id: ID,
}

/// Input for adding or removing a label from an email thread.
#[derive(InputObject)]
pub struct UpdateEmailThreadLabelInput {
    /// Email thread whose label assignment will change.
    pub thread_id: ID,
    /// Label to add or remove.
    pub label_id: ID,
    /// Whether the label should be present after the mutation.
    pub value: bool,
}

/// One recipient of an email draft.
#[derive(InputObject)]
pub struct SaveEmailDraftContactInput {
    /// Recipient email address.
    pub email: String,
    /// Recipient display name, when known.
    pub name: Option<String>,
    /// Recipient photo URL, when known.
    pub photo_url: Option<String>,
}

impl From<SaveEmailDraftContactInput> for ContactInfo {
    fn from(input: SaveEmailDraftContactInput) -> Self {
        Self {
            email: input.email,
            name: input.name,
            photo_url: input.photo_url,
        }
    }
}

/// Input for creating or updating an email draft.
///
/// The draft ID is a client-generated handle so a save queued offline stays
/// an idempotent upsert when it replays later — possibly after an app
/// restart, possibly more than once. Handles are untrusted input and never
/// become primary keys: the server resolves them through a caller-scoped
/// mapping to server-minted rows. Thread identifiers are hints: the server
/// derives authoritative thread linkage from the reply target or the
/// existing draft.
#[derive(InputObject)]
pub struct SaveEmailDraftInput {
    /// Draft handle: a client-generated ID, or a server ID from a fetched
    /// draft. Resolved scoped to the caller's inboxes, and bound to the
    /// server row the save settles on, so replays converge on one draft.
    pub draft_id: ID,
    /// Sending inbox. Absent means the caller's primary inbox. Carried as a
    /// variable (not a header) so queued offline saves replay with it.
    pub link_id: Option<ID>,
    /// Message this draft replies to, when it is a reply.
    pub replying_to_id: Option<ID>,
    /// Provider-assigned draft ID, when the draft already exists upstream.
    pub provider_id: Option<String>,
    /// Provider-assigned thread ID hint.
    pub provider_thread_id: Option<String>,
    /// Thread handle. For replies this is a hint the server may override.
    /// For compose drafts (no reply target) it is client-generated: an
    /// unresolvable handle gets a fresh server-minted thread and is bound
    /// to it, so saves queued offline replay against one thread.
    pub thread_db_id: Option<ID>,
    /// Draft subject line.
    pub subject: String,
    /// To recipients.
    pub to: Option<Vec<SaveEmailDraftContactInput>>,
    /// Cc recipients.
    pub cc: Option<Vec<SaveEmailDraftContactInput>>,
    /// Bcc recipients.
    pub bcc: Option<Vec<SaveEmailDraftContactInput>>,
    /// Plain text body.
    pub body_text: Option<String>,
    /// HTML body, base64 URL-safe (no padding) encoded; the server decodes
    /// and sanitizes it before storing.
    pub body_html: Option<String>,
    /// Macro body.
    pub body_macro: Option<String>,
    /// Scheduled send time (RFC 3339), when the draft is scheduled.
    pub send_time: Option<String>,
}

/// Input for deleting an email draft.
#[derive(InputObject)]
pub struct DeleteEmailDraftInput {
    /// Draft handle to delete: a client-generated ID or a server ID, resolved
    /// like a save's. A handle that is already gone (or was never bound — a
    /// discard can replay before its draft's first save ever committed)
    /// deletes nothing and still succeeds, so a delete queued offline lands
    /// cleanly however late it replays.
    pub draft_id: ID,
}

/// Result of deleting an email draft.
#[derive(SimpleObject)]
pub struct DeleteEmailDraftPayload {
    /// The requested draft ID, echoed for client cache bookkeeping.
    pub draft_id: ID,
    /// Whether a draft row was actually deleted. `false` means the ID was
    /// already gone and the delete was an idempotent no-op.
    pub deleted: bool,
    /// Whether deleting the draft emptied its thread and removed the thread
    /// too (a discarded compose draft that never gained other messages).
    pub thread_deleted: bool,
}

/// Result of creating or updating an email draft.
pub struct SaveEmailDraftPayload<O: EmailThreadMutationOutput> {
    draft_id: Uuid,
    draft: GraphqlSoupEmailMessage,
    thread: O::Thread,
}

/// Result of creating or updating an email draft.
#[Object(name = "SaveEmailDraftPayload")]
impl<O> SaveEmailDraftPayload<O>
where
    O: EmailThreadMutationOutput,
{
    /// Server-confirmed draft ID: the server-minted row the input's handle
    /// resolved (and is now bound) to. Use it for server-addressed calls;
    /// the handle keeps working for queued saves and deletes.
    async fn draft_id(&self) -> ID {
        ID(self.draft_id.to_string())
    }

    /// The saved draft as a full message record — selected with the thread
    /// page's message fragment so the client cache can hold the draft as a
    /// complete entity (its optimistic layer must satisfy every field the
    /// thread page reads, or the whole page read misses).
    async fn draft(&self) -> &GraphqlSoupEmailMessage {
        &self.draft
    }

    /// The draft's thread, reloaded as its authoritative cache record.
    async fn thread(&self) -> &O::Thread {
        &self.thread
    }
}

/// Builds the payload's message record from the saved draft. Attachment
/// collections are empty even when an upserted draft already has uploads —
/// the post-commit thread revalidation restores them; this record's job is
/// carrying the draft's content and identity.
fn saved_draft_message(saved: SavedUserDraft) -> Message {
    let SavedUserDraft { draft, link } = saved;
    let now = Utc::now();
    Message {
        db_id: draft.db_id,
        provider_id: draft.provider_id,
        thread_db_id: draft.thread_db_id,
        provider_thread_id: draft.provider_thread_id,
        replying_to_id: draft.replying_to_id,
        global_id: None,
        link_id: draft.link_id,
        subject: Some(draft.subject),
        snippet: None,
        provider_history_id: None,
        internal_date_ts: None,
        sent_at: None,
        size_estimate: None,
        is_read: true,
        is_starred: false,
        is_sent: false,
        is_draft: true,
        has_attachments: false,
        scheduled_send_time: draft.send_time,
        from: Some(ContactInfo {
            email: String::from(link.email_address),
            name: None,
            photo_url: None,
        }),
        to: draft.to,
        cc: draft.cc,
        bcc: draft.bcc,
        labels: Vec::new(),
        body_text: draft.body_text,
        body_html_sanitized: draft.body_html,
        body_macro: draft.body_macro,
        body_replyless: None,
        attachments: Vec::new(),
        attachments_draft: Vec::new(),
        attachments_forwarded: Vec::new(),
        headers_json: draft.headers_json,
        created_at: now,
        updated_at: now,
    }
}

/// Error taxonomy for the draft mutations (save and delete), mirroring the
/// REST `CreateDraftError` mapping with machine-readable `extensions.code`
/// values the client's offline queue can branch on after a replayed
/// mutation permanently fails.
fn draft_mutation_error(error: &EmailErr) -> async_graphql::Error {
    let (message, code) = match error {
        EmailErr::MessageAlreadySent(_) => {
            ("email draft has already been sent", "DRAFT_ALREADY_SENT")
        }
        EmailErr::MessageNotFound(_) => ("referenced email message not found", "NOT_FOUND"),
        EmailErr::ThreadNotFound => ("email thread not found", "NOT_FOUND"),
        EmailErr::InboxNotFound => ("email inbox not found", "INBOX_NOT_FOUND"),
        EmailErr::CannotReplyToDraft => ("cannot reply to a draft", "INVALID"),
        EmailErr::Base64DecodeError(_) | EmailErr::Utf8Error(_) => {
            ("email draft body is invalid", "INVALID")
        }
        EmailErr::Unauthorized => ("not authorized to modify email draft", "UNAUTHORIZED"),
        _ => ("email draft mutation failed", "INTERNAL"),
    };
    async_graphql::Error::new(message).extend_with(|_, extensions| extensions.set("code", code))
}

fn mutation_error(error: &EmailErr) -> async_graphql::Error {
    let message = match error {
        EmailErr::ThreadNotFound | EmailErr::ThreadEmpty => "email thread not found",
        EmailErr::LabelNotFound => "email label not found",
        EmailErr::EmptyProviderLabelId => "email label is invalid",
        EmailErr::Unauthorized => "not authorized to update email thread",
        _ => "email thread mutation failed",
    };
    async_graphql::Error::new(message)
}

async fn reload_thread<O: EmailThreadMutationOutput>(
    ctx: &Context<'_>,
    user_id: MacroUserIdStr<'static>,
    thread_id: Uuid,
) -> async_graphql::Result<O::Thread> {
    O::load_email_thread(ctx, user_id, thread_id)
        .await?
        .ok_or_else(|| async_graphql::Error::new("updated email thread is unavailable"))
}

/// GraphQL email mutations.
#[Object]
impl<S, O> GraphqlEmailMutation<S, O>
where
    S: EmailMutationService,
    O: EmailThreadMutationOutput,
{
    /// Mark an accessible email thread as seen and return its authoritative cache record.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn mark_email_thread_seen(
        &self,
        ctx: &Context<'_>,
        input: MarkEmailThreadSeenInput,
    ) -> async_graphql::Result<O::Thread> {
        let user_id = require_authenticated_user(ctx)?;
        let thread_id = parse_id(input.thread_id, "threadId")?;
        let service = ctx.data::<Arc<S>>()?;

        service
            .mark_email_thread_seen(user_id.clone(), thread_id)
            .await
            .map_err(|error| {
                tracing::error!(
                    error = ?error,
                    user_id = %user_id,
                    %thread_id,
                    "failed to mark email thread seen"
                );
                mutation_error(&error)
            })?;

        reload_thread::<O>(ctx, user_id, thread_id).await
    }

    /// Add or remove one label from an accessible email thread and return its authoritative cache record.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn update_email_thread_label(
        &self,
        ctx: &Context<'_>,
        input: UpdateEmailThreadLabelInput,
    ) -> async_graphql::Result<O::Thread> {
        let user_id = require_authenticated_user(ctx)?;
        let thread_id = parse_id(input.thread_id, "threadId")?;
        let label_id = parse_id(input.label_id, "labelId")?;
        let service = ctx.data::<Arc<S>>()?;

        service
            .update_email_thread_label(user_id.clone(), thread_id, label_id, input.value)
            .await
            .map_err(|error| {
                tracing::error!(
                    error = ?error,
                    user_id = %user_id,
                    %thread_id,
                    %label_id,
                    value = input.value,
                    "failed to update email thread label"
                );
                mutation_error(&error)
            })?;

        reload_thread::<O>(ctx, user_id, thread_id).await
    }

    /// Create or update an email draft and return its thread's authoritative
    /// cache record. The client-generated handle resolves through a
    /// caller-scoped mapping to a server-minted row, so a save replayed from
    /// the offline mutation queue converges instead of duplicating.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn save_email_draft(
        &self,
        ctx: &Context<'_>,
        input: SaveEmailDraftInput,
    ) -> async_graphql::Result<SaveEmailDraftPayload<O>> {
        let user_id = require_authenticated_user(ctx)?;
        let link_id = input
            .link_id
            .clone()
            .map(|id| parse_id(id, "linkId"))
            .transpose()?;
        let draft_input = draft_input_from_graphql(input)?;
        let service = ctx.data::<Arc<S>>()?;

        let saved = service
            .save_email_draft(user_id.clone(), link_id, draft_input)
            .await
            .map_err(|error| {
                tracing::error!(
                    error = ?error,
                    user_id = %user_id,
                    "failed to save email draft"
                );
                draft_mutation_error(&error)
            })?;

        let draft_id = saved.draft.db_id;
        let thread = reload_thread::<O>(ctx, user_id, saved.draft.thread_db_id).await?;
        Ok(SaveEmailDraftPayload {
            draft_id,
            draft: GraphqlSoupEmailMessage::from_content(EmailContentMessage::from(
                saved_draft_message(saved),
            )),
            thread,
        })
    }

    /// Delete an email draft. Idempotent: deleting an ID that is already
    /// gone succeeds with `deleted: false`, so a delete replayed from the
    /// offline mutation queue lands cleanly however late it arrives.
    /// Deleting a draft that has since been sent fails with
    /// `DRAFT_ALREADY_SENT`.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn delete_email_draft(
        &self,
        ctx: &Context<'_>,
        input: DeleteEmailDraftInput,
    ) -> async_graphql::Result<DeleteEmailDraftPayload> {
        let user_id = require_authenticated_user(ctx)?;
        let draft_id = parse_id(input.draft_id, "draftId")?;
        let service = ctx.data::<Arc<S>>()?;

        let deleted = service
            .delete_email_draft(user_id.clone(), draft_id)
            .await
            .map_err(|error| {
                tracing::error!(
                    error = ?error,
                    user_id = %user_id,
                    %draft_id,
                    "failed to delete email draft"
                );
                draft_mutation_error(&error)
            })?;

        Ok(DeleteEmailDraftPayload {
            draft_id: ID(draft_id.to_string()),
            deleted: deleted.deleted,
            thread_deleted: deleted.thread_deleted,
        })
    }
}

/// Convert transport input into the domain draft input. Drafts carry no
/// actor: attribution happens when the draft is actually sent.
fn draft_input_from_graphql(input: SaveEmailDraftInput) -> async_graphql::Result<CreateDraftInput> {
    let send_time = input
        .send_time
        .as_deref()
        .map(|raw| {
            chrono::DateTime::parse_from_rfc3339(raw)
                .map(|time| time.with_timezone(&Utc))
                .map_err(|_| {
                    async_graphql::Error::new("sendTime is not a valid RFC 3339 timestamp")
                        .extend_with(|_, extensions| extensions.set("code", "INVALID"))
                })
        })
        .transpose()?;

    Ok(CreateDraftInput {
        db_id: Some(parse_id(input.draft_id, "draftId")?),
        provider_id: input.provider_id,
        replying_to_id: input
            .replying_to_id
            .map(|id| parse_id(id, "replyingToId"))
            .transpose()?,
        provider_thread_id: input.provider_thread_id,
        thread_db_id: input
            .thread_db_id
            .map(|id| parse_id(id, "threadDbId"))
            .transpose()?,
        subject: input.subject,
        to: contacts_from_inputs(input.to),
        cc: contacts_from_inputs(input.cc),
        bcc: contacts_from_inputs(input.bcc),
        body_text: input.body_text,
        body_html: input.body_html,
        body_macro: input.body_macro,
        headers_json: None,
        send_time,
        include_signature: None,
        actor: None,
        // Handle resolution (and any binding) is owned by the user-scoped
        // save, never by transport input.
        draft_client_binding: None,
        thread_client_binding: None,
    })
}

fn contacts_from_inputs(inputs: Option<Vec<SaveEmailDraftContactInput>>) -> Vec<ContactInfo> {
    inputs
        .unwrap_or_default()
        .into_iter()
        .map(ContactInfo::from)
        .collect()
}
