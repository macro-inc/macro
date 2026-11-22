//! Differential runner for the editor's patched loro-internal.
//!
//! One seeded operation script drives two sets of peers: one built on the
//! patched `../loro-internal`, one on crates.io loro-internal 1.17.1. After
//! every step both sides report a crate-neutral [`Observation`]; any
//! difference is a divergence. Failing scripts are shrunk and printed with
//! their seed.

use std::fmt;

mod side;
#[cfg(test)]
mod test;

/// Number of peers in every case.
pub const PEERS: usize = 3;
/// Origin of editor-owned local commits; matches lexical_loro's LOCAL_ORIGIN role.
pub const LOCAL_ORIGIN: &str = "local";
/// Origin prefix the undo managers exclude, like the session's fixups.
pub const EXCLUDED_ORIGIN: &str = "fixup:repair";
/// Excluded origin prefix registered on every undo manager.
pub const EXCLUDED_PREFIX: &str = "fixup";
/// Text length of a bulk insertion: above the 65,536 retained ops that gate the
/// forward-replay shallow export in non-test builds of loro-internal.
pub const BULK_TEXT_LEN: usize = 70_000;

/// Strings inserted into text containers; mixes UTF-8 widths and surrogate pairs.
pub const STRINGS: &[&str] = &["a", "hé", "😀x", "line\n", "—“q”", "abc", "ß😀😀", ""];
/// Style keys: configured by default (bold, link, comment) and unconfigured.
pub const MARK_KEYS: &[&str] = &["bold", "italic", "link", "comment", "x-custom"];
/// Map and tree-meta keys.
pub const KEYS: &[&str] = &["k0", "k1", "k2", "child", "list"];

/// Text position unit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unit {
    /// Unicode scalar values.
    Unicode,
    /// UTF-16 code units.
    Utf16,
    /// UTF-8 bytes.
    Bytes,
    /// Event units (Unicode natively).
    Event,
}

/// The text container an operation edits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextTarget {
    /// Root text "t".
    Root,
    /// The text child under a root map key, if any.
    MapChild(u8),
    /// The text child at an index of root list "l", if any.
    ListChild(u16),
    /// The text child at an index of root movable list "ml", if any.
    MovableChild(u16),
}

/// A text edit; positions are reduced modulo the current length in that unit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TextEdit {
    /// Insert a pooled string.
    Insert { pos: u32, s: u8, unit: Unit },
    /// Delete a range.
    Delete { pos: u32, len: u8, unit: Unit },
    /// Apply a style.
    Mark {
        start: u32,
        len: u8,
        key: u8,
        value: i8,
        unit: Unit,
    },
    /// Remove a style.
    Unmark {
        start: u32,
        len: u8,
        key: u8,
        unit: Unit,
    },
    /// Replace the whole text through Loro's diff update.
    Update { s: u8, suffix: u8 },
}

/// A primitive value for maps, lists and tree metadata.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Value {
    /// Integer.
    I(i32),
    /// Pooled string.
    S(u8),
    /// Boolean.
    B(bool),
    /// Null.
    Null,
}

