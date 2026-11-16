//! PostgreSQL transaction mechanics for the domain's incremental link purge.

use super::PgMailboxSync;
use crate::domain::mailbox::link_manager::purge::{
    LinkPurgeRepository, LinkPurgeTransaction, PurgeContact, PurgeMessage,
};
use email_db_client::links::delete;
use sqlx::{Postgres, Transaction};
use std::num::NonZeroU32;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// One transaction holding the original advisory purge lock until commit or drop.
pub struct PgLinkPurgeTransaction(Transaction<'static, Postgres>);

impl LinkPurgeRepository for PgMailboxSync {
    type Transaction = PgLinkPurgeTransaction;
    async fn mark_link_deleting(&self, link_id: Uuid) -> anyhow::Result<()> {
        delete::mark_link_deleting(&self.db, link_id).await
    }
    async fn begin_batch(&self, link_id: Uuid) -> anyhow::Result<Self::Transaction> {
        delete::begin_purge_batch(&self.db, link_id)
            .await
            .map(PgLinkPurgeTransaction)
    }
}

impl LinkPurgeTransaction for PgLinkPurgeTransaction {
    async fn messages(
        &mut self,
        link_id: Uuid,
        thread_cursor: Uuid,
        limit: NonZeroU32,
    ) -> anyhow::Result<Vec<PurgeMessage>> {
        Ok(
            delete::select_purge_messages(&mut self.0, link_id, thread_cursor, limit)
                .await?
                .into_iter()
                .map(|row| PurgeMessage {
                    id: row.id,
                    thread_id: row.thread_id,
                })
                .collect(),
        )
    }
    async fn delete_message_labels(&mut self, ids: &[Uuid]) -> anyhow::Result<()> {
        delete::delete_message_labels(&mut self.0, ids)
            .await
            .map(|_| ())
    }
    async fn delete_message_recipients(&mut self, ids: &[Uuid]) -> anyhow::Result<()> {
        delete::delete_message_recipients(&mut self.0, ids)
            .await
            .map(|_| ())
    }
    async fn detach_message_files(&mut self, ids: &[Uuid]) -> anyhow::Result<()> {
        delete::detach_message_files(&mut self.0, ids)
            .await
            .map(|_| ())
    }
    async fn delete_message_attachments(&mut self, ids: &[Uuid]) -> anyhow::Result<()> {
        delete::delete_message_attachments(&mut self.0, ids)
            .await
            .map(|_| ())
    }
    async fn delete_scheduled_messages(&mut self, ids: &[Uuid]) -> anyhow::Result<()> {
        delete::delete_scheduled_messages(&mut self.0, ids)
            .await
            .map(|_| ())
    }
    async fn delete_message_rows(&mut self, ids: &[Uuid]) -> anyhow::Result<u64> {
        delete::delete_message_rows(&mut self.0, ids).await
    }
    async fn delete_thread_history(&mut self, link_id: Uuid, ids: &[Uuid]) -> anyhow::Result<()> {
        delete::delete_thread_history(&mut self.0, link_id, ids)
            .await
            .map(|_| ())
    }
    async fn delete_thread_rows(&mut self, link_id: Uuid, ids: &[Uuid]) -> anyhow::Result<u64> {
        delete::delete_thread_rows(&mut self.0, link_id, ids).await
    }
    async fn threads(&mut self, link_id: Uuid, limit: NonZeroU32) -> anyhow::Result<Vec<Uuid>> {
        delete::select_purge_threads(&mut self.0, link_id, limit).await
    }
    async fn contacts(
        &mut self,
        link_id: Uuid,
        email_cursor: &str,
        limit: NonZeroU32,
    ) -> anyhow::Result<Vec<PurgeContact>> {
        Ok(
            delete::select_purge_contacts(&mut self.0, link_id, email_cursor, limit)
                .await?
                .into_iter()
                .map(|row| PurgeContact {
                    id: row.id,
                    email_address: row.email_address,
                })
                .collect(),
        )
    }
    async fn delete_contact_rows(&mut self, ids: &[Uuid]) -> anyhow::Result<u64> {
        delete::delete_contact_rows(&mut self.0, ids).await
    }
    async fn delete_marked_link(&mut self, link_id: Uuid) -> anyhow::Result<u64> {
        delete::delete_marked_link(&mut self.0, link_id).await
    }
    async fn commit(self) -> anyhow::Result<()> {
        self.0.commit().await?;
        Ok(())
    }
}
