//! The native downstream: instead of dialing a Durable Object, frames are fed
//! to an in-process [`sync_machine`] manager whose effects are executed here —
//! Postgres for persistence, a timer heap for schedules, and the router's
//! [`EdgeSink`] for delivery back to clients.
//!
//! One task owns the [`ConnManager`]; per-document input ordering is by
//! construction. IO never blocks that task: store calls are spawned and their
//! completions come back as [`ManagerInput`]s.
//!
//! [`EdgeSink`]: crate::domain::ports::EdgeSink

pub mod downstream;
pub mod lifecycle;
pub mod store;
mod timers;
pub mod wire;

use crate::domain::envelope;
use crate::domain::models::{ConnectionId, DocId as RouterDocId, Event};
use crate::domain::ports::EdgeSink;
use crate::native::lifecycle::LifecycleReporter;
use crate::native::store::PgSyncStore;
use crate::native::timers::TimerWheel;
use dashmap::DashMap;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use sync_machine::manager::{ConnManager, ManagerInput};
use sync_machine::model::{ConnId, DocId, Effect, ServerFrame};
use sync_machine::replica::loro::LoroReplica;
use tokio::sync::mpsc;
use tracing::{debug, info, warn};

/// A machine-conn registered with the host: where its frames go back to.
pub(crate) struct Route {
    pub router_conn: ConnectionId,
    pub doc: RouterDocId,
    /// The router route epoch, echoed in DownstreamClosed.
    pub epoch: u64,
}

/// Shared handle used by the downstream factory to talk to the host task.
pub struct MachineHost {
    pub(crate) inputs: mpsc::Sender<ManagerInput>,
    /// machine ConnId → where to deliver.
    pub(crate) routes: Arc<DashMap<ConnId, Route>>,
}

impl MachineHost {
    /// Spawn the host task. `sink` delivers server frames back through the
    /// gateway; `events` tells the router when a native route died.
    pub fn spawn<Sink: EdgeSink>(
        store: PgSyncStore,
        reporter: LifecycleReporter,
        sink: Arc<Sink>,
        events: mpsc::Sender<Event>,
    ) -> Arc<Self> {
        let (inputs, input_rx) = mpsc::channel(4096);
        let host = Arc::new(Self {
            inputs,
            routes: Arc::new(DashMap::new()),
        });
        tokio::spawn(run(
            input_rx,
            host.inputs.clone(),
            Arc::clone(&host.routes),
            store,
            reporter,
            sink,
            events,
        ));
        host
    }
}

/// The host loop: one owner for the manager, a timer heap, and the effect
/// executor.
async fn run<Sink: EdgeSink>(
    mut inputs: mpsc::Receiver<ManagerInput>,
    completions: mpsc::Sender<ManagerInput>,
    routes: Arc<DashMap<ConnId, Route>>,
    store: PgSyncStore,
    reporter: LifecycleReporter,
    sink: Arc<Sink>,
    events: mpsc::Sender<Event>,
) {
    let mut manager = ConnManager::<LoroReplica>::new();
    // Which machine-conns are attached per document, for Broadcast expansion.
    let mut attached: BTreeMap<DocId, BTreeSet<ConnId>> = BTreeMap::new();
    let mut timers = TimerWheel::new();

    loop {
        let input = tokio::select! {
            input = inputs.recv() => match input {
                Some(input) => input,
                None => {
                    info!("machine host inputs closed; exiting");
                    return;
                }
            },
            token = timers.fired() => ManagerInput::TimerFired { token },
        };

        // Maintain the broadcast index from the inputs themselves.
        match &input {
            ManagerInput::Attach { conn, doc, .. } => {
                attached.entry(doc.clone()).or_default().insert(*conn);
            }
            ManagerInput::Detach { conn, doc } => {
                if let Some(conns) = attached.get_mut(doc) {
                    conns.remove(conn);
                    if conns.is_empty() {
                        attached.remove(doc);
                    }
                }
            }
            _ => {}
        }

        let outcome = manager.handle(input);
        debug!(reason = %outcome.reason, "machine input handled");
        if let Some((doc, event)) = outcome.lifecycle {
            debug!(doc = doc.as_str(), event = ?event, "lifecycle");
            reporter.report(doc, event);
        }
        for action in outcome.actions {
            execute(
                action.doc,
                action.effect,
                &routes,
                &attached,
                &mut timers,
                &store,
                &sink,
                &completions,
                &events,
            )
            .await;
        }
    }
}

