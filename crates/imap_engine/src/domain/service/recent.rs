//! Best-effort recent bodies with one deferred-item retry outside admission.
use super::*;

impl Engine {
    #[tracing::instrument(skip_all, name = "imap.recent_inbox", fields(read.deferred_count = tracing::field::Empty, read.oversized_count = tracing::field::Empty), err)]
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
        for message in selected {
            match self.read_message(&account, &message.id).await {
                Ok(Some(message)) => messages.push(message),
                Ok(None) => {}
                Err(Error::AccountBusy) => pending.push(message.id.clone()),
                Err(Error::MessageTooLarge) => oversized += 1,
                Err(error) => return Err(error),
            }
        }
        drop(capacity);
        let mut deferred = 0i64;
        if !pending.is_empty() {
            // The DB snapshot was committed before MIME I/O; no global slot is
            // retained while waiting. Retry only missing bodies, never the batch.
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            for id in pending {
                match self
                    .execute_with_owner(binding, Operation::Message { id }, class, None)
                    .await
                {
                    Ok(value) => {
                        if let Some(message) = serde_json::from_value::<Option<Message>>(value)
                            .map_err(|_| Error::Invalid)?
                        {
                            messages.push(message);
                        }
                    }
                    Err(Error::AccountBusy) => deferred += 1,
                    Err(Error::MessageTooLarge) => oversized += 1,
                    Err(error) => return Err(error),
                }
            }
        }
        self.repository.validate_read(&account).await?;
        let span = tracing::Span::current();
        span.record("read.deferred_count", deferred);
        span.record("read.oversized_count", oversized);
        if messages.is_empty() && deferred > 0 {
            return Err(Error::AccountBusy);
        }
        messages.sort_by_key(|message| std::cmp::Reverse(message.received_at));
        value(messages)
    }
}
