//! Actual Loro document implementation of the client's lending port.
use crate::{AbstractOp, Failure, IdSpan, Vv};
use doc_sync_core::*;
use loro::ToJson;

pub(crate) struct SimDoc {
    pub loro: loro::LoroDoc,
    pub pending: bool,
    pub imports: Vec<(String, bool, Option<String>)>,
}
impl SimDoc {
    pub fn new(peer: u64) -> Result<Self, Failure> {
        let loro = loro::LoroDoc::new();
        loro.set_peer_id(peer)
            .map_err(|e| Failure::new("peer_assignment", e))?;
        loro.set_record_timestamp(false);
        loro.set_change_merge_interval(0);
        Ok(Self {
            loro,
            pending: false,
            imports: Vec::new(),
        })
    }
    pub fn edit(&mut self, op: &AbstractOp, fields: u16, wall: i64) -> Result<(), Failure> {
        match op {
            AbstractOp::Editor(_) => {
                return Err(Failure::new(
                    "editor_surface",
                    "editor input on a generic document",
                ));
            }
            AbstractOp::FormSet { field, value } => {
                self.loro
                    .get_map("fields")
                    .insert(&(field % fields.max(1)).to_string(), i64::from(*value))
                    .map_err(|e| Failure::new("form_set", e))?;
            }
            AbstractOp::FormText { field, bytes, salt } => {
                let length = usize::try_from(*bytes)
                    .unwrap_or(usize::MAX)
                    .min(4 * 1_024 * 1_024);
                let mut text = String::with_capacity(length);
                for block in 0..length.div_ceil(8) {
                    let hash = xxhash_rust::xxh3::xxh3_64_with_seed(
                        &u64::try_from(block).unwrap_or(u64::MAX).to_le_bytes(),
                        u64::from(*salt),
                    );
                    for byte in hash.to_le_bytes().into_iter().take(length - text.len()) {
                        text.push(char::from(33 + byte % 94));
                    }
                }
                self.loro
                    .get_map("fields")
                    .insert(&(field % fields.max(1)).to_string(), text)
                    .map_err(|error| Failure::new("form_text", error))?;
            }
            AbstractOp::FormMove { from, to } => {
                let list = self.loro.get_movable_list("order");
                let count = list.len();
                if count > 0 {
                    list.mov(usize::from(*from) % count, usize::from(*to) % count)
                        .map_err(|e| Failure::new("form_move", e))?;
                }
            }
            AbstractOp::Select(_) => return Ok(()),
        }
        self.loro
            .commit_with(loro::CommitOptions::default().timestamp(wall / 1_000));
        Ok(())
    }
    pub fn snapshot(&self) -> Result<Vec<u8>, Failure> {
        self.loro
            .export(loro::ExportMode::snapshot())
            .map_err(|error| Failure::new("seed_snapshot", error))
    }
    pub fn value(&self) -> Result<serde_json::Value, Failure> {
        serde_json::from_str(&self.loro.get_deep_value().to_json())
            .map_err(|e| Failure::new("deep_value", e))
    }
    fn import(&mut self, bytes: &[u8]) -> Result<Imported, ImportFailure> {
        let before = self.loro.oplog_vv();
        let imported = self.loro.import(bytes).map_err(|e| {
            if matches!(
                e,
                loro::LoroError::ImportUpdatesThatDependsOnOutdatedVersion
            ) {
                ImportFailure::Outdated
            } else {
                ImportFailure::Loro(e)
            }
        })?;
        self.pending = imported.pending.is_some();
        Ok(Imported {
            changed: before != self.loro.oplog_vv(),
            new_ops: before != self.loro.oplog_vv(),
            pending: self.pending,
        })
    }
}
impl SyncDoc for SimDoc {
    fn peer_id(&self) -> u64 {
        self.loro.peer_id()
    }
    fn oplog_vv(&self) -> loro::VersionVector {
        self.loro.oplog_vv()
    }
    fn import_remote(
        &mut self,
        bytes: &[u8],
        origin: ImportOrigin,
    ) -> Result<Imported, ImportFailure> {
        let result = self.import(bytes);
        self.imports.push((
            format!("{origin:?}"),
            result.as_ref().is_ok_and(|v| v.pending),
            result.as_ref().err().map(ToString::to_string),
        ));
        result
    }
    fn export_local(&self, since: &loro::VersionVector) -> Result<Option<Vec<u8>>, ExportFailure> {
        let peer = self.peer_id();
        let end = self.oplog_vv().get(&peer).copied().unwrap_or(0);
        let start = since.get(&peer).copied().unwrap_or(0);
        if start >= end {
            return Ok(None);
        }
        self.loro
            .export(loro::ExportMode::updates_in_range(vec![loro::IdSpan::new(
                peer, start, end,
            )]))
            .map(Some)
            .map_err(|e| ExportFailure::Loro(loro::LoroError::DecodeError(e.to_string().into())))
    }
    fn export_shallow_snapshot(&self, at: &loro::Frontiers) -> Result<Vec<u8>, ExportFailure> {
        self.loro
            .export(loro::ExportMode::shallow_snapshot(at))
            .map_err(|e| ExportFailure::Loro(loro::LoroError::DecodeError(e.to_string().into())))
    }
    fn probe_import(
        &mut self,
        snapshot: &[u8],
        bytes: &[u8],
        new_peer: u64,
    ) -> Result<Imported, ImportFailure> {
        let mut probe = Self::new(new_peer)
            .map_err(|e| ImportFailure::Loro(loro::LoroError::DecodeError(e.to_string().into())))?;
        probe.import(snapshot)?;
        probe.import(bytes)
    }
    fn seed(&mut self, snapshot: &[u8], _: SeedKind) -> Result<(), ImportFailure> {
        self.import(snapshot).map(|_| ())
    }
    fn replace(&mut self, snapshot: &[u8], peer: u64) -> Result<(), ImportFailure> {
        let mut replacement = Self::new(peer)
            .map_err(|e| ImportFailure::Loro(loro::LoroError::DecodeError(e.to_string().into())))?;
        let imported = replacement.import(snapshot)?;
        if imported.pending {
            return Err(ImportFailure::Loro(
                loro::LoroError::DecodeDataCorruptionError,
            ));
        }
        *self = replacement;
        Ok(())
    }
}
pub(crate) fn vv(value: &loro::VersionVector) -> Vv {
    value.iter().map(|(p, c)| (*p, *c)).collect()
}
pub(crate) fn spans(bytes: &[u8]) -> Result<Vec<IdSpan>, Failure> {
    let meta = loro::LoroDoc::decode_import_blob_meta(bytes, false)
        .map_err(|e| Failure::new("update_metadata", e))?;
    Ok(meta
        .partial_end_vv
        .iter()
        .filter_map(|(peer, end)| {
            let start = meta.partial_start_vv.get(peer).copied().unwrap_or(0);
            (*end > start).then_some((
                *peer,
                IdSpan {
                    peer: *peer,
                    start,
                    end: *end,
                },
            ))
        })
        .collect::<std::collections::BTreeMap<_, _>>()
        .into_values()
        .collect())
}

