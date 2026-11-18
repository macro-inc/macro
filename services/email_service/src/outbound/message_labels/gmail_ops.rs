//! Existing worker persistence, Gmail admission, and retry publication behind domain ports.
use crate::outbound::email_api::GmailApi;
use crate::outbound::persistence_error::InboxPersistenceError;
use anyhow::Context;
use email::domain::message_labels::gmail_ops::{
    GmailLabelWrites, GmailMailboxOperations, GmailOpsLinks, GmailOpsRetryQueue, LabelWriteRevert,
    LabelWriteTurn, RevertedMessageFlag,
};
use email::domain::message_labels::state as label_state;
use email::outbound::label_state_pg::{PgLabelCatalog, PgLabelState};
use email_api_client::domain::models::EmailApiError;
use email_db_client::labels::pending_writes;
use models_email::gmail::gmail_ops::GmailOpsPubsubMessage;
use models_email::service::link::Link;
use sqlx::{PgPool, Postgres, Transaction};
use std::collections::HashMap;
use uuid::Uuid;

#[cfg(test)]
mod test;

#[derive(Clone)]
pub struct PgGmailOps(pub PgPool);

impl GmailOpsLinks for PgGmailOps {
    type Err = InboxPersistenceError;

    async fn link(&self, id: Uuid) -> Result<Option<Link>, Self::Err> {
        email_db_client::links::get::fetch_link_by_id(&self.0, id)
            .await
            .map_err(Into::into)
    }
}

impl GmailLabelWrites for PgGmailOps {
    type Err = InboxPersistenceError;

    async fn turns(
        &self,
        message_ids: &[Uuid],
        labels: &[String],
        write_id: Uuid,
    ) -> Result<HashMap<Uuid, LabelWriteTurn>, Self::Err> {
        let turns = label_state::label_write_turns(
            &mut PgLabelCatalog(&self.0),
            message_ids,
            labels,
            write_id,
        )
        .await
        .map_err(anyhow::Error::from)?;
        Ok(turns)
    }

    async fn abandon(&self, link: Uuid, messages: &[Uuid], write: Uuid) -> Result<(), Self::Err> {
        async {
            let mut tx = begin_locked(&self.0, link, messages).await?;
            label_state::abandon_pending_label_writes(
                &mut PgLabelState(&mut tx),
                link,
                messages,
                write,
            )
            .await
            .context("Failed to drop superseded pending label writes")?;
            commit(tx).await
        }
        .await
        .map_err(Into::into)
    }

    async fn confirm(&self, link: Uuid, messages: &[Uuid], write: Uuid) -> Result<(), Self::Err> {
        async {
            let mut tx = begin_locked(&self.0, link, messages).await?;
            label_state::confirm_pending_label_writes(&mut PgLabelState(&mut tx), messages, write)
                .await
                .context("Failed to confirm pending label writes")?;
            commit(tx).await
        }
        .await
        .map_err(Into::into)
    }

    async fn revert(
        &self,
        link: Uuid,
        messages: Vec<Uuid>,
        change: LabelWriteRevert,
    ) -> Result<Vec<Uuid>, Self::Err> {
        revert_write(&self.0, link, messages, change)
            .await
            .map_err(Into::into)
    }
}

/// Starts the same settlement transaction and takes the same thread locks in order.
async fn begin_locked<'c>(
    db: &'c PgPool,
    link_id: Uuid,
    message_ids: &[Uuid],
) -> anyhow::Result<Transaction<'c, Postgres>> {
    async {
        let mut tx = db.begin().await?;
        let thread_ids =
            email_db_client::messages::get::thread_ids_of_messages(&mut *tx, link_id, message_ids)
                .await?;
        pending_writes::lock_thread_label_writes(&mut tx, &thread_ids).await?;
        Ok(tx)
    }
    .await
    .map_err(|e: sqlx::Error| anyhow::Error::from(e).context("Failed to lock label writes"))
}

async fn commit(tx: Transaction<'_, Postgres>) -> anyhow::Result<()> {
    tx.commit()
        .await
        .context("Failed to commit label write changes")
}