/// One scripted step.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Op {
    /// Edit a text container.
    Text {
        peer: u8,
        target: TextTarget,
        edit: TextEdit,
    },
    /// Set a root map key.
    MapSet { peer: u8, key: u8, value: Value },
    /// Delete a root map key.
    MapDelete { peer: u8, key: u8 },
    /// Put a fresh text container under a root map key.
    MapText { peer: u8, key: u8 },
    /// Insert into root list "l".
    ListInsert { peer: u8, pos: u16, value: Value },
    /// Insert a text container into root list "l".
    ListText { peer: u8, pos: u16 },
    /// Delete from root list "l".
    ListDelete { peer: u8, pos: u16, len: u8 },
    /// Insert into root movable list "ml".
    MovInsert { peer: u8, pos: u16, value: Value },
    /// Insert a text container into root movable list "ml".
    MovText { peer: u8, pos: u16 },
    /// Delete from "ml".
    MovDelete { peer: u8, pos: u16, len: u8 },
    /// Move within "ml".
    MovMove { peer: u8, from: u16, to: u16 },
    /// Set an element of "ml".
    MovSet { peer: u8, pos: u16, value: Value },
    /// Create a tree node under a selected parent (or root) at a selected index.
    TreeCreate { peer: u8, parent: u16, index: u16 },
    /// Move a selected node under a selected parent.
    TreeMove { peer: u8, node: u16, parent: u16 },
    /// Move a selected node after another.
    TreeMoveAfter { peer: u8, node: u16, other: u16 },
    /// Delete a selected node.
    TreeDelete { peer: u8, node: u16 },
    /// Set a key in a selected node's metadata map.
    TreeMeta {
        peer: u8,
        node: u16,
        key: u8,
        value: Value,
    },
    /// Insert [`BULK_TEXT_LEN`] characters into root text "bulk" in one op span.
    Bulk { peer: u8 },
    /// Commit with no origin.
    CommitPlain { peer: u8 },
    /// Commit as an editor-owned local projection: the patched side takes the
    /// opt-in suppressed-recording and projected-checkpoint path.
    CommitEditor { peer: u8 },
    /// Commit with the excluded fixup origin.
    CommitExcluded { peer: u8 },
    /// Send `from`'s updates since `to`'s version to `to`.
    Sync { from: u8, to: u8 },
    /// Import `from`'s full snapshot into `to`.
    SyncSnapshot { from: u8, to: u8 },
    /// Undo.
    Undo { peer: u8 },
    /// Redo.
    Redo { peer: u8 },
    /// Start an undo group.
    GroupStart { peer: u8 },
    /// End an undo group.
    GroupEnd { peer: u8 },
    /// Force an undo checkpoint.
    Checkpoint { peer: u8 },
    /// Pause or resume undo recording... not in this API: toggles detached editing.
    DetachedEditing { peer: u8, enable: bool },
    /// Check out a recorded frontier.
    Checkout { peer: u8, at: u16 },
    /// Return to the latest version.
    Attach { peer: u8 },
    /// Revert to a recorded frontier (new ops).
    RevertTo { peer: u8, at: u16 },
    /// Replace a peer's document by its own shallow snapshot at a recorded frontier.
    Reshallow { peer: u8, at: u16 },
    /// Replace a peer's document by a fresh doc importing another peer's shallow snapshot.
    AdoptShallow { peer: u8, from: u8, at: u16 },
}

/// How undo groups merge consecutive checkpoints.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MergeRegime {
    /// Merge interval 0: never merge (any clock).
    Never,
    /// Huge merge interval: always merge (any monotone clock).
    Always,
    /// Patched side: interval 500 with a 1000 ms stepping injected clock (never
    /// merges); upstream: interval 0.
    InjectedNever,
    /// Patched side: interval 500 with a frozen injected clock (always merges);
    /// upstream: huge interval.
    InjectedAlways,
}

/// Per-case configuration shared by both sides.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    /// Undo merge regime.
    pub merge: MergeRegime,
    /// Maximum undo steps, if bounded.
    pub max_undo: Option<u8>,
}

/// A generated case.
#[derive(Debug, Clone)]
pub struct Case {
    /// Seed that generated it.
    pub seed: u64,
    /// Configuration.
    pub config: Config,
    /// Steps.
    pub ops: Vec<Op>,
}

/// Everything compared after a step, in crate-neutral form.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Observation {
    /// Peer observed.
    pub peer: usize,
    /// Result of the step on this peer, if it ran here.
    pub outcome: Option<String>,
    /// Deep value as canonical JSON.
    pub value: String,
    /// Deep value with container ids as canonical JSON.
    pub value_with_id: String,
    /// Oplog version vector, sorted.
    pub oplog_vv: Vec<(u64, i32)>,
    /// State version vector, sorted.
    pub state_vv: Vec<(u64, i32)>,
    /// Oplog frontiers, sorted.
    pub oplog_frontiers: Vec<(u64, i32)>,
    /// State frontiers, sorted.
    pub state_frontiers: Vec<(u64, i32)>,
    /// Shallow-since frontiers, sorted.
    pub shallow_since: Vec<(u64, i32)>,
    /// Detached flag.
    pub detached: bool,
    /// Undo/redo counts and availability.
    pub undo: (usize, usize, bool, bool),
    /// Events delivered during the step (Debug form).
    pub events: Vec<String>,
    /// Internal `DocDiff::from` of each event (not exposed by the loro facade).
    pub event_from: Vec<String>,
    /// Internal `DocDiff::to` of each event.
    pub event_to: Vec<String>,
    /// Undo push/pop callbacks during the step.
    pub undo_log: Vec<String>,
    /// Exports, keyed by mode description.
    pub exports: Vec<(String, Result<Vec<u8>, String>)>,
    /// Snapshot-type exports: name, cached-prefix eligibility, decoded fingerprint.
    pub shallow: Vec<(String, bool, String)>,
    /// The shallow reload this peer adopted during the step, if any.
    pub adopted: Option<Adoption>,
    /// Whether the patched side took the suppressed path (patched side only).
    pub suppressed: bool,
}

