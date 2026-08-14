//! Narrated end-to-end flows through the [`ConnManager`] on the mock replica.
//!
//! Run with `cargo run -p sync_machine --example flows`. Each step prints the
//! input fed to the manager, the machine's own one-line reason for what it
//! did, and the effects it emitted — the exact conversation the pass-2 runtime
//! will have with storage, timers, and the gateway sink, with every byte faked
//! and every "await" a printed line.

use sync_machine::manager::{ConnManager, ManagerEffect, ManagerInput, ManagerOutcome};
use sync_machine::model::{
    Capabilities, ClientFrame, ConnId, DocId, Effect, PersistToken, ServerFrame, TimerToken,
};
use sync_machine::replica::mock::MockReplica;

fn main() {
    two_users_edit_a_document();
    reconnect_and_catch_up();
    store_outage_and_recovery();
    document_that_never_existed();
}

// ── flow 1 ────────────────────────────────────────────────────────────────

fn two_users_edit_a_document() {
    banner("flow 1: two users edit a document, then leave");
    let mut flow = Flow::new();
    let (alice, bob) = (ConnId(1), ConnId(2));
    let doc = DocId("doc-a".into());

    flow.step(
        "alice attaches (first touch: the document must be loaded)",
        ManagerInput::Attach {
            conn: alice,
            doc: doc.clone(),
            capabilities: edit_caps("alice"),
        },
    );
    flow.step(
        "bob attaches while the load is still in flight",
        ManagerInput::Attach {
            conn: bob,
            doc: doc.clone(),
            capabilities: edit_caps("bob"),
        },
    );
    flow.step(
        "the store answers: both waiting peers get their initial sync",
        ManagerInput::Loaded {
            doc: doc.clone(),
            snapshot: Some(b"stored-snapshot".to_vec()),
            snapshot_seq: 0,
            ops: Vec::new(),
        },
    );
    flow.step(
        "alice registers her CRDT peer id (binds edits to her user)",
        ManagerInput::Frame {
            conn: alice,
            doc: doc.clone(),
            frame: ClientFrame::RegisterPeer { peer_id: 11 },
        },
    );
    flow.step(
        "alice edits: applied + persistence requested — NO ack, NO broadcast yet",
        ManagerInput::Frame {
            conn: alice,
            doc: doc.clone(),
            frame: ClientFrame::Update {
                updates: vec![b"insert 'hello'".to_vec()],
                id: "op-1".into(),
            },
        },
    );
    let persist = flow.last_persist_ops();
    let debounce = flow.last_timer();
    flow.step(
        "the op log write commits: ack to alice, THEN broadcast to bob",
        ManagerInput::OpsPersisted {
            doc: doc.clone(),
            token: persist,
            through_seq: 1,
        },
    );
    flow.step(
        "alice moves her cursor (presence is ephemeral: relayed, never persisted)",
        ManagerInput::Frame {
            conn: alice,
            doc: doc.clone(),
            frame: ClientFrame::Presence {
                payload: b"alice@line3".to_vec(),
            },
        },
    );
    flow.step(
        "the 5s compaction debounce fires: fold the op into a fresh snapshot",
        ManagerInput::TimerFired { token: debounce },
    );
    let snapshot_persist = flow.last_persist_snapshot();
    flow.step(
        "the snapshot commits: the edit is reported to the product (Edited)",
        ManagerInput::SnapshotPersisted {
            doc: doc.clone(),
            token: snapshot_persist,
        },
    );
    flow.step(
        "bob closes the tab (the router translates it to a per-doc detach)",
        ManagerInput::Detach {
            conn: bob,
            doc: doc.clone(),
        },
    );
    flow.step(
        "alice's socket dies; the router tears down her route for this doc",
        ManagerInput::Detach {
            conn: alice,
            doc: doc.clone(),
        },
    );
    let idle = flow.last_timer();
    flow.step(
        "a minute later, nothing is dirty: the machine asks to be evicted",
        ManagerInput::TimerFired { token: idle },
    );
    println!(
        "  resident documents now: {}\n",
        flow.manager.resident_docs()
    );
}

// ── flow 2 ────────────────────────────────────────────────────────────────

fn reconnect_and_catch_up() {
    banner("flow 2: a client reconnects and catches up from its cursor");
    let mut flow = Flow::new();
    let carol = ConnId(3);
    let doc = DocId("doc-b".into());

    flow.step(
        "carol re-attaches after a network blip",
        ManagerInput::Attach {
            conn: carol,
            doc: doc.clone(),
            capabilities: edit_caps("carol"),
        },
    );
    flow.step(
        "the document loads (it had state from her earlier session)",
        // The snapshot covered ops through seq 4; two more ops were durable
        // but not yet compacted — the machine replays them and resumes
        // numbering at 6.
        ManagerInput::Loaded {
            doc: doc.clone(),
            snapshot: Some(b"earlier-state".to_vec()),
            snapshot_seq: 4,
            ops: vec![(5, b"tail-op-5".to_vec()), (6, b"tail-op-6".to_vec())],
        },
    );
    flow.step(
        "carol asks for everything since her last-known cursor; the reply \
         echoes her cursor bytes verbatim so her client can correlate it",
        ManagerInput::Frame {
            conn: carol,
            doc: doc.clone(),
            frame: ClientFrame::RequestSince {
                cursor: b"carol-vv".to_vec(),
            },
        },
    );
}

