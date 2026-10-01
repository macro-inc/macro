use crate::domain::crdt::{decode_revision, encode_revision};
use automerge::ChangeHash;
use std::{
    collections::BTreeSet,
    sync::{
        RwLock,
        atomic::{AtomicUsize, Ordering},
    },
};
use tracing::{error, trace, warn};
use web_time::SystemTime;
use worker::{
    ListOptions, Result, Storage,
    js_sys::{self, Reflect},
    wasm_bindgen::JsCast,
};

use crate::{
    error::ResultExt,
    state::{DocumentState, ImportedUpdate},
};

/// When saving snapshot, we also write the version vector to durable object KV
/// When we read a snapshot from Worker KV, we check it's version vector is >= version vector in LAST_VERSION_VECTOR.
const LAST_VERSION_VECTOR_KEY: &str = "LAST_VERSION_VECTOR";

pub struct DurableKVStorage {
    inner: Storage,
    ids: OrederedIds,
    applied_keys: RwLock<BTreeSet<String>>,
}

/// For a given op, if it has been applied but the snapshot has not be saved, it is considered
/// 'pending'
const PENDING_OP_PREFIX: &str = "o/";
/// This prefix has a record of all ops. We keep all ops because we have been losing data.
/// NB: This does not contain all historical ops, just ops since we started tracking. So it can't
/// be used to recreate all documents.
const ALL_OP_PREFIX: &str = "a/";

fn pending_op_key(id: &str) -> String {
    format!("{PENDING_OP_PREFIX}{id}")
}
fn all_op_key(id: &str) -> String {
    format!("{ALL_OP_PREFIX}{id}")
}

fn do_kv_result_to_result_opt<T>(res: Result<Option<T>>) -> Result<Option<T>> {
    res
}

impl DurableKVStorage {
    pub fn new(inner: Storage) -> Self {
        Self {
            inner,
            ids: OrederedIds::default(),
            applied_keys: Default::default(),
        }
    }

    pub(in crate::storage) async fn get_key(&self, key: &str) -> Result<Option<Vec<u8>>> {
        do_kv_result_to_result_opt(self.inner.get(key).await)
    }

    pub(in crate::storage) async fn list_do_kv(
        &self,
        prefix: &str,
    ) -> Result<Vec<Result<(String, Vec<u8>)>>> {
        Ok(self
            .inner
            .list_with_options(ListOptions::new().prefix(prefix))
            .await?
            .entries()
            .into_iter()
            .map(|res| {
                let entry = res.context("Error getting entry")?;
                let key: String = Reflect::get_u32(&entry, 0)
                    .context("failed to get key")?
                    .as_string()
                    .context("Key is not a string")?;

                let value = Reflect::get_u32(&entry, 1).context("failed to get value")?;

                let bytes = if value.is_instance_of::<js_sys::Uint8Array>() {
                    js_sys::Uint8Array::unchecked_from_js_ref(&value).to_vec()
                } else {
                    js_sys::Uint8Array::new(&value).to_vec()
                };

                Ok((key, bytes))
            })
            .collect())
    }

    /// get pending operations from the operation log
    pub(crate) async fn get_pending_operations(&self) -> Result<Vec<Result<(String, Vec<u8>)>>> {
        self.list_do_kv(PENDING_OP_PREFIX).await
    }

    /// Attribution is supplied only by the verified JWT boundary, never CRDT
    /// peer IDs or request-body fields. Metadata shares the operation-log ID.
    pub async fn apply_op_with_attribution(
        &self,
        document_state: &DocumentState,
        op_update: &[u8],
        attribution: Option<&crate::domain::document::DocumentAttribution>,
    ) -> Result<ImportedUpdate> {
        let imported = document_state.import(op_update)?;
        self.persist_operation(op_update, attribution).await?;
        Ok(imported)
    }

    pub async fn apply_ops(
        &self,
        document_state: &DocumentState,
        updates: &[&[u8]],
    ) -> Result<ImportedUpdate> {
        // Durable Object put_multiple is atomic and accepts at most 128 keys.
        // Reserve one pending and one audit entry per delta.
        if updates.len() > 64 {
            return Err(worker::Error::from("too many updates in one batch"));
        }
        let imported = document_state.import_batch(updates)?;
        let values = js_sys::Object::new();
        let mut pending_keys = Vec::new();
        for update in updates {
            let id = self.ids.id();
            let key = pending_op_key(&id);
            let bytes = js_sys::Uint8Array::from(*update);
            Reflect::set(&values, &key.clone().into(), &bytes)
                .context("failed to encode pending operation")?;
            Reflect::set(&values, &all_op_key(&id).into(), &bytes)
                .context("failed to encode audit operation")?;
            pending_keys.push(key);
        }
        if !pending_keys.is_empty() {
            self.inner.put_multiple_raw(values).await?;
            self.applied_keys
                .write()
                .unwrap_context("applied_keys mutex poisoned")
                .extend(pending_keys);
        }
        Ok(imported)
    }

