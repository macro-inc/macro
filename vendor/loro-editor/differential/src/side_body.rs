// Shared runner body; `li` is the loro-internal build under test.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Mutex};

use li::cursor::PosType;
use li::encoding::ExportMode;
use li::handler::{Handler, HandlerTrait, TextHandler};
use li::loro::CommitOptions;
use li::loro_common::{LoroValue, TreeID};
use li::version::{Frontiers, VersionVector};
use li::{LoroDoc, TreeParentId, UndoManager};

use crate::{Config, Observation, Op, Stats, TextEdit, TextTarget, Unit, Value};
use crate::{BULK_TEXT_LEN, EXCLUDED_ORIGIN, EXCLUDED_PREFIX, KEYS, MARK_KEYS, STRINGS};

const ALWAYS_MERGE_MS: i64 = 1 << 50;
const MIN_RETAINED_OPS_FOR_FORWARD_ROOT_STATE: usize = 65_536;

#[derive(Default)]
struct EditorCommit {
    suppressed: bool,
    projected: bool,
    error: Option<String>,
}

fn commit_options(origin: &str, timestamp: i64) -> CommitOptions {
    CommitOptions::new().origin(origin).timestamp(timestamp)
}

struct Peer {
    id: u64,
    doc: LoroDoc,
    undo: UndoManager,
    _subscription: li::Subscription,
    events: Arc<Mutex<Vec<(String, String, String)>>>,
    undo_log: Arc<Mutex<Vec<String>>>,
    /// Distinct oplog frontiers this peer has had, oldest first.
    history: Vec<Frontiers>,
    /// Version vectors matching `history`.
    history_vv: Vec<VersionVector>,
}

impl Peer {
    fn new(id: u64, config: &Config, snapshot: Option<&[u8]>) -> Result<Self, String> {
        let doc = LoroDoc::new_auto_commit();
        doc.set_peer_id(id).map_err(|e| e.to_string())?;
        doc.set_record_timestamp(false);
        if let Some(bytes) = snapshot {
            doc.import(bytes).map_err(|e| e.to_string())?;
        }
        let undo = UndoManager::new(&doc);
        configure_clock(&undo, config.merge);
        if let Some(max) = config.max_undo {
            undo.set_max_undo_steps(usize::from(max));
        }
        undo.add_exclude_origin_prefix(EXCLUDED_PREFIX);
        let undo_log = Arc::new(Mutex::new(Vec::new()));
        let push_log = undo_log.clone();
        // Event presence differs by design on the projected checkpoint path;
        // the kind and op span must not.
        undo.set_on_push(Some(Box::new(move |kind, span, _event| {
            push_log
                .lock()
                .unwrap()
                .push(format!("push {kind:?} {span:?}"));
            li::undo::UndoItemMeta::new()
        })));
        let pop_log = undo_log.clone();
        undo.set_on_pop(Some(Box::new(move |kind, span, _meta| {
            pop_log
                .lock()
                .unwrap()
                .push(format!("pop {kind:?} {span:?}"));
        })));
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        let subscription = doc.subscribe_root(Arc::new(move |event| {
            // The public loro facade exposes by, origin, target and diffs;
            // the internal DocDiff versions are recorded separately.
            let meta = &event.event_meta;
            sink.lock().unwrap().push((
                format!(
                    "{:?} {:?} {:?} {:?}",
                    meta.by, meta.origin, event.current_target, event.events
                ),
                format!("{:?}", meta.from),
                format!("{:?}", meta.to),
            ));
        }));
        let history = vec![doc.oplog_frontiers()];
        let history_vv = vec![doc.oplog_vv()];
        Ok(Self {
            id,
            doc,
            undo,
            _subscription: subscription,
            events,
            undo_log,
            history,
            history_vv,
        })
    }

    fn note_version(&mut self) {
        let frontiers = self.doc.oplog_frontiers();
        if self.history.last() != Some(&frontiers) {
            self.history.push(frontiers);
            self.history_vv.push(self.doc.oplog_vv());
        }
    }

