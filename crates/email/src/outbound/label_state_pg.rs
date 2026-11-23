//! PostgreSQL capabilities used by the label-state domain rules.

#[cfg(feature = "mailbox")]
use crate::domain::message_labels::state::LabelCatalogQueries;
use crate::domain::message_labels::state::{
    LabelRestore, LabelWriteFacts, MessageLabelQueries, PendingLabelConfirm, PendingLabelMark,
    PendingLabelQueries, PendingLabelRestore,
};
use email_db_client::{
    labels::{delete, insert, pending_writes},
    messages::update,
};
#[cfg(feature = "mailbox")]
use models_email::service::label::Label;
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Statements on the caller's existing transaction.
pub struct PgLabelState<'a>(pub &'a mut PgConnection);

/// Catalog statements and pending-write reads/inserts through the caller's pool.
pub struct PgLabelCatalog<'a>(pub &'a PgPool);

impl PendingLabelQueries for PgLabelCatalog<'_> {
    type Err = sqlx::Error;
    async fn facts(
        &mut self,
        messages: &[Uuid],
        labels: &[String],
        write: Uuid,
    ) -> Result<Vec<LabelWriteFacts>, Self::Err> {
        Ok(
            pending_writes::label_write_facts(self.0, messages, labels, write)
                .await?
                .into_iter()
                .map(|r| LabelWriteFacts {
                    message_id: r.message_id,
                    claimed: r.claimed,
                    has_newer: r.has_newer,
                    waits: r.waits,
                })
                .collect(),
        )
    }
}

impl PendingLabelRestore for PgLabelState<'_> {
    type Err = sqlx::Error;
    async fn remove(
        &mut self,
        messages: &[Uuid],
        write: Uuid,
    ) -> Result<Vec<LabelRestore>, Self::Err> {
        Ok(
            pending_writes::remove_pending_label_write(self.0, messages, write)
                .await?
                .into_iter()
                .map(|r| LabelRestore {
                    message_id: r.message_id,
                    provider_label_id: r.provider_label_id,
                    label_present: r.label_present,
                })
                .collect(),
        )
    }
    async fn restore_present(
        &mut self,
        link: Uuid,
        messages: &[Uuid],
        labels: &[String],
    ) -> Result<(), Self::Err> {
        pending_writes::restore_present_labels(self.0, link, messages, labels).await
    }
    async fn restore_absent(
        &mut self,
        link: Uuid,
        messages: &[Uuid],
        labels: &[String],
    ) -> Result<(), Self::Err> {
        pending_writes::restore_absent_labels(self.0, link, messages, labels).await
    }
    async fn refresh_flags(&mut self, messages: &[Uuid]) -> Result<(), Self::Err> {
        pending_writes::refresh_restored_flags(self.0, messages).await
    }
}

impl PendingLabelMark for PgLabelState<'_> {
    type Err = sqlx::Error;
    async fn mark(
        &mut self,
        link: Uuid,
        messages: &[Uuid],
        label: &str,
        present: bool,
        write: Uuid,
    ) -> Result<(), Self::Err> {
        pending_writes::mark_pending_label_writes(
            &mut *self.0,
            link,
            messages,
            label,
            present,
            write,
        )
        .await
    }
}

impl PendingLabelMark for PgLabelCatalog<'_> {
    type Err = sqlx::Error;
    async fn mark(
        &mut self,
        link: Uuid,
        messages: &[Uuid],
        label: &str,
        present: bool,
        write: Uuid,
    ) -> Result<(), Self::Err> {
        pending_writes::mark_pending_label_writes(self.0, link, messages, label, present, write)
            .await
    }
}

impl PendingLabelConfirm for PgLabelState<'_> {
    type Err = sqlx::Error;
    async fn confirm(&mut self, messages: &[Uuid], write: Uuid) -> Result<(), Self::Err> {
        pending_writes::confirm_pending_label_writes(self.0, messages, write).await
    }
}

impl MessageLabelQueries for PgLabelState<'_> {
    async fn insert(
        &mut self,
        messages: &[Uuid],
        label: &str,
        link: Uuid,
    ) -> anyhow::Result<usize> {
        insert::insert_message_labels_batch(&mut *self.0, &messages.to_vec(), label, link).await
    }
    async fn delete(
        &mut self,
        messages: &[Uuid],
        label: &str,
        link: Uuid,
    ) -> anyhow::Result<usize> {
        delete::delete_message_labels_batch(&mut *self.0, &messages.to_vec(), label, link).await
    }
    async fn delete_labels(
        &mut self,
        message: Uuid,
        labels: &[String],
        link: Uuid,
    ) -> anyhow::Result<()> {
        delete::delete_db_message_labels(self.0, message, labels, link).await
    }
    async fn read(
        &mut self,
        message: Uuid,
        link: Uuid,
        read: bool,
    ) -> anyhow::Result<Option<Uuid>> {
        update::update_message_read_status(self.0, message, link, read).await
    }
    async fn read_batch(
        &mut self,
        messages: Vec<Uuid>,
        link: Uuid,
        read: bool,
    ) -> anyhow::Result<usize> {
        update::update_message_read_status_batch(&mut *self.0, messages, link, read).await
    }
    async fn starred_batch(
        &mut self,
        messages: Vec<Uuid>,
        link: Uuid,
        starred: bool,
    ) -> anyhow::Result<usize> {
        update::update_message_starred_status_batch(&mut *self.0, messages, link, starred).await
    }
}

#[cfg(feature = "mailbox")]
impl LabelCatalogQueries for PgLabelCatalog<'_> {
    async fn upsert(&mut self, labels: Vec<Label>) -> anyhow::Result<()> {
        insert::insert_or_update_labels(self.0, labels).await
    }
    async fn delete_relations(&mut self, link: Uuid, labels: Vec<String>) -> anyhow::Result<u64> {
        delete::delete_label_relations_by_provider_ids(self.0, link, labels).await
    }
    async fn delete_labels(&mut self, link: Uuid, labels: Vec<String>) -> anyhow::Result<u64> {
        delete::delete_labels_by_provider_ids(self.0, link, labels).await
    }
}
