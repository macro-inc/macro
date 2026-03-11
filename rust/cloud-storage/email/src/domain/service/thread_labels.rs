use crate::domain::{
    models::{EmailErr, Link, UpdateThreadLabelsResult, label::system_labels},
    ports::{EmailMessageEnqueuer, EmailRepo, GmailLabelModifier},
};
use frecency::domain::ports::FrecencyQueryService;
use futures::{StreamExt, stream};
use uuid::Uuid;

use super::EmailServiceImpl;

impl<T, U, E, G> EmailServiceImpl<T, U, E, G>
where
    T: EmailRepo,
    U: FrecencyQueryService,
    E: EmailMessageEnqueuer,
    G: GmailLabelModifier,
    anyhow::Error: From<T::Err>,
{
    #[tracing::instrument(err, skip(self, access_token, link))]
    pub(crate) async fn update_thread_labels_impl(
        &self,
        access_token: &str,
        link: &Link,
        thread_id: Uuid,
        label_id: Uuid,
        add: bool,
    ) -> Result<UpdateThreadLabelsResult, EmailErr> {
        let label = self
            .email_repo
            .get_label_by_id(label_id, link.id)
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?
            .ok_or(EmailErr::LabelNotFound)?;

        let messages = self
            .email_repo
            .get_thread_label_messages(thread_id, link.id)
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?;

        if messages.is_empty() {
            return Err(EmailErr::ThreadEmpty);
        }

        let provider_label_id = label.provider_label_id.clone();

        if provider_label_id.is_empty() {
            return Err(EmailErr::EmptyProviderLabelId);
        }

        // Fan out Gmail API calls with limited concurrency.
        // Take a reference to the modifier outside the loop so each future
        // only borrows the modifier (not all of `self`), allowing true
        // concurrent polling via buffer_unordered.
        const MAX_CONCURRENT: usize = 10;
        let modifier = &self.gmail_label_modifier;
        let mut join_handles = Vec::with_capacity(messages.len());
        for msg in &messages {
            let db_id = msg.db_id;
            // don't modify messages without provider_ids (drafts)
            let provider_msg_id = match &msg.provider_id {
                Some(id) if !id.is_empty() => id.clone(),
                _ => {
                    continue;
                }
            };
            let plid = provider_label_id.clone();
            let token = access_token.to_owned();
            let (to_add, to_remove) = if add {
                (vec![plid], vec![])
            } else {
                (vec![], vec![plid])
            };
            join_handles.push(async move {
                let result = modifier
                    .modify_message_labels(&token, &provider_msg_id, &to_add, &to_remove)
                    .await;
                (db_id, result)
            });
        }

        let results: Vec<_> = stream::iter(join_handles)
            .buffer_unordered(MAX_CONCURRENT)
            .collect()
            .await;

        let mut successful_ids = Vec::new();
        let mut failed_ids = Vec::new();

        for (msg_id, result) in results {
            match result {
                Ok(()) => successful_ids.push(msg_id),
                Err(e) => {
                    tracing::error!(error=?e, message_id=%msg_id, "failed to modify labels in Gmail");
                    failed_ids.push(msg_id);
                }
            }
        }

        // Bulk DB update for successful messages
        if !successful_ids.is_empty() {
            let db_result = if add {
                self.email_repo
                    .insert_message_labels_batch(&successful_ids, &provider_label_id, link.id)
                    .await
            } else {
                self.email_repo
                    .delete_message_labels_batch(&successful_ids, &provider_label_id, link.id)
                    .await
            };

            if let Err(e) = db_result {
                let err = anyhow::Error::from(e);
                tracing::error!(error=?err, "failed to update message labels in database");
                failed_ids.append(&mut successful_ids);
            }
        }

        // Side effects for system labels
        if !successful_ids.is_empty() {
            if provider_label_id == system_labels::UNREAD {
                if let Err(e) = self
                    .email_repo
                    .update_message_read_status_batch(&successful_ids, link.id, !add)
                    .await
                {
                    let err = anyhow::Error::from(e);
                    tracing::error!(error=?err, "failed to update message read status");
                }
            } else if provider_label_id == system_labels::STARRED
                && let Err(e) = self
                    .email_repo
                    .update_message_starred_status_batch(&successful_ids, link.id, add)
                    .await
            {
                let err = anyhow::Error::from(e);
                tracing::error!(error=?err, "failed to update message starred status");
            }
        }

        successful_ids.sort();
        failed_ids.sort();

        Ok(UpdateThreadLabelsResult {
            successful_ids,
            failed_ids,
        })
    }
}