    fn recorded(&self, at: u16) -> Frontiers {
        self.history[usize::from(at) % self.history.len()].clone()
    }
}

/// All peers of one side.
pub struct World {
    config: Config,
    peers: Vec<Peer>,
    stats: Stats,
    clock: i64,
    suppressed: Vec<bool>,
    next_renewed_peer: u64,
    adopted: Vec<Option<crate::Adoption>>,
}

fn panic_message(payload: Box<dyn std::any::Any + Send>) -> String {
    payload
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| payload.downcast_ref::<&str>().map(|s| (*s).to_owned()))
        .unwrap_or_else(|| "<non-string panic>".into())
}

fn pos_type(unit: Unit) -> PosType {
    match unit {
        Unit::Unicode => PosType::Unicode,
        Unit::Utf16 => PosType::Utf16,
        Unit::Bytes => PosType::Bytes,
        Unit::Event => PosType::Event,
    }
}

fn text_len(text: &TextHandler, unit: Unit) -> usize {
    match unit {
        Unit::Unicode => text.len_unicode(),
        Unit::Utf16 => text.len_utf16(),
        Unit::Bytes => text.len_utf8(),
        Unit::Event => text.len_event(),
    }
}

fn value(v: Value) -> LoroValue {
    match v {
        Value::I(i) => LoroValue::from(i64::from(i)),
        Value::S(s) => LoroValue::from(STRINGS[usize::from(s) % STRINGS.len()]),
        Value::B(b) => LoroValue::from(b),
        Value::Null => LoroValue::Null,
    }
}

fn mark_value(v: i8) -> LoroValue {
    match v {
        0 => LoroValue::from(false),
        1 => LoroValue::from(true),
        _ => LoroValue::Null,
    }
}

fn key(k: u8) -> &'static str {
    KEYS[usize::from(k) % KEYS.len()]
}

fn modulo(v: impl Into<usize>, n: usize) -> usize {
    if n == 0 {
        0
    } else {
        v.into() % n
    }
}

fn text_child(handler: li::LoroResult<Handler>) -> Option<TextHandler> {
    match handler {
        Ok(Handler::Text(t)) => Some(t),
        _ => None,
    }
}

fn resolve_text(doc: &LoroDoc, target: TextTarget) -> Option<TextHandler> {
    match target {
        TextTarget::Root => Some(doc.get_text("t")),
        TextTarget::MapChild(k) => text_child(doc.get_map("m").get_child_handler(key(k))),
        TextTarget::ListChild(i) => {
            let list = doc.get_list("l");
            let len = list.len();
            (len > 0)
                .then(|| text_child(list.get_child_handler(modulo(i, len))))
                .flatten()
        }
        TextTarget::MovableChild(i) => {
            let list = doc.get_movable_list("ml");
            let len = list.len();
            (len > 0)
                .then(|| text_child(list.get_child_handler(modulo(i, len))))
                .flatten()
        }
    }
}

fn result<T: std::fmt::Debug, E: std::fmt::Display>(r: Result<T, E>) -> String {
    match r {
        Ok(v) => format!("ok {v:?}"),
        Err(e) => format!("err {e}"),
    }
}

