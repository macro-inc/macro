use crate::domain::fanout::{
    FANOUT_DEBT_KEY, FanoutDebt, LEGACY_FANOUT_DEBT_KEY, is_fanout_debt_key,
};
use crate::domain::fanout::{PendingOperations, StatePort};
use crate::storage::operation_chunks::{
    FORMAT_MARKER_KEY, FORMAT_MARKER_VALUE, INLINE_BYTES, INLINE_COMPLETE_TAG, Manifest, chunk_key,
};
use loro::{LoroDoc, VersionVector};
mod fanout;
use serde::Deserialize;
use std::{
    collections::{BTreeMap, BTreeSet},
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
    pending: RwLock<PendingOperations>,
    archive_incomplete: RwLock<BTreeSet<String>>,
    physical_keys: RwLock<BTreeMap<String, BTreeSet<String>>>,
}

/// For a given op, if it has been applied but the snapshot has not be saved, it is considered
/// 'pending'
const PENDING_OP_PREFIX: &str = "o/";
/// This prefix has a record of all ops. We keep all ops because we have been losing data.
/// NB: This does not contain all historical ops, just ops since we started tracking. So it can't
/// be used to recreate all documents.
const ALL_OP_PREFIX: &str = "a/";
const ARCHIVE_STATUS_PREFIX: &str = "o/!archive-status-v1/";

#[derive(Deserialize)]
#[serde(transparent)]
struct RawStorageValue(
    #[serde(with = "serde_wasm_bindgen::preserve")] worker::wasm_bindgen::JsValue,
);

// Readers recognize the deployed receipt format even though this build never
// writes it. Preserve the byte buffer instead of coercing the tuple to bytes.
fn operation_bytes(value: &worker::wasm_bindgen::JsValue) -> Result<Vec<u8>> {
    if js_sys::Array::is_array(value) {
        let tag = Reflect::get_u32(value, 0)?.as_f64();
        let namespace = f64::from(INLINE_COMPLETE_TAG & 0xffff_0000);
        if tag == Some(f64::from(INLINE_COMPLETE_TAG)) {
            let data = Reflect::get_u32(value, 1)?;
            if Reflect::get(value, &"length".into())?.as_f64() != Some(2.0)
                || !data.is_instance_of::<js_sys::Uint8Array>()
            {
                return Err(worker::Error::from("invalid inline operation receipt"));
            }
            let bytes = js_sys::Uint8Array::new(&data).to_vec();
            if bytes.is_empty() || bytes.len() > INLINE_BYTES {
                return Err(worker::Error::from(
                    "invalid inline operation receipt length",
                ));
            }
            return Ok(bytes);
        }
        if tag.is_some_and(|tag| tag >= namespace && tag < namespace + 65536.0) {
            return Err(worker::Error::from(
                "invalid inline operation receipt version",
            ));
        }
    }
    Ok(js_sys::Uint8Array::new(value).to_vec())
}