    async fn persist_operation(
        &self,
        op_update: &[u8],
        attribution: Option<&crate::domain::document::DocumentAttribution>,
    ) -> Result<()> {
        let op_id = self.ids.id();
        let op_key = pending_op_key(&op_id);
        self.inner.put(&op_key, op_update).await?;
        self.applied_keys
            .write()
            .unwrap_context("applied_keys mutex poisoned")
            .insert(op_key);
        self.inner.put(&all_op_key(&op_id), op_update).await?;
        if let Some(attribution) = attribution {
            let metadata = serde_json::to_vec(attribution)
                .context("failed to serialize signed document attribution")?;
            self.inner.put(&format!("actor/{op_id}"), metadata).await?;
        }
        Ok(())
    }

    pub async fn apply_pending_ops(&self, snapshot: &DocumentState) -> Result<()> {
        let pending_ops = self
            .get_pending_operations()
            .await
            .context("get_pending_operations failed")?;
        let n_pending_ops = pending_ops.len();
        trace!(
            pending_ops_len = n_pending_ops,
            "Applying [{}] pending ops", n_pending_ops
        );

        let mut ers = vec![];
        let mut ops = vec![];
        let mut keys = vec![];
        for res_op in pending_ops {
            match res_op {
                Ok((k, o)) => {
                    keys.push(k);
                    ops.push(o);
                }
                Err(e) => ers.push(e),
            }
        }

        if !ers.is_empty() {
            error!(errors =? ers, "got [{}] invalid things from durable ojbect KV", ers.len());
        }

        snapshot
            .replay_pending_operations(&ops)
            .context("failed applying pending ops")?;

        self.applied_keys
            .write()
            .unwrap_context("applied_keys mutex poisoned")
            .extend(keys);

        Ok(())
    }

    pub async fn clear_applied_ops(&self) -> Result<()> {
        let keys: Vec<String> = {
            let keys = self
                .applied_keys
                .read()
                .unwrap_context("applied_keys mutex poisoned");
            if keys.is_empty() {
                return Ok(());
            }
            keys.clone().into_iter().collect()
        };
        let n_deleted = self
            .inner
            .delete_multiple(keys.clone())
            .await
            .inspect_err(|e| warn!(keys =? keys, error=?e, "error in kv.delete_multiple()"))?;
        if n_deleted != keys.len() {
            error!(
                n_deleted = n_deleted,
                keys_len = keys.len(),
                keys =? keys,
                "
We have mystery key which we can't delete.
We must cycle through current keys and remove those we have not applied yet
TODO
"
            );
        }
        let mut app_keys = self
            .applied_keys
            .write()
            .unwrap_context("applied_keys mutex poisoned");
        for k in keys {
            app_keys.remove(&k);
        }
        Ok(())
    }

    pub async fn store_heads(&self, heads: &[ChangeHash]) -> Result<()> {
        self.inner
            .put(LAST_VERSION_VECTOR_KEY, encode_revision(heads))
            .await?;
        Ok(())
    }

    pub async fn check_saved_heads(&self, state: &DocumentState) -> Result<()> {
        let Some(bytes) = self.inner.get::<Vec<u8>>(LAST_VERSION_VECTOR_KEY).await? else {
            return Ok(());
        };
        let heads = decode_revision(&bytes).context("invalid saved Automerge revision")?;
        if !state.contains_heads(&heads) {
            return Err(worker::Error::from(
                "loaded snapshot is behind saved revision",
            ));
        }
        Ok(())
    }
}

/// Produce ID's that are orderable lexicalgraphically in the order they were created.
#[derive(Debug, Default)]
pub struct OrederedIds {
    counter: AtomicUsize,
}

impl OrederedIds {
    const ORDERING: Ordering = Ordering::Relaxed;

    pub fn id(&self) -> String {
        let ts = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_context("Time since unix epoch was negative...?")
            .as_nanos();
        let i = self.counter.fetch_add(1, Self::ORDERING);
        format!("{ts:016x}.{i:08x}")
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn order_timestamps() -> std::result::Result<(), Box<dyn std::error::Error>> {
        let x = OrederedIds::default();
        let mut og_arr = vec![];
        for _ in 0..10 {
            og_arr.push(x.id());
        }
        let mut sorted_arr = og_arr.clone();
        sorted_arr.sort();
        assert_eq!(sorted_arr, og_arr);
        Ok(())
    }
}