fn text_edit(text: &TextHandler, edit: &TextEdit) -> String {
    match *edit {
        TextEdit::Insert { pos, s, unit } => {
            let pos = modulo(pos as usize, text_len(text, unit) + 1);
            result(text.insert(pos, STRINGS[usize::from(s) % STRINGS.len()], pos_type(unit)))
        }
        TextEdit::Delete { pos, len, unit } => {
            let total = text_len(text, unit);
            let pos = modulo(pos as usize, total + 1);
            let len = usize::from(len).min(total - pos);
            result(text.delete(pos, len, pos_type(unit)))
        }
        TextEdit::Mark {
            start,
            len,
            key,
            value,
            unit,
        } => {
            let total = text_len(text, unit);
            let start = modulo(start as usize, total + 1);
            let end = (start + usize::from(len)).min(total);
            let key = MARK_KEYS[usize::from(key) % MARK_KEYS.len()];
            result(text.mark(start, end, key, mark_value(value), pos_type(unit)))
        }
        TextEdit::Unmark {
            start,
            len,
            key,
            unit,
        } => {
            let total = text_len(text, unit);
            let start = modulo(start as usize, total + 1);
            let end = (start + usize::from(len)).min(total);
            let key = MARK_KEYS[usize::from(key) % MARK_KEYS.len()];
            result(text.unmark(start, end, key, pos_type(unit)))
        }
        TextEdit::Update { s, suffix } => {
            let current: String = text.to_string().chars().take(10).collect();
            let next = format!(
                "{}{current}{}",
                STRINGS[usize::from(s) % STRINGS.len()],
                STRINGS[usize::from(suffix) % STRINGS.len()]
            );
            result(
                text.update(&next, Default::default())
                    .map_err(|e| format!("{e:?}")),
            )
        }
    }
}

fn tree_node(nodes: &[TreeID], sel: u16) -> Option<TreeID> {
    (!nodes.is_empty()).then(|| nodes[modulo(sel, nodes.len())])
}

fn tree_parent(nodes: &[TreeID], sel: u16) -> TreeParentId {
    let i = modulo(sel, nodes.len() + 1);
    if i == nodes.len() {
        TreeParentId::Root
    } else {
        TreeParentId::Node(nodes[i])
    }
}

fn sorted_vv(vv: &VersionVector) -> Vec<(u64, i32)> {
    let mut v: Vec<_> = vv.iter().map(|(p, c)| (*p, *c)).collect();
    v.sort_unstable();
    v
}

fn sorted_frontiers(f: &Frontiers) -> Vec<(u64, i32)> {
    let mut v: Vec<_> = f.iter().map(|id| (id.peer, id.counter)).collect();
    v.sort_unstable();
    v
}

/// Canonical rendering: map keys sorted, floats by bits.
fn canon(v: &LoroValue, out: &mut String) {
    use std::fmt::Write;
    match v {
        LoroValue::Null => out.push_str("null"),
        LoroValue::Bool(b) => write!(out, "{b}").unwrap(),
        LoroValue::Double(d) => write!(out, "f{:x}", d.to_bits()).unwrap(),
        LoroValue::I64(i) => write!(out, "{i}").unwrap(),
        LoroValue::Binary(b) => write!(out, "b{:?}", &b[..]).unwrap(),
        LoroValue::String(s) => write!(out, "{:?}", &s[..]).unwrap(),
        LoroValue::List(list) => {
            out.push('[');
            for item in list.iter() {
                canon(item, out);
                out.push(',');
            }
            out.push(']');
        }
        LoroValue::Map(map) => {
            let mut entries: Vec<_> = map.iter().collect();
            entries.sort_by(|a, b| a.0.cmp(b.0));
            out.push('{');
            for (k, item) in entries {
                write!(out, "{k:?}:").unwrap();
                canon(item, out);
                out.push(',');
            }
            out.push('}');
        }
        LoroValue::Container(id) => write!(out, "c{id}").unwrap(),
    }
}

fn canonical(v: &LoroValue) -> String {
    let mut out = String::new();
    canon(v, &mut out);
    out
}

impl World {
    /// Fresh peers 1..=PEERS.
    pub fn new(config: &Config) -> Self {
        let peers = (0..crate::PEERS as u64)
            .map(|i| Peer::new(i + 1, config, None).expect("fresh peer"))
            .collect();
        Self {
            config: config.clone(),
            peers,
            stats: Stats::default(),
            clock: 0,
            suppressed: vec![false; crate::PEERS],
            next_renewed_peer: 1_000,
            adopted: vec![None; crate::PEERS],
        }
    }

    /// Counters gathered since the last call.
    pub fn take_stats(&mut self) -> Stats {
        std::mem::take(&mut self.stats)
    }