/// Always-on reader for sidecars created by the separately activated writer.
#[derive(Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
enum ArchiveStatus {
    Incomplete {
        attribution: Option<crate::domain::document::DocumentAttribution>,
    },
    Complete,
}

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
            pending: Default::default(),
            archive_incomplete: Default::default(),
            physical_keys: Default::default(),
        }
    }

    pub(in crate::outbound::storage) async fn get_key(&self, key: &str) -> Result<Option<Vec<u8>>> {
        match self.inner.get::<RawStorageValue>(key).await? {
            Some(value) => self
                .resolve_operation(key, operation_bytes(&value.0)?)
                .await
                .map(Some),
            None => Ok(None),
        }
    }

    pub(in crate::outbound::storage) async fn list_do_kv(
        &self,
        prefix: &str,
    ) -> Result<Vec<Result<(String, Vec<u8>)>>> {
        let entries = self
            .inner
            .list_with_options(ListOptions::new().prefix(prefix))
            .await?;
        let mut operations = Vec::new();
        for entry in entries.entries().into_iter() {
            let entry = entry.context("error getting operation entry")?;
            let key = Reflect::get_u32(&entry, 0)?
                .as_string()
                .context("operation key is not a string")?;
            let value = Reflect::get_u32(&entry, 1)?;
            // Incomplete or corrupt physical records fail the entire read: a
            // partial document must never be published as a successful load.
            let bytes = self
                .resolve_operation(&key, operation_bytes(&value)?)
                .await?;
            operations.push(Ok((key, bytes)));
        }
        Ok(operations)
    }

    async fn resolve_operation(&self, key: &str, bytes: Vec<u8>) -> Result<Vec<u8>> {
        if is_fanout_debt_key(key) {
            let debt: FanoutDebt = serde_json::from_slice(&bytes).context("invalid fanout debt")?;
            debt.vectors().context("invalid fanout version vectors")?;
            return Ok(bytes);
        }
        if key == FORMAT_MARKER_KEY {
            if bytes != FORMAT_MARKER_VALUE {
                return Err(worker::Error::from("invalid operation format marker"));
            }
            return Ok(bytes);
        }
        if key.starts_with(ARCHIVE_STATUS_PREFIX) {
            let _: ArchiveStatus =
                serde_json::from_slice(&bytes).context("invalid archive receipt")?;
            return Ok(bytes);
        }
        if !(key.starts_with(PENDING_OP_PREFIX) || key.starts_with(ALL_OP_PREFIX)) {
            return Ok(bytes);
        }
        let Some(header) =
            Manifest::decode(&bytes).map_err(|error| worker::Error::from(error.to_string()))?
        else {
            return Ok(bytes);
        };
        let mut chunks = Vec::new();
        for start in (0..header.count()).step_by(128) {
            let end = start.saturating_add(128).min(header.count());
            let keys: Vec<_> = (start..end).map(|index| chunk_key(key, index)).collect();
            let values = self
                .inner
                .get_multiple(keys.iter().map(String::as_str).collect())
                .await?;
            for key in &keys {
                let value = values.get(&key.into());
                if !value.is_instance_of::<js_sys::Uint8Array>() {
                    return Err(worker::Error::from("missing or invalid operation chunk"));
                }
                chunks.push(js_sys::Uint8Array::new(&value).to_vec());
            }
        }
        let update = header
            .assemble(&chunks)
            .map_err(|error| worker::Error::from(error.to_string()))?;
        let physical: Vec<_> = (0..header.count())
            .map(|index| chunk_key(key, index))
            .collect();
        if key.starts_with(PENDING_OP_PREFIX) {
            self.physical_keys
                .write()
                .unwrap_context("physical operation keys lock")
                .entry(key.to_owned())
                .or_default()
                .extend(physical);
        }
        Ok(update)
    }

    /// get pending operations from the operation log
    pub(crate) async fn get_pending_operations(&self) -> Result<Vec<Result<(String, Vec<u8>)>>> {
        let entries = self.list_do_kv(PENDING_OP_PREFIX).await?;
        let mut operations = Vec::new();
        let mut incomplete = BTreeSet::new();
        let mut debt: Option<FanoutDebt> = None;
        for entry in entries {
            let (key, bytes) = entry?;
            if key == FORMAT_MARKER_KEY {
                continue;
            }
            if is_fanout_debt_key(&key) {
                let found: FanoutDebt =
                    serde_json::from_slice(&bytes).context("invalid fanout debt")?;
                debt = Some(found);
                continue;
            }
            if let Some(id) = key.strip_prefix(ARCHIVE_STATUS_PREFIX) {
                let status: ArchiveStatus =
                    serde_json::from_slice(&bytes).context("invalid archive receipt")?;
                self.physical_keys
                    .write()
                    .unwrap_context("physical operation keys lock")
                    .entry(pending_op_key(id))
                    .or_default()
                    .insert(key.clone());
                if let ArchiveStatus::Incomplete { attribution } = status {
                    // Preserve original signed claims in the sidecar. This
                    // reader-only build never repairs or reattributes archives.
                    let _ = attribution;
                    incomplete.insert(pending_op_key(id));
                }
                continue;
            }
            operations.push(Ok((key, bytes)));
        }
        // One cold read outside the legacy pending-prefix scan. Read failures
        // and invalid metadata preserve both keys and fail restoration.
        if let Some(bytes) = self.inner.get::<Vec<u8>>(FANOUT_DEBT_KEY).await? {
            let found: FanoutDebt =
                serde_json::from_slice(&bytes).context("invalid fanout debt")?;
            found.vectors().context("invalid fanout version vectors")?;
            debt = Some(match debt {
                Some(old) => old
                    .merged_with(&found)
                    .context("incompatible fanout debts")?,
                None => found,
            });
        }
        self.with_pending(|state| state.restore_debt(debt));
        *self
            .archive_incomplete
            .write()
            .unwrap_context("archive status lock") = incomplete;
        Ok(operations)
    }

    pub async fn apply_op(
        &self,
        document_state: &DocumentState,
        op_update: &[u8],
    ) -> Result<ImportedUpdate> {
        self.apply_op_with_attribution(document_state, op_update, None)
            .await
    }

    /// Attribution is supplied only by the verified JWT boundary, never CRDT
    /// peer IDs or request-body fields. Metadata shares the operation-log ID.
    pub async fn apply_op_with_attribution(
        &self,
        document_state: &DocumentState,
        op_update: &[u8],
        attribution: Option<&crate::domain::document::DocumentAttribution>,
    ) -> Result<ImportedUpdate> {
        crate::domain::fanout::append(
            &fanout::Append {
                storage: self,
                document: document_state,
                attribution,
            },
            op_update,
        )
        .await
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

        let mut rows = Vec::new();
        for entry in pending_ops {
            let (key, bytes) = entry?;
            let required = LoroDoc::decode_import_blob_meta(&bytes, false)
                .context("invalid pending operation metadata")?
                .partial_end_vv;
            rows.push((key, required, bytes));
        }
        snapshot.replay_pending_operations(
            &rows
                .iter()
                .map(|(_, _, bytes)| bytes.clone())
                .collect::<Vec<_>>(),
        )?;
        self.with_pending(|state| {
            state.restore_pending(
                rows.into_iter().map(|(key, required, _)| (key, required)),
                &snapshot.loro_doc.oplog_vv(),
            )
        });
        Ok(())
    }

    pub async fn clear_applied_ops(&self) -> Result<()> {
        let keys: Vec<String> = {
            let keys = self
                .pending
                .read()
                .unwrap_context("applied_keys mutex poisoned");
            if keys.applied_keys().next().is_none() {
                return Ok(());
            }
            let incomplete = self
                .archive_incomplete
                .read()
                .unwrap_context("archive status lock");
            keys.applied_keys()
                .filter(|key| !incomplete.contains(*key))
                .cloned()
                .collect()
        };
        let mut physical = keys.clone();
        {
            let chunks = self
                .physical_keys
                .read()
                .unwrap_context("physical operation keys lock");
            for key in &keys {
                if let Some(extra) = chunks.get(key) {
                    physical.extend(extra.iter().cloned());
                }
            }
        }
        let n_deleted = self
            .inner
            .delete_multiple(physical.clone())
            .await
            .inspect_err(|e| warn!(keys =? keys, error=?e, "error in kv.delete_multiple()"))?;
        if n_deleted != physical.len() {
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
            .pending
            .write()
            .unwrap_context("applied_keys mutex poisoned");
        let mut physical_keys = self
            .physical_keys
            .write()
            .unwrap_context("physical operation keys lock");
        for k in keys {
            app_keys.forget_applied(&k);
            physical_keys.remove(&k);
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