// ── flow 3 ────────────────────────────────────────────────────────────────

fn store_outage_and_recovery() {
    banner("flow 3: the store fails mid-session and recovers");
    let mut flow = Flow::new();
    let dave = ConnId(4);
    let doc = DocId("doc-c".into());

    flow.step(
        "dave attaches",
        ManagerInput::Attach {
            conn: dave,
            doc: doc.clone(),
            capabilities: edit_caps("dave"),
        },
    );
    flow.step(
        "loaded",
        ManagerInput::Loaded {
            doc: doc.clone(),
            snapshot: Some(b"base".to_vec()),
            snapshot_seq: 0,
            ops: Vec::new(),
        },
    );
    flow.step(
        "dave edits",
        ManagerInput::Frame {
            conn: dave,
            doc: doc.clone(),
            frame: ClientFrame::Update {
                updates: vec![b"edit".to_vec()],
                id: "op-9".into(),
            },
        },
    );
    let persist = flow.last_persist_ops();
    flow.step(
        "the op-log write FAILS: no ack (dave's client will wait), retry scheduled",
        ManagerInput::PersistFailed {
            doc: doc.clone(),
            token: persist,
        },
    );
    let retry = flow.last_timer();
    flow.step(
        "the retry timer fires: the unpersisted tail is re-sent to the store",
        ManagerInput::TimerFired { token: retry },
    );
    let persist = flow.last_persist_ops();
    flow.step(
        "this time it commits: the ack finally reaches dave",
        ManagerInput::OpsPersisted {
            doc: doc.clone(),
            token: persist,
            through_seq: 1,
        },
    );
}

// ── flow 4 ────────────────────────────────────────────────────────────────

fn document_that_never_existed() {
    banner("flow 4: subscribing to a document with no stored state");
    let mut flow = Flow::new();
    let erin = ConnId(5);
    let doc = DocId("doc-new".into());

    flow.step(
        "erin attaches to a brand-new document",
        ManagerInput::Attach {
            conn: erin,
            doc: doc.clone(),
            capabilities: edit_caps("erin"),
        },
    );
    flow.step(
        "the store has nothing: an empty document is materialized \
         (create-default-state, like the deployed service)",
        ManagerInput::Loaded {
            doc: doc.clone(),
            snapshot: None,
            snapshot_seq: 0,
            ops: Vec::new(),
        },
    );
}

// ── the driver ────────────────────────────────────────────────────────────

struct Flow {
    manager: ConnManager<MockReplica>,
    effects: Vec<ManagerEffect>,
}

impl Flow {
    fn new() -> Self {
        Self {
            manager: ConnManager::new(),
            effects: Vec::new(),
        }
    }

    fn step(&mut self, label: &str, input: ManagerInput) {
        println!("→ {label}");
        println!("    input:  {}", describe_input(&input));
        let ManagerOutcome {
            actions,
            lifecycle,
            reason,
        } = self.manager.handle(input);
        println!("    reason: {reason}");
        if let Some((doc, event)) = lifecycle {
            println!("    lifecycle: [{}] {event:?}", doc.as_str());
        }
        self.effects = actions;
        if self.effects.is_empty() {
            println!("    effects: (none)");
        }
        for effect in &self.effects {
            println!(
                "    effect: [{}] {}",
                effect.doc.as_str(),
                describe_effect(&effect.effect)
            );
        }
        println!();
    }

    fn last_timer(&self) -> TimerToken {
        self.effects
            .iter()
            .rev()
            .find_map(|e| match e.effect {
                Effect::ScheduleTimer { token, .. } => Some(token),
                _ => None,
            })
            .expect("a timer was scheduled")
    }

    fn last_persist_ops(&self) -> PersistToken {
        self.effects
            .iter()
            .rev()
            .find_map(|e| match e.effect {
                Effect::PersistOps { token, .. } => Some(token),
                _ => None,
            })
            .expect("a PersistOps was emitted")
    }

    fn last_persist_snapshot(&self) -> PersistToken {
        self.effects
            .iter()
            .rev()
            .find_map(|e| match e.effect {
                Effect::PersistSnapshot { token, .. } => Some(token),
                _ => None,
            })
            .expect("a PersistSnapshot was emitted")
    }
}