/// A shallow reload: the peer's document was replaced by a fresh one
/// importing a shallow export of `from` (itself, for a reshallow).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Adoption {
    /// Peer whose export was adopted.
    pub from: usize,
    /// Whether that export met the cached-prefix conditions.
    pub source_eligible: bool,
    /// Adopted bytes.
    pub bytes: Vec<u8>,
}

/// One step's difference between the sides.
#[derive(Debug, Clone)]
pub struct Divergence {
    /// Step index.
    pub step: usize,
    /// Field that differs.
    pub field: String,
    /// Patched rendering.
    pub patched: String,
    /// Upstream rendering.
    pub upstream: String,
}

impl fmt::Display for Divergence {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "step {} field {}\n  patched:  {}\n  upstream: {}",
            self.step, self.field, self.patched, self.upstream
        )
    }
}

/// Totals for a run.
#[derive(Debug, Default, Clone)]
pub struct Stats {
    /// Steps executed.
    pub steps: usize,
    /// Editor commits that took the patched suppressed path.
    pub suppressed_commits: usize,
    /// Projected checkpoints recorded on the patched side.
    pub projected_checkpoints: usize,
    /// Shallow exports compared.
    pub shallow_exports: usize,
    /// Eligible shallow exports whose bytes differed while decoding identically
    /// (text fragmentation in the cached root; see tests/regressions.rs).
    pub cached_prefix_byte_diffs: usize,
    /// Snapshot-type exports whose bytes differed, decoding identically, after
    /// the case already carried an accepted fragmentation difference.
    pub inherited_byte_diffs: usize,
    /// Shallow exports that met every cached-prefix eligibility condition.
    pub cached_prefix_eligible: usize,
    /// Successful undo calls.
    pub undos: usize,
    /// Successful redo calls.
    pub redos: usize,
    /// Imports performed.
    pub imports: usize,
    /// Both sides panicked identically (an upstream defect, not a divergence).
    pub shared_panics: usize,
    /// Normalized messages of shared panics.
    pub shared_panic_messages: Vec<String>,
    /// Steps whose events differed only in internal `DocDiff::from` (lenient mode).
    pub event_from_only: usize,
}

/// Whether internal `DocDiff::from` differences fail a run. Strict by default;
/// LORO_DIFF_LENIENT_EVENT_FROM=1 counts them instead (to keep fuzzing for
/// other divergences while one is known).
pub fn strict_event_from() -> bool {
    knob("LORO_DIFF_LENIENT_EVENT_FROM").is_none_or(|v| v != "1")
}

