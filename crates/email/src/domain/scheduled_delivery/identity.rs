//! Sent identity adoption and persistence sequencing.
use anyhow::Context;
use models_email::service::message::MessageToSend;
use uuid::Uuid;

/// Statement capabilities for adopting an imported message and its references.
pub trait MessageIdentityQueries: Send {
    /// Execute the imported_message storage operation.
    fn imported_message(
        &mut self,
        link_id: Uuid,
        message_id: Uuid,
        provider_id: &str,
    ) -> impl Future<Output = anyhow::Result<Option<Uuid>>> + Send;
    /// Execute the adopt_metadata storage operation.
    fn adopt_metadata(
        &mut self,
        link_id: Uuid,
        message_id: Uuid,
        imported_id: Uuid,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Execute the adopt_labels storage operation.
    fn adopt_labels(
        &mut self,
        message_id: Uuid,
        imported_id: Uuid,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Execute the adopt_recipients storage operation.
    fn adopt_recipients(
        &mut self,
        message_id: Uuid,
        imported_id: Uuid,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Execute the adopt_calendar storage operation.
    fn adopt_calendar(
        &mut self,
        message_id: Uuid,
        imported_id: Uuid,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Execute the adopt_replies storage operation.
    fn adopt_replies(
        &mut self,
        message_id: Uuid,
        imported_id: Uuid,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Execute the adopt_client_ids storage operation.
    fn adopt_client_ids(
        &mut self,
        message_id: Uuid,
        imported_id: Uuid,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Execute the adopt_draft_attachments storage operation.
    fn adopt_draft_attachments(
        &mut self,
        message_id: Uuid,
        imported_id: Uuid,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Execute the adopt_forwarded_attachments storage operation.
    fn adopt_forwarded_attachments(
        &mut self,
        message_id: Uuid,
        imported_id: Uuid,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Execute the remove_imported_message storage operation.
    fn remove_imported_message(
        &mut self,
        imported_id: Uuid,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Execute the duplicate_attachments storage operation.
    fn duplicate_attachments(
        &mut self,
        message_id: Uuid,
        imported_id: Uuid,
    ) -> impl Future<Output = anyhow::Result<Vec<(Uuid, Uuid)>>> + Send;
    /// Execute the adopt_attachment_storage storage operation.
    fn adopt_attachment_storage(
        &mut self,
        provider_attachment_id: Uuid,
        local_attachment_id: Uuid,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Execute the adopt_forwarded_references storage operation.
    fn adopt_forwarded_references(
        &mut self,
        provider_attachment_id: Uuid,
        local_attachment_id: Uuid,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Execute the adopt_document_references storage operation.
    fn adopt_document_references(
        &mut self,
        provider_attachment_id: Uuid,
        local_attachment_id: Uuid,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Execute the remove_duplicate_attachment storage operation.
    fn remove_duplicate_attachment(
        &mut self,
        local_attachment_id: Uuid,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Execute the adopt_attachments storage operation.
    fn adopt_attachments(
        &mut self,
        message_id: Uuid,
        imported_id: Uuid,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// Adopt an already imported provider message into the original local message.
#[tracing::instrument(target = "email_db_client::messages::sent_identity", skip(tx), err)]
pub async fn reconcile_message(
    tx: &mut impl MessageIdentityQueries,
    link_id: Uuid,
    message_id: Uuid,
    provider_id: &str,
) -> anyhow::Result<()> {
    let Some(imported_id) = tx
        .imported_message(link_id, message_id, provider_id)
        .await?
    else {
        return Ok(());
    };
    tx.adopt_metadata(link_id, message_id, imported_id).await?;
    tx.adopt_labels(message_id, imported_id).await?;
    tx.adopt_recipients(message_id, imported_id).await?;
    tx.adopt_calendar(message_id, imported_id).await?;
    tx.adopt_replies(message_id, imported_id).await?;
    tx.adopt_client_ids(message_id, imported_id).await?;
    tx.adopt_draft_attachments(message_id, imported_id).await?;
    tx.adopt_forwarded_attachments(message_id, imported_id)
        .await?;
    reconcile_attachments(tx, message_id, imported_id).await?;
    tx.remove_imported_message(imported_id).await?;
    Ok(())
}

async fn reconcile_attachments(
    tx: &mut impl MessageIdentityQueries,
    message_id: Uuid,
    imported_id: Uuid,
) -> anyhow::Result<()> {
    let duplicates = tx.duplicate_attachments(message_id, imported_id).await?;
    for (local_attachment_id, provider_attachment_id) in duplicates {
        tx.adopt_attachment_storage(provider_attachment_id, local_attachment_id)
            .await?;
        tx.adopt_forwarded_references(provider_attachment_id, local_attachment_id)
            .await?;
        tx.adopt_document_references(provider_attachment_id, local_attachment_id)
            .await?;
        tx.remove_duplicate_attachment(local_attachment_id).await?;
    }
    tx.adopt_attachments(message_id, imported_id).await?;
    Ok(())
}

/// Thread adoption and final message/thread projection statements.
pub trait ThreadIdentityQueries: Send {
    /// Execute the original_thread storage operation.
    fn original_thread(
        &mut self,
        message_id: Uuid,
        link_id: Uuid,
    ) -> impl Future<Output = anyhow::Result<Uuid>> + Send;
    /// Execute the canonical_thread storage operation.
    fn canonical_thread(
        &mut self,
        link_id: Uuid,
        provider_thread_id: &str,
    ) -> impl Future<Output = anyhow::Result<Option<Uuid>>> + Send;
    /// Execute the move_message_thread storage operation.
    fn move_message_thread(
        &mut self,
        message_id: Uuid,
        link_id: Uuid,
        canonical: Uuid,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Execute the move_attempt_thread storage operation.
    fn move_attempt_thread(
        &mut self,
        message_id: Uuid,
        link_id: Uuid,
        canonical: Uuid,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Execute the original_thread_empty storage operation.
    fn original_thread_empty(
        &mut self,
        original: Uuid,
    ) -> impl Future<Output = anyhow::Result<bool>> + Send;
    /// Execute the redirect_thread_aliases storage operation.
    fn redirect_thread_aliases(
        &mut self,
        link_id: Uuid,
        original: Uuid,
        canonical: Uuid,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Execute the redirect_original_thread storage operation.
    fn redirect_original_thread(
        &mut self,
        original: Uuid,
        link_id: Uuid,
        canonical: Uuid,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Recompute the existing thread metadata.
    fn metadata(
        &mut self,
        thread: Uuid,
        link: Uuid,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Recompute the existing attachment flags.
    fn attachment_flags(&mut self, thread: Uuid)
    -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Mark the confirmed provider message sent.
    fn mark_sent(
        &mut self,
        provider: &str,
        provider_thread: &str,
        link: Uuid,
        message: Uuid,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Save the provider identity on the resulting thread.
    fn thread_provider(
        &mut self,
        thread: Uuid,
        link: Uuid,
        provider: &str,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// Resolve a confirmed send to the provider's existing conversation, if sync won.
#[tracing::instrument(target = "email_db_client::threads::provider_identity", skip(tx), err)]
pub async fn reconcile_sent_thread(
    tx: &mut impl ThreadIdentityQueries,
    link_id: Uuid,
    message_id: Uuid,
    provider_thread_id: &str,
) -> anyhow::Result<Uuid> {
    let original = tx.original_thread(message_id, link_id).await?;
    let canonical = tx.canonical_thread(link_id, provider_thread_id).await?;
    let Some(canonical) = canonical.filter(|id| *id != original) else {
        return Ok(original);
    };
    tx.move_message_thread(message_id, link_id, canonical)
        .await?;
    tx.move_attempt_thread(message_id, link_id, canonical)
        .await?;
    let empty = tx.original_thread_empty(original).await?;
    if empty {
        tx.redirect_thread_aliases(link_id, original, canonical)
            .await?;
        tx.redirect_original_thread(original, link_id, canonical)
            .await?;
    }
    tx.metadata(original, link_id).await?;
    tx.attachment_flags(original).await?;
    Ok(canonical)
}

/// Persist the sent identities and projections inside the completion transaction.
#[tracing::instrument(
    target = "email_service::outbound::scheduled_delivery",
    skip(tx, message),
    fields(
        message_db_id = message.db_id.unwrap().to_string(),
        link_id = message.link_id.to_string()
    ),
    err
)]
pub async fn process_sent_message(
    tx: &mut (impl MessageIdentityQueries + ThreadIdentityQueries),
    message: &mut MessageToSend,
) -> anyhow::Result<()> {
    reconcile_message(
        tx,
        message.link_id,
        message.db_id.context("sent message has no local ID")?,
        message
            .provider_id
            .as_deref()
            .context("sent message has no provider ID")?,
    )
    .await?;

    let thread_db_id = reconcile_sent_thread(
        tx,
        message.link_id,
        message.db_id.context("sent message has no local ID")?,
        message
            .provider_thread_id
            .as_deref()
            .context("sent message has no provider thread ID")?,
    )
    .await?;
    message.thread_db_id = Some(thread_db_id);
    // mark message as non-draft
    tx.mark_sent(
        &message.provider_id.clone().unwrap_or_default(),
        &message.provider_thread_id.clone().unwrap_or_default(),
        message.link_id,
        message.db_id.unwrap(),
    )
    .await?;

    // set provider id of thread - needed in case it's a thread with no other messages, as it wouldn't
    // have a provider id yet
    tx.thread_provider(
        thread_db_id,
        message.link_id,
        &message.provider_thread_id.clone().unwrap(),
    )
    .await?;

    tx.metadata(thread_db_id, message.link_id).await?;

    tx.attachment_flags(thread_db_id).await?;

    Ok(())
}

#[cfg(test)]
mod test;
