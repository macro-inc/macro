//! Best-effort recent bodies with one deferred-item retry outside admission.
use super::*;

// A recent page can retain the base64 equivalent of one maximum-size MIME.
// Leave the per-message protocol limit in place for underestimated sizes.
const RECENT_MIME_BYTES: usize = (MAX_MESSAGE_SOURCE_BYTES as usize).div_ceil(3) * 4;

impl Engine {
    #[tracing::instrument(skip_all, name = "imap.recent_inbox", fields(read.deferred_count = tracing::field::Empty, read.oversized_count = tracing::field::Empty, read.budget_omitted_count = tracing::field::Empty, read.unreadable_count = tracing::field::Empty), err)]
    pub(super) async fn recent_inbox(
        &self,
        binding: Binding,
        limit: u32,
        class: OperationClass,
    ) -> Result<Value, Error> {
        let limit = limit.min(100);
        let capacity = self
            .admit_capacity(
                &Operation::RecentInbox { limit },
                class,
                tokio::time::Instant::now() + SUBMISSION_PRE_BODY_BUDGET,
            )
            .await?;
        let account = self
            .repository
            .read_scoped(binding, StateSelection::Recent(limit))
            .await?;
        if let Some(error) = account.state.credential_issue() {
            return Err(error);
        }
        let mut selected = account
            .state
            .messages
            .values()
            .filter(|message| {
                account
                    .state
                    .folders
                    .get(&message.folder_id)
                    .is_some_and(|folder| folder.folder.role == FolderRole::Inbox)
            })
            .collect::<Vec<_>>();
        selected.sort_by_key(|message| std::cmp::Reverse(message.received_at));
        selected.truncate(usize::try_from(limit).map_err(|_| Error::Invalid)?);
        let mut messages = Vec::new();
        let mut pending = Vec::new();
        let mut oversized = 0i64;
        let mut budget_omitted = 0i64;
        let mut unavailable = 0i64;
        let mut missing = 0i64;
        let mut remaining = RECENT_MIME_BYTES;
        for message in selected {
            if !message.source_complete && message.size > MAX_MESSAGE_SOURCE_BYTES {
                oversized += 1;
                continue;
            }
            let estimated = if message.source_complete {
                message.mime_base64.len()
            } else {
                (message.size as usize).div_ceil(3) * 4
            };
            if estimated > remaining {
                budget_omitted += 1;
                continue;
            }
            match self.read_message(&account, &message.id).await {
                Ok(Some(message)) if message.mime_base64.len() <= remaining => {
                    remaining -= message.mime_base64.len();
                    messages.push(message);
                }
                Ok(Some(_)) => budget_omitted += 1,
                Ok(None) => {}
                Err(Error::AccountBusy) => pending.push((message.id.clone(), estimated)),
                Err(Error::MessageTooLarge) => oversized += 1,
                Err(Error::ConnectionUnavailable) => unavailable += 1,
                Err(Error::NotFound) => missing += 1,
                Err(error) => return Err(error),
            }
        }
        drop(capacity);
        let mut deferred = 0i64;
        if !pending.is_empty() {
            // The DB snapshot was committed before MIME I/O; no global slot is
            // retained while waiting. Retry only missing bodies, never the batch.
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            for (id, estimated) in pending {
                if estimated > remaining {
                    budget_omitted += 1;
                    continue;
                }
                match self
                    .execute_with_owner(binding, Operation::Message { id }, class, None)
                    .await
                {
                    Ok(value) => {
                        if let Some(message) = serde_json::from_value::<Option<Message>>(value)
                            .map_err(|_| Error::Invalid)?
                        {
                            if message.mime_base64.len() <= remaining {
                                remaining -= message.mime_base64.len();
                                messages.push(message);
                            } else {
                                budget_omitted += 1;
                            }
                        }
                    }
                    Err(Error::AccountBusy) => deferred += 1,
                    Err(Error::MessageTooLarge) => oversized += 1,
                    Err(Error::ConnectionUnavailable) => unavailable += 1,
                    Err(Error::NotFound) => missing += 1,
                    Err(error) => return Err(error),
                }
            }
        }
        self.repository.validate_read(&account).await?;
        let span = tracing::Span::current();
        span.record("read.deferred_count", deferred);
        span.record("read.oversized_count", oversized);
        span.record("read.budget_omitted_count", budget_omitted);
        span.record("read.unreadable_count", unavailable + missing);
        if messages.is_empty() && deferred > 0 {
            return Err(Error::AccountBusy);
        }
        if messages.is_empty() && unavailable > 0 {
            return Err(Error::ConnectionUnavailable);
        }
        messages.sort_by_key(|message| std::cmp::Reverse(message.received_at));
        value(messages)
    }
}