/// A test knob from the process environment. This standalone test tool has no
/// service configuration; the workspace config macros do not apply.
#[expect(
    clippy::disallowed_methods,
    reason = "test-run knobs, not service config"
)]
pub fn knob(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

impl Stats {
    /// Add another run's totals.
    pub fn add(&mut self, other: &Stats) {
        self.steps += other.steps;
        self.suppressed_commits += other.suppressed_commits;
        self.projected_checkpoints += other.projected_checkpoints;
        self.shallow_exports += other.shallow_exports;
        self.cached_prefix_byte_diffs += other.cached_prefix_byte_diffs;
        self.inherited_byte_diffs += other.inherited_byte_diffs;
        self.cached_prefix_eligible += other.cached_prefix_eligible;
        self.undos += other.undos;
        self.redos += other.redos;
        self.imports += other.imports;
        self.shared_panics += other.shared_panics;
        self.event_from_only += other.event_from_only;
        self.shared_panic_messages
            .extend(other.shared_panic_messages.iter().cloned());
    }
}

/// SplitMix64: small, seedable, stable across platforms.
#[derive(Debug, Clone)]
pub struct Rng(u64);

impl Rng {
    /// Seeded generator.
    pub fn new(seed: u64) -> Self {
        Self(seed ^ 0x5DEE_CE66_D1CE_4E5B)
    }
    /// Next 64 bits.
    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    /// Uniform below `n` (n > 0).
    pub fn below(&mut self, n: u64) -> u64 {
        self.next_u64() % n
    }
    fn u8(&mut self, n: u8) -> u8 {
        self.below(u64::from(n)) as u8
    }
    fn u16(&mut self) -> u16 {
        self.next_u64() as u16
    }
    fn u32(&mut self) -> u32 {
        self.next_u64() as u32
    }
    fn chance(&mut self, percent: u64) -> bool {
        self.below(100) < percent
    }
}

fn gen_unit(rng: &mut Rng) -> Unit {
    match rng.below(10) {
        0..=4 => Unit::Unicode,
        5..=6 => Unit::Utf16,
        7..=8 => Unit::Bytes,
        _ => Unit::Event,
    }
}

fn gen_value(rng: &mut Rng) -> Value {
    match rng.below(4) {
        0 => Value::I(rng.below(1000) as i32 - 500),
        1 => Value::S(rng.u8(STRINGS.len() as u8)),
        2 => Value::B(rng.chance(50)),
        _ => Value::Null,
    }
}

fn gen_text_edit(rng: &mut Rng) -> TextEdit {
    match rng.below(20) {
        0..=8 => TextEdit::Insert {
            pos: rng.u32(),
            s: rng.u8(STRINGS.len() as u8),
            unit: gen_unit(rng),
        },
        9..=12 => TextEdit::Delete {
            pos: rng.u32(),
            len: rng.u8(6),
            unit: gen_unit(rng),
        },
        13..=16 => TextEdit::Mark {
            start: rng.u32(),
            len: rng.u8(8),
            key: rng.u8(MARK_KEYS.len() as u8),
            value: rng.below(3) as i8 - 1,
            unit: gen_unit(rng),
        },
        17..=18 => TextEdit::Unmark {
            start: rng.u32(),
            len: rng.u8(8),
            key: rng.u8(MARK_KEYS.len() as u8),
            unit: gen_unit(rng),
        },
        _ => TextEdit::Update {
            s: rng.u8(STRINGS.len() as u8),
            suffix: rng.u8(STRINGS.len() as u8),
        },
    }
}

fn gen_text_target(rng: &mut Rng) -> TextTarget {
    match rng.below(10) {
        0..=5 => TextTarget::Root,
        6 => TextTarget::MapChild(rng.u8(KEYS.len() as u8)),
        7..=8 => TextTarget::ListChild(rng.u16()),
        _ => TextTarget::MovableChild(rng.u16()),
    }
}

/// Generate a case from a seed. `len` bounds the script; `bulk` allows
/// [`Op::Bulk`] steps (slow, needed for the cached-prefix shallow export).
pub fn generate(seed: u64, len: usize, bulk: bool) -> Case {
    let mut rng = Rng::new(seed);
    let merge = match rng.below(4) {
        0 => MergeRegime::Never,
        1 => MergeRegime::Always,
        2 => MergeRegime::InjectedNever,
        _ => MergeRegime::InjectedAlways,
    };
    let max_undo = rng.chance(20).then(|| 1 + rng.u8(4));
    let mut ops = Vec::with_capacity(len);
    let peers = PEERS as u8;
    // Each case leans on a few peers so concurrency and undo interleave.
    for _ in 0..len {
        let peer = rng.u8(peers);
        let op = match rng.below(100) {
            0..=21 => Op::Text {
                peer,
                target: gen_text_target(&mut rng),
                edit: gen_text_edit(&mut rng),
            },
            22..=25 => Op::MapSet {
                peer,
                key: rng.u8(KEYS.len() as u8),
                value: gen_value(&mut rng),
            },
            26 => Op::MapDelete {
                peer,
                key: rng.u8(KEYS.len() as u8),
            },
            27 => Op::MapText {
                peer,
                key: rng.u8(KEYS.len() as u8),
            },
            28..=29 => Op::ListInsert {
                peer,
                pos: rng.u16(),
                value: gen_value(&mut rng),
            },
            30 => Op::ListText {
                peer,
                pos: rng.u16(),
            },
            31 => Op::ListDelete {
                peer,
                pos: rng.u16(),
                len: rng.u8(3),
            },
            32..=33 => Op::MovInsert {
                peer,
                pos: rng.u16(),
                value: gen_value(&mut rng),
            },
            34 => Op::MovText {
                peer,
                pos: rng.u16(),
            },
            35 => Op::MovDelete {
                peer,
                pos: rng.u16(),
                len: rng.u8(3),
            },
            36..=37 => Op::MovMove {
                peer,
                from: rng.u16(),
                to: rng.u16(),
            },
            38 => Op::MovSet {
                peer,
                pos: rng.u16(),
                value: gen_value(&mut rng),
            },
            39..=41 => Op::TreeCreate {
                peer,
                parent: rng.u16(),
                index: rng.u16(),
            },
            42 => Op::TreeMove {
                peer,
                node: rng.u16(),
                parent: rng.u16(),
            },
            43 => Op::TreeMoveAfter {
                peer,
                node: rng.u16(),
                other: rng.u16(),
            },
            44 => Op::TreeDelete {
                peer,
                node: rng.u16(),
            },
            45..=46 => Op::TreeMeta {
                peer,
                node: rng.u16(),
                key: rng.u8(KEYS.len() as u8),
                value: gen_value(&mut rng),
            },
            47..=49 => Op::CommitPlain { peer },
            50..=61 => Op::CommitEditor { peer },
            62..=63 => Op::CommitExcluded { peer },
            64..=70 => {
                let to = (peer + 1 + rng.u8(peers - 1)) % peers;
                Op::Sync { from: peer, to }
            }
            71 => {
                let to = (peer + 1 + rng.u8(peers - 1)) % peers;
                Op::SyncSnapshot { from: peer, to }
            }
            72..=78 => Op::Undo { peer },
            79..=82 => Op::Redo { peer },
            83..=84 => Op::GroupStart { peer },
            85..=86 => Op::GroupEnd { peer },
            87 => Op::Checkpoint { peer },
            88 => Op::DetachedEditing {
                peer,
                enable: rng.chance(50),
            },
            89..=90 => Op::Checkout {
                peer,
                at: rng.u16(),
            },
            91..=92 => Op::Attach { peer },
            93 => Op::RevertTo {
                peer,
                at: rng.u16(),
            },
            94..=95 => Op::Reshallow {
                peer,
                at: rng.u16(),
            },
            96..=97 => Op::AdoptShallow {
                peer,
                from: (peer + 1 + rng.u8(peers - 1)) % peers,
                at: rng.u16(),
            },
            _ if bulk => Op::Bulk { peer },
            _ => Op::CommitEditor { peer },
        };
        ops.push(op);
    }
    Case {
        seed,
        config: Config { merge, max_undo },
        ops,
    }
}

/// Run a script on both sides and return the first divergence, if any.
pub fn run(config: &Config, ops: &[Op], stats: &mut Stats) -> Option<Divergence> {
    let mut patched = side::patched::World::new(config);
    let mut upstream = side::upstream::World::new(config);
    // Peers whose live document descends from an adopted snapshot that encoded
    // the same state with different text fragmentation.
    let mut fragmented = [false; PEERS];
    for (step, op) in ops.iter().enumerate() {
        // An upstream panic whose unwinding panics again aborts the process
        // before the other side runs the step; LORO_DIFF_UPSTREAM_FIRST=1
        // shows whether upstream aborts at the same place.
        let (p, u) = if knob("LORO_DIFF_UPSTREAM_FIRST").is_some_and(|v| v == "1") {
            let u = upstream.step(op);
            (patched.step(op), u)
        } else {
            let p = patched.step(op);
            (p, upstream.step(op))
        };
        stats.steps += 1;
        let (p, u) = match (p, u) {
            (Ok(p), Ok(u)) => (p, u),
            // A panicked document holds poisoned locks and panics again on
            // drop; leak both worlds on every panic path.
            (Err(p), Err(u)) if crate::normalize_panic(&p) == crate::normalize_panic(&u) => {
                stats.shared_panics += 1;
                stats.shared_panic_messages.push(crate::normalize_panic(&p));
                std::mem::forget(patched);
                std::mem::forget(upstream);
                return None;
            }
            (p, u) => {
                std::mem::forget(patched);
                std::mem::forget(upstream);
                return Some(Divergence {
                    step,
                    field: "panic".into(),
                    patched: format!("{:?}", p.err()),
                    upstream: format!("{:?}", u.err()),
                });
            }
        };
        for (p, u) in p.iter().zip(u.iter()) {
            if let Some(d) = compare(step, p, u, stats, &mut fragmented) {
                return Some(d);
            }
            if p.suppressed {
                stats.suppressed_commits += 1;
            }
        }
        stats.add(&patched.take_stats());
        let _ = upstream.take_stats();
    }
    None
}

fn render_bytes(r: &Result<Vec<u8>, String>) -> String {
    match r {
        Ok(b) => format!("Ok({} bytes, {:016x})", b.len(), fnv(b)),
        Err(e) => format!("Err({e})"),
    }
}

fn fnv(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325u64, |h, b| {
        (h ^ u64::from(*b)).wrapping_mul(0x100_0000_01b3)
    })
}

