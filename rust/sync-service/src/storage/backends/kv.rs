use tracing::trace;
use worker::{
    Env, Error,
    kv::{KvError, KvStore},
};

use crate::{error::ResultExt, storage::snapshot::SnapshotStorage, timeit};

pub const SNAPSHOT_STORE_KV_BINDING: &str = "SNAPSHOT_STORE_KV";

pub struct Kv {
    document_id: String,
    inner: KvStore,
}
impl Kv {
    pub fn from_env(env: &Env, document_id: String) -> worker::Result<Self> {
        let ss_kv = env
            .kv(SNAPSHOT_STORE_KV_BINDING)
            .context("Colud not get env SNAPSHOT_STORE_KV_BINDING")?;
        Ok(Self::new(ss_kv, document_id))
    }
    pub fn new(inner: KvStore, document_id: String) -> Self {
        Self { inner, document_id }
    }
    pub async fn get(&self, name: &str) -> Result<Option<Vec<u8>>, KvError> {
        self.inner.get(name).bytes().await
    }
    pub async fn put(&self, name: &str, value: &[u8]) -> Result<(), KvError> {
        self.inner.put_bytes(name, value)?.execute().await
    }
}

impl SnapshotStorage for Kv {
    async fn store_snapshot(&self, snapshot: &[u8]) -> worker::Result<()> {
        let key = format!("{}/{}.snapshot", self.document_id, self.document_id);
        crate::timeout_ez!(self.put(&key, snapshot))
            .with_context(|| format!("failed to store snapshot: {key}"))
    }

    async fn get_snapshot(&self) -> worker::Result<Vec<u8>> {
        let key = format!("{}/{}.snapshot", self.document_id, self.document_id);
        let (Some(snapshot), elapsed) = timeit!(
            crate::timeout_ez!(self.get(&key))
                .with_context(|| format!("Couldn't get snapshot with key: [{key}]"))?
        ) else {
            return Err(Error::from(format!(
                "worker kv: no snapshot with key: [{key}]"
            )));
        };
        trace!(
            duration_ms = elapsed.as_millis(),
            document_id = self.document_id,
            snapshot_size = snapshot.len(),
            "kv::get_snapshot"
        );
        Ok(snapshot)
    }

    #[tracing::instrument(skip_all, ret)]
    async fn has_snapshot(&self) -> worker::Result<bool> {
        Ok(!crate::timeout_ez!(
            self.inner
                .list()
                .prefix(self.document_id.clone())
                .limit(1)
                .execute()
        )
        .with_context(|| {
            format!(
                "failed check if snapshot exists. document_id: {}",
                self.document_id
            )
        })?
        .keys
        .is_empty())
    }
}
