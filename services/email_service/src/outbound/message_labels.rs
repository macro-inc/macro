//! Persistence for message-label batches, preserving their transaction boundaries.

use anyhow::Context;
use email::domain::message_labels::{
    MessageLabelDefinition, MessageLabelInbox, MessageLabelRepository, MessageLabelTarget,
    StageFailure, StagedLabelWrite,
};
use models_email::service;
use uuid::Uuid;

#[cfg(test)]
mod test;

pub struct PgMessageLabels(pub sqlx::PgPool);

#[derive(Debug, thiserror::Error)]
pub enum MessageLabelPersistenceError {
    #[error(transparent)]
    Database(#[from] anyhow::Error),
}

impl MessageLabelRepository for PgMessageLabels {
    type Err = MessageLabelPersistenceError;

    async fn inbox_for_message(
        &self,
        caller_macro_id: &str,
        message_id: Uuid,
    ) -> Result<Option<MessageLabelInbox>, Self::Err> {
        let link = email_db_client::links::get::fetch_owned_link_for_message(
            &self.0,
            caller_macro_id,
            message_id,
        )
        .await
        .inspect_err(|e| {
            tracing::error!(error=?e, "unable to resolve inbox for messages");
        })?;
        Ok(link.map(|link| MessageLabelInbox {
            id: link.id,
            macro_id: link.macro_id,
        }))
    }

    async fn label(
        &self,
        label_id: Uuid,
        link_id: Uuid,
    ) -> Result<Option<MessageLabelDefinition>, Self::Err> {
        let label = email_db_client::labels::get::fetch_label_by_id(&self.0, label_id, link_id)
            .await
            .inspect_err(|e| {
                tracing::error!(error=?e, "unable to fetch label from db");
            })?;
        Ok(label.map(|label| MessageLabelDefinition {
            id: label.id,
            provider_label_id: label.provider_label_id,
            name: label.name,
        }))
    }

    async fn messages(
        &self,
        message_ids: &[Uuid],
        caller_fusionauth_user_id: &str,
    ) -> Result<Vec<MessageLabelTarget>, Self::Err> {
        let message_ids = message_ids.to_vec();
        let messages = email_db_client::messages::get_simple_messages::get_simple_messages_batch(
            &self.0,
            &message_ids,
            caller_fusionauth_user_id,
        )
        .await
        .inspect_err(|e| {
            tracing::error!(error=?e, "unable to fetch messages from db");
        })?;
        Ok(messages
            .into_iter()
            .map(|message| MessageLabelTarget {
                db_id: message.db_id,
                thread_db_id: message.thread_db_id,
                provider_id: message.provider_id,
            })
            .collect())
    }

