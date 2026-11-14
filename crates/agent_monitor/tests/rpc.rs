//! Round trips through the real server and client over a temporary socket.
#![cfg(unix)]

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use agent_monitor::client::MonitorClient;
use agent_monitor::domain::clock::SystemClock;
use agent_monitor::domain::model::SourceKind;
use agent_monitor::domain::model::{AgentId, AgentKind, UpdateKind};
use agent_monitor::domain::observation::{
    Change, Fact, Observation, TerminalActivity, TerminalFact, TerminalState,
};
use agent_monitor::domain::source::AgentSource;
use agent_monitor::domain::store::{Store, StoreConfig};
use agent_monitor::domain::supervisor::spawn_source;
use agent_monitor::inbound::grpc::{MonitorService, bind, serve};
use agent_monitor::outbound::demo::{DemoConfig, DemoSource, DemoTranscripts};
use futures::StreamExt as _;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

/// A guard so a broken stream fails the test instead of hanging it.
const DEADLINE: Duration = Duration::from_secs(20);

struct Collector {
    socket: PathBuf,
    store: Store,
    tracker: TaskTracker,
    cancel: CancellationToken,
    _directory: tempfile::TempDir,
}

impl Collector {
    async fn start(config: StoreConfig, demo: bool) -> Self {
        let directory = tempfile::tempdir().expect("a temporary directory");
        let socket = directory.path().join("run").join("monitor.sock");
        let tracker = TaskTracker::new();
        let cancel = CancellationToken::new();
        let clock = Arc::new(SystemClock);
        let store = Store::start(config, clock.clone(), &tracker, cancel.clone());
        let transcripts = DemoTranscripts::default();

        if demo {
            let feed = transcripts.clone();
            spawn_source(
                &store,
                move || {
                    let config = DemoConfig {
                        seed: 7,
                        step: Duration::from_millis(5),
                    };
                    Box::new(DemoSource::new(config, clock.clone(), feed.clone()))
                        as Box<dyn AgentSource>
                },
                &tracker,
                cancel.clone(),
            );
        }

        let listener = bind(&socket).await.expect("the socket binds");
        let service = MonitorService::new(
            store.clone(),
            Arc::new(transcripts),
            String::from("test"),
            tracker.clone(),
            cancel.clone(),
        );
        let serve_cancel = cancel.clone();
        tracker.spawn(async move { serve(listener, service, serve_cancel).await });

        Self {
            socket,
            store,
            tracker,
            cancel,
            _directory: directory,
        }
    }

    async fn stop(self) {
        self.cancel.cancel();
        self.tracker.close();
        self.tracker.wait().await;
    }
}

fn terminal(address: String) -> Observation {
    Observation {
        source: SourceKind::Hc,
        change: Change::Upsert(Fact::Terminal(Box::new(TerminalFact {
            address: address.clone(),
            name: address,
            parent: None,
            spawned_by: None,
            cwd: None,
            state: TerminalState::Live,
            activity: Some(TerminalActivity::Idle),
            status_message: None,
            turn: None,
            created: None,
            finished: None,
            exit_code: None,
            finish_reason: None,
            foreground_pid: None,
            program: None,
            kind: Some(AgentKind::Builder),
            model: None,
            space: None,
            goal: None,
            waiting: false,
            manager_dir: None,
            macrod_session: None,
            run_id: None,
            tags: Vec::new(),
        }))),
    }
}

#[tokio::test]
async fn subscribe_sends_a_snapshot_then_gapless_deltas() {
    let collector = Collector::start(StoreConfig::default(), true).await;
    let mut client = MonitorClient::connect(&collector.socket)
        .await
        .expect("the client connects");
    let mut updates = client.subscribe().await.expect("subscribe starts");

    let first = tokio::time::timeout(DEADLINE, updates.next())
        .await
        .expect("a first update")
        .expect("the stream is open")
        .expect("a readable update");
    assert!(matches!(first.kind, UpdateKind::Snapshot(_)));

    let mut seq = first.seq;
    let mut upserts = 0;
    let mut events = 0;
    while upserts < 30 || events < 30 {
        let update = tokio::time::timeout(DEADLINE, updates.next())
            .await
            .expect("updates keep coming")
            .expect("the stream is open")
            .expect("a readable update");
        assert_eq!(update.seq, seq + 1, "sequence numbers rise by one");
        seq = update.seq;
        match update.kind {
            UpdateKind::Upsert(_) => upserts += 1,
            UpdateKind::Event(_) => events += 1,
            UpdateKind::Snapshot(_) => panic!("a keeping-up subscriber is not re-snapshotted"),
            _ => {}
        }
    }

    let status = client.status().await.expect("status answers");
    assert_eq!(status.protocol, agent_monitor::proto::PROTOCOL);
    assert_eq!(status.subscribers, 1);
    collector.stop().await;
}