    /// Apply one step and observe every peer; exports only for touched peers.
    pub fn step(&mut self, op: &Op) -> Result<Vec<Observation>, String> {
        self.clock += 1;
        self.suppressed.iter_mut().for_each(|s| *s = false);
        self.adopted.iter_mut().for_each(|a| *a = None);
        let outcome = catch_unwind(AssertUnwindSafe(|| self.apply(op))).map_err(panic_message)?;
        // Detached editing renews to a random peer id on checkout; pin each
        // renewal to the same fresh id on both sides.
        for p in &mut self.peers {
            if p.doc.peer_id() != p.id {
                self.next_renewed_peer += 1;
                p.id = self.next_renewed_peer;
                p.doc.set_peer_id(p.id).map_err(|e| e.to_string())?;
            }
        }
        let touched = touched(op);
        let mut observations = Vec::with_capacity(self.peers.len());
        for i in 0..self.peers.len() {
            self.peers[i].note_version();
            // Exports commit a pending transaction, so they run only after barriers.
            let export = barrier(op) && touched.contains(&i);
            let observation = catch_unwind(AssertUnwindSafe(|| self.observe(i, export)))
                .map_err(|p| format!("observe: {}", panic_message(p)))?;
            let mut observation = observation;
            if i == touched[0] {
                observation.outcome = Some(crate::normalize(&outcome));
            }
            observations.push(observation);
        }
        Ok(observations)
    }