pub(crate) struct SeedSnapshots {
    pub server: Vec<u8>,
    pub local: Option<Vec<u8>>,
    pub s3: Option<(Vec<u8>, crate::Millis)>,
    pub vv: Vv,
}
pub(crate) fn seed_snapshots(
    peer: u64,
    fields: u16,
    wall: i64,
    spec: &crate::SeedDocument,
) -> Result<SeedSnapshots, Failure> {
    if let crate::SeedDocument::Editor(state) = spec {
        let editor = crate::client::application::builder(
            lexical_model::EditorMode::Headless,
            peer,
            std::sync::Arc::new(std::sync::atomic::AtomicU64::new(
                u64::try_from(wall).map_err(|error| Failure::new("editor_seed_clock", error))?,
            )),
            0,
            Some(8),
        )
        .initial_state(
            serde_json::from_value(state.clone())
                .map_err(|error| Failure::new("editor_seed", error))?,
        )
        .build()
        .map_err(|error| Failure::new("editor_seed", error))?;
        let doc =
            lexical_loro::new_doc(peer).map_err(|error| Failure::new("editor_seed", error))?;
        lexical_loro::LoroProjection::initialize(
            &doc,
            editor.state(),
            &macro_document_model::sync::MACRO_SYNC_POLICY,
            wall / 1000,
        )
        .map_err(|error| Failure::new("editor_seed", error))?;
        return Ok(SeedSnapshots {
            server: doc
                .export(loro::ExportMode::Snapshot)
                .map_err(|error| Failure::new("editor_seed", error))?,
            local: None,
            s3: None,
            vv: vv(&doc.oplog_vv()),
        });
    }
    let mut doc = SimDoc::new(peer)?;
    for index in 0..fields.max(1) {
        doc.loro
            .get_movable_list("order")
            .push(i64::from(index))
            .map_err(|error| Failure::new("seed_document", error))?;
    }
    doc.loro
        .commit_with(loro::CommitOptions::default().timestamp(wall / 1_000));
    let mut local = None;
    let mut s3 = None;
    match spec {
        crate::SeedDocument::Editor(_) => unreachable!("handled editor seed"),
        crate::SeedDocument::Empty => {}
        crate::SeedDocument::Form(writes) => {
            seed_fields(&mut doc, writes, fields, wall)?;
        }
        crate::SeedDocument::Cached {
            server,
            s3: cached,
            local: saved,
        } => {
            if let Some(writes) = saved {
                seed_fields(&mut doc, writes, fields, wall)?;
                local = Some(doc.snapshot()?);
            }
            if let Some((writes, after)) = cached {
                seed_fields(&mut doc, writes, fields, wall)?;
                s3 = Some((doc.snapshot()?, *after));
            }
            seed_fields(&mut doc, server, fields, wall)?;
        }
    }
    Ok(SeedSnapshots {
        server: doc.snapshot()?,
        local,
        s3,
        vv: vv(&doc.loro.oplog_vv()),
    })
}
fn seed_fields(
    doc: &mut SimDoc,
    writes: &[(u16, u16)],
    fields: u16,
    wall: i64,
) -> Result<(), Failure> {
    for (field, value) in writes {
        doc.edit(
            &AbstractOp::FormSet {
                field: *field,
                value: *value,
            },
            fields,
            wall,
        )?;
    }
    Ok(())
}
