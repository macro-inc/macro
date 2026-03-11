use loro::VersionVector;
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

use crate::{error::ResultExt, state::DocumentState};

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

    pub async fn apply_op(&self, document_state: &DocumentState, op_update: &[u8]) -> Result<()> {
        let op_id = self.ids.id();
        let op_key = pending_op_key(&op_id);
        document_state.import(op_update)?;
        self.inner.put(&op_key, op_update).await?;
        self.applied_keys
            .write()
            .unwrap_context("applied_keys mutex poisoned")
            .insert(op_key);
        self.inner.put(&all_op_key(&op_id), op_update).await?;
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

    pub async fn store_version_vector(&self, vv: &VersionVector) -> Result<()> {
        let value = vv.encode();
        self.inner.put(LAST_VERSION_VECTOR_KEY, value).await?;
        Ok(())
    }

    /// The passed in version vector should be equal or greater than the last saved vv
    pub async fn cmp_vv_with_last_snapshot_vv(
        &self,
        loaded_snapshot_vv: &VersionVector,
    ) -> Result<()> {
        let Some(bytes) =
            do_kv_result_to_result_opt(self.inner.get::<Vec<u8>>(LAST_VERSION_VECTOR_KEY).await)?
        else {
            warn!("No version vector was saved the last time a snapshot was saved");
            return Ok(());
        };
        let last_saved_vv = VersionVector::decode(&bytes).expect("TODO we wrote a bad vv???");
        match loaded_snapshot_vv.partial_cmp(&last_saved_vv) {
            Some(ord) => match ord {
                std::cmp::Ordering::Less => {
                    error!("Loaded snapshot older than the last snapshot saved");
                }
                std::cmp::Ordering::Equal => {
                    trace!("Loaded snapshot matches last snapshot saved");
                }
                std::cmp::Ordering::Greater => {
                    // this could happen if saving snapshot succeeds but writing, but
                    // store_version_vector fails.
                    warn!("Loaded snapshot was newer than the last snapshot saved");
                }
            },
            None => {
                warn!("Loaded snapshot that diverged from the last snapshot saved");
            }
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
