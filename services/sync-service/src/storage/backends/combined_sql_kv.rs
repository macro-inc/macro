use worker::Env;

use crate::storage::snapshot::SnapshotStorage;

use super::{durable_sql::DurableSQLStorage, kv::Kv};

pub struct Storage {
    sql: DurableSQLStorage,
    kv: Kv,
}

impl Storage {
    pub fn new(env: &Env, storage: worker::Storage, document_id: String) -> worker::Result<Self> {
        Ok(Self {
            sql: DurableSQLStorage::new(storage, document_id.clone())?,
            kv: Kv::from_env(env, document_id)?,
        })
    }
}

impl SnapshotStorage for Storage {
    async fn store_snapshot(&self, snapshot: &[u8]) -> worker::Result<()> {
        self.sql.store_snapshot(snapshot).await
    }

    async fn get_snapshot(&self) -> worker::Result<Vec<u8>> {
        if self.sql.has_snapshot().await? {
            self.sql.get_snapshot().await
        } else {
            self.kv.get_snapshot().await
        }
    }

    async fn has_snapshot(&self) -> worker::Result<bool> {
        Ok(self.sql.has_snapshot().await? || self.kv.has_snapshot().await?)
    }
}