#[allow(clippy::too_many_arguments, reason = "the effect executor is the hub")]
async fn execute<Sink: EdgeSink>(
    doc: DocId,
    effect: Effect,
    routes: &DashMap<ConnId, Route>,
    attached: &BTreeMap<DocId, BTreeSet<ConnId>>,
    timers: &mut TimerWheel,
    store: &PgSyncStore,
    sink: &Arc<Sink>,
    completions: &mpsc::Sender<ManagerInput>,
    events: &mpsc::Sender<Event>,
) {
    match effect {
        Effect::Send { conn, frame } => deliver(conn, frame, routes, sink).await,
        Effect::Broadcast { except, frame } => {
            let Some(conns) = attached.get(&doc) else {
                return;
            };
            for conn in conns {
                if *conn != except {
                    deliver(*conn, frame.clone(), routes, sink).await;
                }
            }
        }
        Effect::Close { conn, reason } => {
            // Tell the client, then tell the router to forget the route (which
            // triggers the Detach back into us).
            if let Some(route) = routes.get(&conn) {
                sink.deliver(
                    &route.router_conn,
                    envelope::doc_closed(route.doc.as_str(), &format!("{reason:?}")),
                )
                .await
                .map_err(Into::into)
                .inspect_err(|error: &anyhow::Error| warn!(error = ?error, "close deliver failed"))
                .ok();
                events
                    .send(Event::DownstreamClosed {
                        conn: route.router_conn.clone(),
                        doc: route.doc.clone(),
                        epoch: route.epoch,
                    })
                    .await
                    .ok();
            }
        }
        Effect::ScheduleTimer { token, after_ms } => timers.arm(token, after_ms),
        Effect::Load => {
            let store = store.clone();
            let completions = completions.clone();
            tokio::spawn(async move {
                let input = match store.load(doc.as_str()).await {
                    Ok((snapshot, snapshot_seq, ops)) => ManagerInput::Loaded {
                        doc,
                        snapshot,
                        snapshot_seq,
                        ops,
                    },
                    Err(error) => {
                        // The machine only records that the load failed, so log
                        // the store's reason here or it is lost entirely.
                        warn!(error = ?error, "load failed");
                        ManagerInput::LoadFailed {
                            doc,
                            error: error.to_string(),
                        }
                    }
                };
                completions.send(input).await.ok();
            });
        }
        Effect::PersistOps {
            token,
            ops,
            through_seq,
        } => {
            let store = store.clone();
            let completions = completions.clone();
            tokio::spawn(async move {
                let input = match store.append_ops(doc.as_str(), &ops).await {
                    Ok(()) => ManagerInput::OpsPersisted {
                        doc,
                        token,
                        through_seq,
                    },
                    Err(error) => {
                        warn!(error = ?error, "append_ops failed");
                        ManagerInput::PersistFailed { doc, token }
                    }
                };
                completions.send(input).await.ok();
            });
        }
        Effect::PersistSnapshot {
            token,
            snapshot,
            through_seq,
        } => {
            let store = store.clone();
            let completions = completions.clone();
            tokio::spawn(async move {
                let input = match store
                    .store_snapshot(doc.as_str(), &snapshot, through_seq)
                    .await
                {
                    Ok(()) => ManagerInput::SnapshotPersisted { doc, token },
                    Err(error) => {
                        warn!(error = ?error, "store_snapshot failed");
                        ManagerInput::PersistFailed { doc, token }
                    }
                };
                completions.send(input).await.ok();
            });
        }
        Effect::RecordBlame { events: blame } => {
            let store = store.clone();
            tokio::spawn(async move {
                store
                    .record_blame(doc.as_str(), &blame)
                    .await
                    .inspect_err(|error| warn!(error = ?error, "record_blame failed"))
                    .ok();
            });
        }
        Effect::RecordPeerMapping { peer_id, user_id } => {
            let store = store.clone();
            tokio::spawn(async move {
                store
                    .record_peer_mapping(doc.as_str(), peer_id, &user_id.to_string())
                    .await
                    .inspect_err(|error| warn!(error = ?error, "record_peer_mapping failed"))
                    .ok();
            });
        }
        Effect::Evict => {
            // The manager already dropped the machine; nothing host-side to
            // clean (routes die with their conns).
            debug!(doc = doc.as_str(), "machine evicted");
        }
    }
}

async fn deliver<Sink: EdgeSink>(
    conn: ConnId,
    frame: ServerFrame,
    routes: &DashMap<ConnId, Route>,
    sink: &Arc<Sink>,
) {
    let Some(route) = routes.get(&conn) else {
        return; // route torn down; frame is moot
    };
    let payload = wire::encode_from_remote(&frame);
    sink.deliver(
        &route.router_conn,
        envelope::doc_frame(route.doc.as_str(), &payload),
    )
    .await
    .map_err(Into::into)
    .inspect_err(|error: &anyhow::Error| warn!(error = ?error, "native deliver failed"))
    .ok();
}

/// Re-exported for the downstream factory.
pub(crate) use sync_machine::model::Capabilities;
pub(crate) fn machine_conn(epoch: u64) -> ConnId {
    ConnId(epoch)
}