    fn apply(&mut self, op: &Op) -> String {
        let timestamp = self.clock;
        match op {
            Op::Text { peer, target, edit } => {
                // Upstream text.update unwraps AutoCommitNotStarted on a detached doc
                // (both builds panic); skip it to keep the case running.
                if matches!(edit, TextEdit::Update { .. }) && self.doc(*peer).is_detached() {
                    return "skip: update while detached".into();
                }
                match resolve_text(&self.peers[usize::from(*peer)].doc, *target) {
                    Some(text) => text_edit(&text, edit),
                    None => "no-target".into(),
                }
            }
            Op::MapSet {
                peer,
                key: k,
                value: v,
            } => result(self.doc(*peer).get_map("m").insert(key(*k), value(*v))),
            Op::MapDelete { peer, key: k } => result(self.doc(*peer).get_map("m").delete(key(*k))),
            Op::MapText { peer, key: k } => result(
                self.doc(*peer)
                    .get_map("m")
                    .insert_container(key(*k), TextHandler::new_detached())
                    .map(|t| t.id()),
            ),
            Op::ListInsert {
                peer,
                pos,
                value: v,
            } => {
                let list = self.doc(*peer).get_list("l");
                result(list.insert(modulo(*pos, list.len() + 1), value(*v)))
            }
            Op::ListText { peer, pos } => {
                let list = self.doc(*peer).get_list("l");
                result(
                    list.insert_container(
                        modulo(*pos, list.len() + 1),
                        TextHandler::new_detached(),
                    )
                    .map(|t| t.id()),
                )
            }
            Op::ListDelete { peer, pos, len } => {
                let list = self.doc(*peer).get_list("l");
                let n = list.len();
                let pos = modulo(*pos, n + 1);
                result(list.delete(pos, usize::from(*len).min(n - pos)))
            }
            Op::MovInsert {
                peer,
                pos,
                value: v,
            } => {
                let list = self.doc(*peer).get_movable_list("ml");
                result(list.insert(modulo(*pos, list.len() + 1), value(*v)))
            }
            Op::MovText { peer, pos } => {
                let list = self.doc(*peer).get_movable_list("ml");
                result(
                    list.insert_container(
                        modulo(*pos, list.len() + 1),
                        TextHandler::new_detached(),
                    )
                    .map(|t| t.id()),
                )
            }
            Op::MovDelete { peer, pos, len } => {
                let list = self.doc(*peer).get_movable_list("ml");
                let n = list.len();
                let pos = modulo(*pos, n + 1);
                result(list.delete(pos, usize::from(*len).min(n - pos)))
            }
            Op::MovMove { peer, from, to } => {
                let list = self.doc(*peer).get_movable_list("ml");
                let n = list.len();
                if n == 0 {
                    return "empty".into();
                }
                result(list.mov(modulo(*from, n), modulo(*to, n)))
            }
            Op::MovSet {
                peer,
                pos,
                value: v,
            } => {
                let list = self.doc(*peer).get_movable_list("ml");
                let n = list.len();
                if n == 0 {
                    return "empty".into();
                }
                result(list.set(modulo(*pos, n), value(*v)))
            }
            Op::TreeCreate {
                peer,
                parent,
                index,
            } => {
                let tree = self.doc(*peer).get_tree("tr");
                let nodes = tree.nodes();
                let parent = tree_parent(&nodes, *parent);
                let n = tree.children_num(&parent).unwrap_or(0);
                result(tree.create_at(parent, modulo(*index, n + 1)))
            }
            Op::TreeMove { peer, node, parent } => {
                let tree = self.doc(*peer).get_tree("tr");
                let nodes = tree.nodes();
                match tree_node(&nodes, *node) {
                    Some(target) => result(tree.mov(target, tree_parent(&nodes, *parent))),
                    None => "empty".into(),
                }
            }
            Op::TreeMoveAfter { peer, node, other } => {
                let tree = self.doc(*peer).get_tree("tr");
                let nodes = tree.nodes();
                match (tree_node(&nodes, *node), tree_node(&nodes, *other)) {
                    (Some(a), Some(b)) => result(tree.mov_after(a, b)),
                    _ => "empty".into(),
                }
            }
            Op::TreeDelete { peer, node } => {
                let tree = self.doc(*peer).get_tree("tr");
                let nodes = tree.nodes();
                match tree_node(&nodes, *node) {
                    Some(target) => result(tree.delete(target)),
                    None => "empty".into(),
                }
            }
            Op::TreeMeta {
                peer,
                node,
                key: k,
                value: v,
            } => {
                let tree = self.doc(*peer).get_tree("tr");
                let nodes = tree.nodes();
                match tree_node(&nodes, *node) {
                    Some(target) => result(
                        tree.get_meta(target)
                            .and_then(|m| m.insert(key(*k), value(*v))),
                    ),
                    None => "empty".into(),
                }
            }
            Op::Bulk { peer } => {
                let doc = self.doc(*peer);
                doc.commit_then_renew();
                let unit = "ab😀\n";
                let body: String = unit.chars().cycle().take(BULK_TEXT_LEN).collect();
                let r = doc.get_text("bulk").insert(0, &body, PosType::Unicode);
                doc.commit_then_renew();
                result(r)
            }
            Op::CommitPlain { peer } => {
                self.doc(*peer).commit_then_renew();
                "ok".into()
            }
            Op::CommitExcluded { peer } => {
                drop(
                    self.doc(*peer)
                        .commit_with(commit_options(EXCLUDED_ORIGIN, timestamp)),
                );
                "ok".into()
            }
            Op::CommitEditor { peer } => {
                let p = &self.peers[usize::from(*peer)];
                let out = editor_commit(&p.doc, &p.undo, timestamp);
                self.suppressed[usize::from(*peer)] = out.suppressed;
                if out.projected {
                    self.stats.projected_checkpoints += 1;
                }
                match out.error {
                    Some(e) => format!("err {e}"),
                    None => "ok".into(),
                }
            }
            Op::Sync { from, to } => {
                let to_vv = self.doc(*to).oplog_vv();
                let bytes = match self.doc(*from).export(ExportMode::updates(&to_vv)) {
                    Ok(b) => b,
                    Err(e) => return format!("export err {e}"),
                };
                self.stats.imports += 1;
                let r = self.doc(*to).import(&bytes);
                format!(
                    "{} bytes; {}",
                    bytes.len(),
                    result(r.map(|s| s.pending.is_some()))
                )
            }
            Op::SyncSnapshot { from, to } => {
                let bytes = match self.doc(*from).export(ExportMode::Snapshot) {
                    Ok(b) => b,
                    Err(e) => return format!("export err {e}"),
                };
                self.stats.imports += 1;
                let r = self.doc(*to).import(&bytes);
                format!(
                    "{} bytes; {}",
                    bytes.len(),
                    result(r.map(|s| s.pending.is_some()))
                )
            }
            Op::Undo { peer } => {
                let r = self.peers[usize::from(*peer)].undo.undo();
                if matches!(r, Ok(true)) {
                    self.stats.undos += 1;
                }
                result(r)
            }
            Op::Redo { peer } => {
                let r = self.peers[usize::from(*peer)].undo.redo();
                if matches!(r, Ok(true)) {
                    self.stats.redos += 1;
                }
                result(r)
            }
            Op::GroupStart { peer } => result(self.peers[usize::from(*peer)].undo.group_start()),
            Op::GroupEnd { peer } => {
                self.peers[usize::from(*peer)].undo.group_end();
                "ok".into()
            }
            Op::Checkpoint { peer } => {
                result(self.peers[usize::from(*peer)].undo.record_new_checkpoint())
            }
            Op::DetachedEditing { peer, enable } => {
                self.doc(*peer).set_detached_editing(*enable);
                "ok".into()
            }
            Op::Checkout { peer, at } => {
                let f = self.peers[usize::from(*peer)].recorded(*at);
                result(self.doc(*peer).checkout(&f))
            }
            Op::Attach { peer } => {
                self.doc(*peer).attach();
                "ok".into()
            }
            Op::RevertTo { peer, at } => {
                let f = self.peers[usize::from(*peer)].recorded(*at);
                result(self.doc(*peer).revert_to(&f))
            }
            Op::Reshallow { peer, at } => {
                let p = &self.peers[usize::from(*peer)];
                let f = p.recorded(*at);
                self.replace_from(*peer, *peer, &f)
            }
            Op::AdoptShallow { peer, from, at } => {
                let source = &self.peers[usize::from(*from)];
                let own = self.peers[usize::from(*peer)].doc.oplog_vv();
                // A fresh doc that lacks some of its own peer's ops would reuse their ids.
                if !source.doc.oplog_vv().includes_vv(&own) {
                    return "skip: source lacks own ops".into();
                }
                let f = source.recorded(*at);
                self.replace_from(*peer, *from, &f)
            }
        }
    }