    async fn stage(&self, write: StagedLabelWrite) -> Result<Vec<(Uuid, String)>, StageFailure> {
        let StagedLabelWrite {
            link_id,
            thread_ids,
            messages,
            provider_label_id,
            add: is_adding,
            write_id: pending_write_id,
        } = write;
        let message_db_ids: Vec<Uuid> = messages.iter().map(|m| m.db_id).collect();
        let mut tx = self.0.begin().await.map_err(|e| {
            tracing::error!(error=?e, "unable to begin transaction");
            StageFailure::Begin
        })?;

        // The changed messages Gmail knows about; drafts have no provider_id.
        let transaction_result: anyhow::Result<Vec<(Uuid, String)>> = async {
            if message_db_ids.is_empty() {
                return Ok(Vec::new());
            }
            email_db_client::labels::pending_writes::lock_thread_label_writes(&mut tx, &thread_ids)
                .await
                .context("Failed to lock the messages' threads")?;
            let changed_ids = email_db_client::labels::get::messages_changing_label(
                &mut *tx,
                link_id,
                &message_db_ids,
                &provider_label_id,
                is_adding,
            )
            .await
            .context("Failed to read which messages change")?;
            let provider_messages: Vec<(Uuid, String)> = messages
                .iter()
                .filter(|msg| changed_ids.contains(&msg.db_id))
                .filter_map(|msg| {
                    msg.provider_id
                        .as_ref()
                        .filter(|pid| !pid.is_empty())
                        .map(|pid| (msg.db_id, pid.clone()))
                })
                .collect();
            let provider_message_ids: Vec<Uuid> =
                provider_messages.iter().map(|(id, _)| *id).collect();
            email_db_client::labels::pending_writes::mark_pending_label_writes(
                &mut *tx,
                link_id,
                &provider_message_ids,
                &provider_label_id,
                is_adding,
                pending_write_id,
            )
            .await
            .context("Failed to mark pending label writes")?;

            if is_adding {
                email_db_client::labels::insert::insert_message_labels_batch(
                    &mut *tx,
                    &message_db_ids,
                    &provider_label_id,
                    link_id,
                )
                .await
                .context("Failed to add label to messages in database")?;
            } else {
                email_db_client::labels::delete::delete_message_labels_batch(
                    &mut *tx,
                    &message_db_ids,
                    &provider_label_id,
                    link_id,
                )
                .await
                .context("Failed to remove label from messages in database")?;
            }

            if provider_label_id.as_str() == service::label::system_labels::UNREAD {
                email_db_client::messages::update::update_message_read_status_batch(
                    &mut *tx,
                    message_db_ids.clone(),
                    link_id,
                    !is_adding,
                )
                .await
                .context("Failed to update message read status")?;
            } else if provider_label_id.as_str() == service::label::system_labels::STARRED {
                email_db_client::messages::update::update_message_starred_status_batch(
                    &mut *tx,
                    message_db_ids.clone(),
                    link_id,
                    is_adding,
                )
                .await
                .context("Failed to update message starred status")?;
            }

            for thread_id in &thread_ids {
                email_db_client::threads::update::update_thread_metadata(
                    &mut tx, *thread_id, link_id,
                )
                .await
                .context("Failed to update thread state")?;
            }

            Ok(provider_messages)
        }
        .await;

        match transaction_result {
            Ok(provider_messages) => {
                tx.commit().await.map_err(|e| {
                    tracing::error!(error=?e, "unable to commit transaction");
                    StageFailure::Commit
                })?;
                Ok(provider_messages)
            }
            Err(e) => {
                tracing::error!(error=?e, "Transaction failed, rolling back");
                if let Err(rollback_err) = tx.rollback().await {
                    tracing::error!(error=?rollback_err, "Failed to rollback transaction");
                }
                Err(StageFailure::Change)
            }
        }
    }

    async fn revert_unsent(
        &self,
        link_id: Uuid,
        thread_ids: &[Uuid],
        message_ids: &[Uuid],
        write_id: Uuid,
    ) -> Result<Vec<Uuid>, Self::Err> {
        self.revert_unsent_write(link_id, thread_ids, message_ids, write_id)
            .await
            .inspect_err(|e| {
                tracing::error!(error=?e, "Failed to revert label write after enqueue failure");
            })
            .map_err(Into::into)
    }
}

impl PgMessageLabels {
    /// Restore an unqueued write while holding the same thread label-write locks.
    async fn revert_unsent_write(
        &self,
        link_id: Uuid,
        thread_ids: &[Uuid],
        message_ids: &[Uuid],
        write_id: Uuid,
    ) -> anyhow::Result<Vec<Uuid>> {
        let mut tx = self.0.begin().await?;
        email_db_client::labels::pending_writes::lock_thread_label_writes(&mut tx, thread_ids)
            .await?;
        let restored = email_db_client::labels::pending_writes::abandon_pending_label_writes(
            &mut tx,
            link_id,
            message_ids,
            write_id,
        )
        .await?;
        for thread_id in thread_ids {
            email_db_client::threads::update::update_thread_metadata(&mut tx, *thread_id, link_id)
                .await?;
        }
        tx.commit().await?;
        Ok(restored)
    }
}