pub(crate) fn compare(
    step: usize,
    p: &Observation,
    u: &Observation,
    stats: &mut Stats,
    fragmented: &mut [bool; PEERS],
) -> Option<Divergence> {
    macro_rules! field {
        ($name:ident) => {
            if p.$name != u.$name {
                return Some(Divergence {
                    step,
                    field: format!("peer{}.{}", p.peer, stringify!($name)),
                    patched: format!("{:?}", p.$name),
                    upstream: format!("{:?}", u.$name),
                });
            }
        };
    }
    field!(outcome);
    field!(value);
    field!(value_with_id);
    field!(oplog_vv);
    field!(state_vv);
    field!(oplog_frontiers);
    field!(state_frontiers);
    field!(shallow_since);
    field!(detached);
    field!(undo);
    field!(undo_log);
    // A suppressed editor commit delivers no local event on the patched side by
    // design; the upstream side's ordinary event for that step is not compared.
    if p.suppressed {
        if !p.events.is_empty() {
            return Some(Divergence {
                step,
                field: format!("peer{}.events (suppressed commit delivered events)", p.peer),
                patched: format!("{:?}", p.events),
                upstream: "<suppressed>".into(),
            });
        }
    } else {
        field!(events);
        field!(event_to);
        if p.event_from != u.event_from {
            if strict_event_from() {
                field!(event_from);
            }
            stats.event_from_only += 1;
        }
    }
    if p.exports.len() != u.exports.len() {
        return Some(Divergence {
            step,
            field: format!("peer{}.exports.len", p.peer),
            patched: format!("{:?}", p.exports.iter().map(|e| &e.0).collect::<Vec<_>>()),
            upstream: format!("{:?}", u.exports.iter().map(|e| &e.0).collect::<Vec<_>>()),
        });
    }
    field!(shallow);
    // A shallow reload replaces the peer's lineage. Its decoded fingerprint
    // (the outcome) already matched. Differing bytes are accepted only from a
    // cached-prefix export or from an already fragmented source lineage.
    match (&p.adopted, &u.adopted) {
        (Some(pa), Some(ua)) if pa.from == ua.from => {
            let differs = pa.bytes != ua.bytes;
            if differs && !(pa.source_eligible || fragmented[pa.from]) {
                return Some(Divergence {
                    step,
                    field: format!("peer{}.adopted bytes from peer{}", p.peer, pa.from),
                    patched: format!("{} bytes, {:016x}", pa.bytes.len(), fnv(&pa.bytes)),
                    upstream: format!("{} bytes, {:016x}", ua.bytes.len(), fnv(&ua.bytes)),
                });
            }
            if differs {
                stats.inherited_byte_diffs += 1;
            }
            fragmented[p.peer] = differs;
        }
        (None, None) => {}
        _ => field!(adopted),
    }
    for ((pm, pr), (um, ur)) in p.exports.iter().zip(u.exports.iter()) {
        // A cached-prefix export may encode the same decoded state with
        // different text fragmentation (`shallow` already matched). Exporting
        // leaves the peer's own state untouched; only a fragmented lineage
        // may differ in later snapshot-type bytes. Update exports never may.
        let entry = p.shallow.iter().find(|(name, _, _)| name == pm);
        if pm == um && pr.is_ok() && ur.is_ok() && pr != ur {
            match entry {
                Some((_, true, _)) => {
                    stats.cached_prefix_byte_diffs += 1;
                    continue;
                }
                Some((_, false, _)) if fragmented[p.peer] => {
                    stats.inherited_byte_diffs += 1;
                    continue;
                }
                _ => {}
            }
        }
        if pm != um || pr != ur {
            return Some(Divergence {
                step,
                field: format!("peer{}.export[{pm} | {um}]", p.peer),
                patched: render_bytes(pr),
                upstream: render_bytes(ur),
            });
        }
    }
    None
}

