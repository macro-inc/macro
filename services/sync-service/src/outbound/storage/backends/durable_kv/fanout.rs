//! Physical log and cached-state ports for causal fan-out use cases.
use super::*;
use crate::domain::fanout::{self, AppendPort, Imported, PendingOperations, StatePort};

impl From<fanout::Failure> for worker::Error {
    fn from(error: fanout::Failure) -> Self {
        match error {
            fanout::Failure::Invalid(error) => {
                tracing::error!(err = ?error, "invalid fanout vectors");
                worker::Error::from(format!("invalid fanout vectors : {error:?}"))
            }
            fanout::Failure::MissingBase => worker::Error::from("fanout base missing"),
        }
    }
}

impl StatePort for DurableKVStorage {
    fn with_pending<T>(&self, apply: impl FnOnce(&mut PendingOperations) -> T) -> T {
        apply(
            &mut self
                .pending
                .write()
                .unwrap_context("pending operations lock"),
        )
    }
}

pub(super) struct Append<'a> {
    pub storage: &'a DurableKVStorage,
    pub document: &'a DocumentState,
    pub attribution: Option<&'a crate::domain::document::DocumentAttribution>,
}
impl StatePort for Append<'_> {
    fn with_pending<T>(&self, apply: impl FnOnce(&mut PendingOperations) -> T) -> T {
        self.storage.with_pending(apply)
    }
}
impl AppendPort for Append<'_> {
    type Error = worker::Error;
    type Imported = ImportedUpdate;

    fn next_key(&self) -> String {
        pending_op_key(&self.storage.ids.id())
    }
    fn import(&self, update: &[u8]) -> Result<Imported<ImportedUpdate>> {
        let before = self.document.loro_doc.oplog_vv();
        let value = self.document.import(update)?;
        let required = LoroDoc::decode_import_blob_meta(update, false)
            .context("failed to read operation metadata")?
            .partial_end_vv;
        Ok(Imported {
            before,
            known: self.document.loro_doc.oplog_vv(),
            required,
            value,
        })
    }
    async fn store_debt(&self, debt: &FanoutDebt) -> Result<()> {
        self.storage.persist_fanout_debt(Some(debt)).await
    }
    async fn store_pending(&self, key: &str, update: &[u8]) -> Result<()> {
        self.storage.inner.put(key, update).await
    }
    async fn store_archive(&self, key: &str, update: &[u8]) -> Result<()> {
        let id = key
            .strip_prefix(PENDING_OP_PREFIX)
            .context("invalid pending key")?;
        self.storage.inner.put(&all_op_key(id), update).await?;
        if let Some(attribution) = self.attribution {
            let metadata = serde_json::to_vec(attribution)
                .context("failed to serialize signed document attribution")?;
            self.storage
                .inner
                .put(&format!("actor/{id}"), metadata)
                .await?;
        }
        Ok(())
    }
}
impl DurableKVStorage {
    pub(crate) async fn persist_fanout_debt(&self, debt: Option<&FanoutDebt>) -> Result<()> {
        if let Some(debt) = debt {
            self.inner
                .put(
                    FANOUT_DEBT_KEY,
                    serde_json::to_vec(debt).context("failed to encode fanout debt")?,
                )
                .await?;
        } else {
            // Interrupted migration must retain the outside-prefix marker.
            self.inner.delete(LEGACY_FANOUT_DEBT_KEY).await?;
            self.inner.delete(FANOUT_DEBT_KEY).await?;
        }
        Ok(())
    }
}