#[tokio::test]
async fn a_slow_subscriber_gets_a_fresh_snapshot() {
    let config = StoreConfig {
        update_capacity: 16,
        ..StoreConfig::default()
    };
    let collector = Collector::start(config, false).await;
    let mut client = MonitorClient::connect(&collector.socket)
        .await
        .expect("the client connects");
    let mut updates = client.subscribe().await.expect("subscribe starts");
    let first = updates
        .next()
        .await
        .expect("the stream is open")
        .expect("a readable update");
    assert!(matches!(first.kind, UpdateKind::Snapshot(_)));

    // Far more rows than the socket, the stream buffer and the broadcast hold,
    // published while this client reads nothing.
    let observations = collector.store.observations();
    let count = 5000;
    for index in 0..count {
        observations
            .send(terminal(format!("t{index}")))
            .await
            .expect("the store is open");
    }

    let last = AgentId::terminal(&format!("t{}", count - 1));
    let mut resnapshot = None;
    while resnapshot.is_none() {
        let update = tokio::time::timeout(DEADLINE, updates.next())
            .await
            .expect("updates keep coming")
            .expect("the stream is open")
            .expect("a readable update");
        if let UpdateKind::Snapshot(snapshot) = update.kind {
            resnapshot = Some((update.seq, snapshot));
        }
    }

    let (seq, mut snapshot) = resnapshot.expect("a fresh snapshot arrived");
    let mut seen_last = snapshot.agents.iter().any(|agent| agent.id == last);
    let mut previous = seq;
    while !seen_last {
        let update = tokio::time::timeout(DEADLINE, updates.next())
            .await
            .expect("updates keep coming")
            .expect("the stream is open")
            .expect("a readable update");
        match update.kind {
            UpdateKind::Snapshot(next) => snapshot = next,
            UpdateKind::Upsert(agent) => {
                assert_eq!(
                    update.seq,
                    previous + 1,
                    "deltas follow the snapshot in order"
                );
                seen_last = agent.id == last;
            }
            _ => assert_eq!(update.seq, previous + 1),
        }
        seen_last |= snapshot.agents.iter().any(|agent| agent.id == last);
        previous = update.seq;
    }
    collector.stop().await;
}

#[tokio::test]
async fn follow_transcript_sends_the_tail_then_new_items() {
    let collector = Collector::start(StoreConfig::default(), true).await;
    let mut client = MonitorClient::connect(&collector.socket)
        .await
        .expect("the client connects");

    // Wait for the demo fleet's builder to be published.
    let builder = AgentId::terminal("t2");
    let mut updates = client.subscribe().await.expect("subscribe starts");
    loop {
        let update = tokio::time::timeout(DEADLINE, updates.next())
            .await
            .expect("updates keep coming")
            .expect("the stream is open")
            .expect("a readable update");
        let present = match &update.kind {
            UpdateKind::Snapshot(snapshot) => {
                snapshot.agents.iter().any(|agent| agent.id == builder)
            }
            UpdateKind::Upsert(agent) => agent.id == builder,
            _ => false,
        };
        if present {
            break;
        }
    }

    let requested = chrono::Utc::now();
    let tail = 3;
    let mut items = client
        .follow_transcript(&builder, tail)
        .await
        .expect("follow starts");
    let mut received = Vec::new();
    while received.len() < 5 {
        let item = tokio::time::timeout(DEADLINE, items.next())
            .await
            .expect("items keep coming")
            .expect("the stream is open")
            .expect("a readable item");
        received.push(item);
    }

    assert!(received.windows(2).all(|pair| pair[0].at <= pair[1].at));
    assert!(
        received[3..].iter().all(|item| item.at >= requested),
        "items after the tail were written after the request"
    );

    let missing = client
        .follow_transcript(&AgentId::terminal("nope"), 1)
        .await;
    assert!(missing.is_err());
    collector.stop().await;
}

#[tokio::test]
async fn the_viewers_trace_context_parents_the_subscribe_span() {
    use opentelemetry::trace::{TraceContextExt as _, TracerProvider as _};
    use tracing::Instrument as _;
    use tracing_opentelemetry::OpenTelemetrySpanExt as _;
    use tracing_subscriber::layer::SubscriberExt as _;

    opentelemetry::global::set_text_map_propagator(
        opentelemetry_sdk::propagation::TraceContextPropagator::new(),
    );
    let exporter = opentelemetry_sdk::trace::InMemorySpanExporter::default();
    let provider = opentelemetry_sdk::trace::SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));
    tracing::subscriber::set_global_default(subscriber).expect("one subscriber per test process");

    let collector = Collector::start(StoreConfig::default(), false).await;
    let viewer = tracing::info_span!("macrod.monitor.viewer.connect");
    let trace_id = viewer.context().span().span_context().trace_id();
    let socket = collector.socket.clone();
    async move {
        let mut client = MonitorClient::connect(&socket)
            .await
            .expect("the client connects");
        let mut updates = client.subscribe().await.expect("subscribe starts");
        updates
            .next()
            .await
            .expect("a snapshot")
            .expect("a readable update");
    }
    .instrument(viewer)
    .await;

    // Stopping ends the subscribe span, which exports it.
    collector.stop().await;
    let spans = exporter.get_finished_spans().expect("spans were exported");
    let subscribe = spans
        .iter()
        .find(|span| span.name == "macrod.monitor.rpc.subscribe")
        .expect("the subscribe span was exported");
    assert_eq!(subscribe.span_context.trace_id(), trace_id);
}