/// Shrink a failing script by greedy chunk removal; returns the smallest
/// script found that still diverges (any field).
pub fn shrink(config: &Config, ops: &[Op]) -> Vec<Op> {
    let fails = |ops: &[Op]| run(config, ops, &mut Stats::default()).is_some();
    let mut current = ops.to_vec();
    // Steps after the first divergence never matter.
    if let Some(d) = run(config, &current, &mut Stats::default()) {
        current.truncate(d.step + 1);
    }
    let mut chunk = current.len().max(1) / 2;
    while chunk >= 1 {
        let mut i = 0;
        let mut progressed = false;
        while i < current.len() {
            let end = (i + chunk).min(current.len());
            let mut candidate = current.clone();
            candidate.drain(i..end);
            if !candidate.is_empty() && fails(&candidate) {
                current = candidate;
                progressed = true;
            } else {
                i += chunk;
            }
        }
        if !progressed {
            chunk /= 2;
        }
    }
    current
}

/// A case aimed at the cached-prefix shallow export: a random prefix, a
/// shallow reload, retained edits, a bulk tail above the forward-replay gate,
/// then more random steps.
pub fn generate_bulk(seed: u64, len: usize) -> Case {
    let mut base = generate(seed, len, false);
    let mut rng = Rng::new(seed ^ 0xB0_1C);
    let peer = rng.u8(PEERS as u8);
    let split = len / 3;
    let mut ops = base.ops[..split].to_vec();
    ops.push(Op::CommitPlain { peer });
    ops.push(Op::Reshallow {
        peer,
        at: rng.u16(),
    });
    for _ in 0..8 {
        ops.push(Op::Text {
            peer,
            target: TextTarget::Root,
            edit: gen_text_edit(&mut rng),
        });
        ops.push(Op::MapSet {
            peer,
            key: rng.u8(KEYS.len() as u8),
            value: gen_value(&mut rng),
        });
        ops.push(Op::CommitEditor { peer });
    }
    ops.push(Op::Bulk { peer });
    ops.push(Op::CommitEditor { peer });
    ops.extend_from_slice(&base.ops[split..]);
    base.ops = ops;
    base
}