fn edit_caps(user: &str) -> Capabilities {
    let raw = format!("macro|{user}@macro.com");
    Capabilities {
        can_edit: true,
        user_id: Some(
            macro_user_id::user_id::MacroUserIdStr::try_from(raw).expect("valid example user id"),
        ),
    }
}

fn banner(title: &str) {
    println!("──────────────────────────────────────────────────────");
    println!("{title}");
    println!("──────────────────────────────────────────────────────");
}

fn describe_input(input: &ManagerInput) -> String {
    match input {
        ManagerInput::Attach {
            conn,
            doc,
            capabilities,
        } => format!(
            "Attach(conn {}, doc {}, user {:?}, can_edit {})",
            conn.0,
            doc.as_str(),
            capabilities
                .user_id
                .as_ref()
                .map(|u| u.to_string())
                .unwrap_or_else(|| "-".into()),
            capabilities.can_edit
        ),
        ManagerInput::Detach { conn, doc } => {
            format!("Detach(conn {}, doc {})", conn.0, doc.as_str())
        }
        ManagerInput::Frame { conn, frame, .. } => {
            format!("Frame(conn {}, {})", conn.0, describe_client_frame(frame))
        }
        ManagerInput::TimerFired { token } => format!("TimerFired(#{})", token.0),
        ManagerInput::Loaded { snapshot, ops, .. } => match snapshot {
            Some(bytes) => format!(
                "Loaded({}B snapshot + {} tail op(s))",
                bytes.as_slice().len(),
                ops.len()
            ),
            None => "Loaded(nothing stored)".into(),
        },
        ManagerInput::LoadFailed { error, .. } => format!("LoadFailed({error})"),
        ManagerInput::OpsPersisted {
            token, through_seq, ..
        } => {
            format!("OpsPersisted(#{}, through seq {through_seq})", token.0)
        }
        ManagerInput::SnapshotPersisted { token, .. } => {
            format!("SnapshotPersisted(#{})", token.0)
        }
        ManagerInput::PersistFailed { token, .. } => format!("PersistFailed(#{})", token.0),
    }
}

fn describe_client_frame(frame: &ClientFrame) -> String {
    match frame {
        ClientFrame::Update { updates, id } => {
            format!("Update({} update(s), id {id})", updates.len())
        }
        ClientFrame::Presence { .. } => "Presence".into(),
        ClientFrame::RequestSince { .. } => "RequestSince".into(),
        ClientFrame::RequestSnapshot => "RequestSnapshot".into(),
        ClientFrame::RegisterPeer { peer_id } => format!("RegisterPeer({peer_id})"),
    }
}

fn describe_effect(effect: &Effect) -> String {
    match effect {
        Effect::Send { conn, frame } => {
            format!("Send(conn {}) ← {}", conn.0, describe_server_frame(frame))
        }
        Effect::Broadcast { except, frame } => format!(
            "Broadcast(all except conn {}) ← {}",
            except.0,
            describe_server_frame(frame)
        ),
        Effect::Close { conn, reason } => format!("Close(conn {}, {reason:?})", conn.0),
        Effect::ScheduleTimer { token, after_ms } => {
            format!("ScheduleTimer(#{}, {after_ms}ms)", token.0)
        }
        Effect::Load => "Load — fetch the stored snapshot".into(),
        Effect::PersistOps {
            token,
            ops,
            through_seq,
        } => format!(
            "PersistOps(#{}, {} op(s), through seq {through_seq})",
            token.0,
            ops.len()
        ),
        Effect::PersistSnapshot {
            token,
            snapshot,
            through_seq,
        } => format!(
            "PersistSnapshot(#{}, {}B, covers through seq {through_seq})",
            token.0,
            snapshot.as_slice().len()
        ),
        Effect::RecordBlame { events } => format!("RecordBlame({} row(s))", events.len()),
        Effect::RecordPeerMapping { peer_id, user_id } => {
            format!("RecordPeerMapping(peer {peer_id} → {user_id})")
        }
        Effect::Evict => "Evict — drop this machine".into(),
    }
}

fn describe_server_frame(frame: &ServerFrame) -> String {
    match frame {
        ServerFrame::InitialSync { snapshot, presence } => format!(
            "InitialSync({}B snapshot, {}B presence)",
            snapshot.as_slice().len(),
            presence.as_slice().len()
        ),
        ServerFrame::Update { .. } => "Update".into(),
        ServerFrame::Presence { .. } => "Presence".into(),
        ServerFrame::Snapshot { snapshot } => {
            format!("Snapshot({}B)", snapshot.as_slice().len())
        }
        ServerFrame::Ack { id } => format!("Ack({id})"),
        ServerFrame::Since { .. } => "Since(diff + echoed cursor)".into(),
    }
}