/// Executes the domain's reversion instruction in the original transaction scope.
async fn revert_write(
    db: &PgPool,
    link: Uuid,
    sent_ids: Vec<Uuid>,
    change: LabelWriteRevert,
) -> anyhow::Result<Vec<Uuid>> {
    let mut tx = db
        .begin()
        .await
        .context("Failed to begin transaction for reversion")?;
    let thread_ids =
        email_db_client::messages::get::thread_ids_of_messages(&mut *tx, link, &sent_ids)
            .await
            .context("Failed to read the threads of the reverted messages")?;
    pending_writes::lock_thread_label_writes(&mut tx, &thread_ids)
        .await
        .context("Failed to lock the threads of the reverted messages")?;
    let reverted_ids = match change {
        LabelWriteRevert::Pending(write_id) => label_state::abandon_pending_label_writes(
            &mut PgLabelState(&mut tx),
            link,
            &sent_ids,
            write_id,
        )
        .await
        .context("Failed to abandon pending label writes")?,
        legacy => {
            invert_label_change(&mut tx, link, legacy, &sent_ids).await?;
            sent_ids
        }
    };
    for thread_id in thread_ids {
        email_db_client::threads::update::update_thread_metadata(&mut tx, thread_id, link)
            .await
            .context("Failed to recompute thread state after revert")?;
    }
    tx.commit()
        .await
        .context("Unable to commit transaction for revert")?;
    Ok(reverted_ids)
}

async fn invert_label_change(
    tx: &mut sqlx::PgConnection,
    link: Uuid,
    change: LabelWriteRevert,
    message_ids: &[Uuid],
) -> anyhow::Result<()> {
    let LabelWriteRevert::Legacy {
        provider_label_id,
        was_adding,
        flag,
    } = change
    else {
        // The domain selected the original empty-label no-op; keep its event
        // inside the transaction, before thread metadata is recomputed.
        tracing::error!("No label IDs in payload, cannot revert");
        return Ok(());
    };
    let message_ids = message_ids.to_vec();
    if was_adding {
        label_state::delete_message_labels_batch(
            &mut PgLabelState(tx),
            &message_ids,
            &provider_label_id,
            link,
        )
        .await
        .context("Failed to revert adding labels")?;
    } else {
        label_state::insert_message_labels_batch(
            &mut PgLabelState(tx),
            &message_ids,
            &provider_label_id,
            link,
        )
        .await
        .context("Failed to revert removing labels")?;
    }
    match flag {
        RevertedMessageFlag::Read(is_read) => {
            label_state::update_message_read_status_batch(
                &mut PgLabelState(tx),
                message_ids,
                link,
                is_read,
            )
            .await
            .context("Failed to revert message read status")?;
        }
        RevertedMessageFlag::Starred(is_starred) => {
            label_state::update_message_starred_status_batch(
                &mut PgLabelState(tx),
                message_ids,
                link,
                is_starred,
            )
            .await
            .context("Failed to revert message starred status")?;
        }
        RevertedMessageFlag::None => {}
    }
    Ok(())
}

#[derive(Clone)]
pub struct GmailOpsProvider(pub GmailApi);

impl From<GmailApi> for GmailOpsProvider {
    fn from(api: GmailApi) -> Self {
        Self(api)
    }
}

impl GmailMailboxOperations for GmailOpsProvider {
    async fn modify_message_labels(
        &self,
        link: Uuid,
        messages: &[String],
        add: &[String],
        remove: &[String],
    ) -> Result<(), EmailApiError> {
        self.0
            .modify_message_labels(link, messages, add, remove)
            .await
    }

    async fn modify_one_message_labels(
        &self,
        link: Uuid,
        message: &str,
        add: &[String],
        remove: &[String],
        skip_missing: bool,
    ) -> Result<(), EmailApiError> {
        self.0
            .modify_one_message_labels(link, message, add, remove, skip_missing)
            .await
    }

    async fn delete_label(&self, link: Uuid, label: &str) -> Result<(), EmailApiError> {
        self.0.delete_label(link, label).await
    }

    async fn block_sender(&self, link: Uuid, address: &str) -> Result<(), EmailApiError> {
        self.0.block_sender(link, address).await
    }

    async fn unblock_sender(&self, link: Uuid, address: &str) -> Result<(), EmailApiError> {
        self.0.unblock_sender(link, address).await
    }
}

#[derive(Clone)]
pub struct GmailOpsQueue(pub sqs_client::SQS);

impl GmailOpsRetryQueue for GmailOpsQueue {
    type Err = InboxPersistenceError;

    async fn enqueue(&self, message: GmailOpsPubsubMessage) -> Result<(), Self::Err> {
        self.0
            .enqueue_gmail_ops_retry_notification(message)
            .await
            .map_err(Into::into)
    }
}