/// Run one case; on divergence, shrink it and return a printable report.
pub fn check(case: &Case, stats: &mut Stats) -> Result<(), String> {
    let Some(divergence) = run(&case.config, &case.ops, stats) else {
        return Ok(());
    };
    let minimal = shrink(&case.config, &case.ops);
    let again = run(&case.config, &minimal, &mut Stats::default());
    Err(format!(
        "DIVERGENCE seed={} config={:?}\n{divergence}\nminimized to {} steps (from {}):\n{:#?}\nminimized divergence: {}",
        case.seed,
        case.config,
        minimal.len(),
        case.ops.len(),
        minimal,
        again.map_or_else(|| "<none: shrink lost it>".into(), |d| d.to_string()),
    ))
}

/// Strip crate source roots from Loro error messages: the two builds report
/// the same `src/...:line` under different absolute roots.
pub fn normalize(message: &str) -> String {
    message
        .split(' ')
        .map(|token| {
            let start = token.find('/').unwrap_or(token.len());
            match token[start..].rfind("/src/") {
                Some(at) if token[start..].starts_with('/') => {
                    format!("{}{}", &token[..start], &token[start + at + 1..])
                }
                _ => token.to_owned(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Panic messages carry no source path; normalize anyway for safety.
pub fn normalize_panic(message: &str) -> String {
    normalize(message)
}