    fn replace_from(&mut self, peer: u8, from: u8, frontiers: &Frontiers) -> String {
        let source = &self.peers[usize::from(from)].doc;
        source.commit_then_renew();
        self.doc(peer).commit_then_renew();
        let source_eligible = cached_prefix_eligible(source, frontiers);
        let bytes = match source.export(ExportMode::shallow_snapshot(frontiers)) {
            Ok(b) => b,
            Err(e) => return format!("export err {e}"),
        };
        let id = self.peers[usize::from(peer)].id;
        match Peer::new(id, &self.config, Some(&bytes)) {
            Ok(fresh) => {
                self.peers[usize::from(peer)] = fresh;
                let decoded = decoded_fingerprint(&bytes);
                self.adopted[usize::from(peer)] = Some(crate::Adoption {
                    from: usize::from(from),
                    source_eligible,
                    bytes,
                });
                format!("replaced; decodes to {decoded}")
            }
            Err(e) => format!("import err {e}"),
        }
    }

    fn doc(&self, peer: u8) -> &LoroDoc {
        &self.peers[usize::from(peer)].doc
    }

    fn observe(&mut self, i: usize, export: bool) -> Observation {
        let p = &self.peers[i];
        let doc = &p.doc;
        let mut exports = Vec::new();
        let mut shallow: Vec<(String, bool, String)> = Vec::new();
        if export {
            let mut push = |name: String, r: Result<Vec<u8>, li::LoroEncodeError>| {
                exports.push((name, r.map_err(|e| crate::normalize(&e.to_string()))));
            };
            {
                let name = "snapshot".to_string();
                let bytes = doc.export(ExportMode::Snapshot);
                shallow.push((
                    name.clone(),
                    false,
                    bytes
                        .as_ref()
                        .map_or(String::new(), |b| decoded_fingerprint(b)),
                ));
                push(name, bytes);
            }
            push("all_updates".into(), doc.export(ExportMode::all_updates()));
            for (j, other) in self.peers.iter().enumerate() {
                let vv = other.doc.oplog_vv();
                push(
                    format!("updates_since_peer{j}"),
                    doc.export(ExportMode::updates(&vv)),
                );
            }
            let n = p.history.len();
            let mid = n / 2;
            push(
                format!("updates_since_h{mid}"),
                doc.export(ExportMode::updates(&p.history_vv[mid])),
            );
            {
                let name = "state_only".to_string();
                let bytes = doc.export(ExportMode::state_only(None));
                shallow.push((
                    name.clone(),
                    false,
                    bytes
                        .as_ref()
                        .map_or(String::new(), |b| decoded_fingerprint(b)),
                ));
                push(name, bytes);
            }
            {
                let name = format!("snapshot_at_h{mid}");
                let bytes = doc.export(ExportMode::snapshot_at(&p.history[mid]));
                shallow.push((
                    name.clone(),
                    false,
                    bytes
                        .as_ref()
                        .map_or(String::new(), |b| decoded_fingerprint(b)),
                ));
                push(name, bytes);
            }
            let shallow_root = doc.shallow_since_frontiers();
            let mut targets = vec![("shallow_root".to_string(), shallow_root.clone())];
            targets.push(("latest".into(), doc.oplog_frontiers()));
            for at in [1, mid, n.saturating_sub(2), n.saturating_sub(1)] {
                if at < n {
                    targets.push((format!("h{at}"), p.history[at].clone()));
                }
            }
            for (name, f) in targets {
                self.stats.shallow_exports += 1;
                let eligible = cached_prefix_eligible(doc, &f);
                if eligible {
                    self.stats.cached_prefix_eligible += 1;
                }
                let bytes = doc.export(ExportMode::shallow_snapshot(&f));
                let decoded = match &bytes {
                    Ok(b) => decoded_fingerprint(b),
                    Err(_) => String::new(),
                };
                shallow.push((format!("shallow@{name}"), eligible, decoded));
                push(format!("shallow@{name}"), bytes);
            }
        }
        // Exports commit pending ops; their events belong to this step.
        let recorded = std::mem::take(&mut *self.peers[i].events.lock().unwrap());
        let mut events = Vec::with_capacity(recorded.len());
        let mut event_from = Vec::with_capacity(recorded.len());
        let mut event_to = Vec::with_capacity(recorded.len());
        for (public, from, to) in recorded {
            events.push(public);
            event_from.push(from);
            event_to.push(to);
        }
        let undo_log = std::mem::take(&mut *self.peers[i].undo_log.lock().unwrap());
        let p = &self.peers[i];
        let doc = &p.doc;
        Observation {
            peer: i,
            outcome: None,
            value: canonical(&doc.get_deep_value()),
            value_with_id: canonical(&doc.get_deep_value_with_id()),
            oplog_vv: sorted_vv(&doc.oplog_vv()),
            state_vv: sorted_vv(&doc.state_vv()),
            oplog_frontiers: sorted_frontiers(&doc.oplog_frontiers()),
            state_frontiers: sorted_frontiers(&doc.state_frontiers()),
            shallow_since: sorted_frontiers(&doc.shallow_since_frontiers()),
            detached: doc.is_detached(),
            undo: (
                p.undo.undo_count(),
                p.undo.redo_count(),
                p.undo.can_undo(),
                p.undo.can_redo(),
            ),
            events,
            event_from,
            event_to,
            undo_log,
            exports,
            shallow,
            adopted: self.adopted[i].clone(),
            suppressed: self.suppressed[i],
        }
    }
}

/// Whether a shallow export at `f` meets every condition of the cached-prefix
/// path in a non-test build: attached, shallow, past the cached root, and a
/// retained tail at or above the forward-replay gate.
fn cached_prefix_eligible(doc: &LoroDoc, f: &Frontiers) -> bool {
    if doc.state_frontiers() != doc.oplog_frontiers()
        || !doc.is_shallow()
        || *f == doc.shallow_since_frontiers()
    {
        return false;
    }
    let Some(vv) = doc.frontiers_to_vv(f) else {
        return false;
    };
    let tail: usize = doc
        .oplog_vv()
        .sub_iter(&vv)
        .map(|s| (s.counter.end - s.counter.start).unsigned_abs() as usize)
        .sum();
    tail >= MIN_RETAINED_OPS_FOR_FORWARD_ROOT_STATE
}

/// Everything a shallow snapshot decodes to: latest state with ids, shallow
/// root, versions, the state at the root, and the retained history as JSON.
fn decoded_fingerprint(bytes: &[u8]) -> String {
    let doc = LoroDoc::new();
    if let Err(e) = doc.import(bytes) {
        return format!("import err {}", crate::normalize(&e.to_string()));
    }
    let root = doc.shallow_since_frontiers();
    let history = doc
        .export_json_updates(&doc.shallow_since_vv().to_vv(), &doc.oplog_vv(), false)
        .map(|json| serde_json::to_string(&json).unwrap_or_default())
        .unwrap_or_else(|e| format!("json err {}", crate::normalize(&e.to_string())));
    let latest = canonical(&doc.get_deep_value_with_id());
    let at_root = match doc.checkout(&root) {
        Ok(()) => canonical(&doc.get_deep_value_with_id()),
        Err(e) => format!("checkout err {}", crate::normalize(&e.to_string())),
    };
    format!(
        "root={:?} vv={:?} latest={latest} at_root={at_root} history={history}",
        sorted_frontiers(&root),
        sorted_vv(&doc.oplog_vv())
    )
}

fn barrier(op: &Op) -> bool {
    matches!(
        op,
        Op::Bulk { .. }
            | Op::CommitPlain { .. }
            | Op::CommitEditor { .. }
            | Op::CommitExcluded { .. }
            | Op::Sync { .. }
            | Op::SyncSnapshot { .. }
            | Op::Undo { .. }
            | Op::Redo { .. }
            | Op::Checkpoint { .. }
            | Op::Checkout { .. }
            | Op::Attach { .. }
            | Op::RevertTo { .. }
            | Op::Reshallow { .. }
            | Op::AdoptShallow { .. }
    )
}

fn touched(op: &Op) -> Vec<usize> {
    match op {
        Op::Sync { from, to } | Op::SyncSnapshot { from, to } => {
            vec![usize::from(*to), usize::from(*from)]
        }
        Op::AdoptShallow { peer, from, .. } => vec![usize::from(*peer), usize::from(*from)],
        Op::Text { peer, .. }
        | Op::MapSet { peer, .. }
        | Op::MapDelete { peer, .. }
        | Op::MapText { peer, .. }
        | Op::ListInsert { peer, .. }
        | Op::ListText { peer, .. }
        | Op::ListDelete { peer, .. }
        | Op::MovInsert { peer, .. }
        | Op::MovText { peer, .. }
        | Op::MovDelete { peer, .. }
        | Op::MovMove { peer, .. }
        | Op::MovSet { peer, .. }
        | Op::TreeCreate { peer, .. }
        | Op::TreeMove { peer, .. }
        | Op::TreeMoveAfter { peer, .. }
        | Op::TreeDelete { peer, .. }
        | Op::TreeMeta { peer, .. }
        | Op::Bulk { peer }
        | Op::CommitPlain { peer }
        | Op::CommitEditor { peer }
        | Op::CommitExcluded { peer }
        | Op::Undo { peer }
        | Op::Redo { peer }
        | Op::GroupStart { peer }
        | Op::GroupEnd { peer }
        | Op::Checkpoint { peer }
        | Op::DetachedEditing { peer, .. }
        | Op::Checkout { peer, .. }
        | Op::Attach { peer }
        | Op::RevertTo { peer, .. }
        | Op::Reshallow { peer, .. } => vec![usize::from(*peer)],
    }
}
