use super::*;
use crate::{inbound, outbound::deno::DenoRunner};
use serde_json::json;
use std::path::PathBuf;

#[test]
fn rejects_unsafe_or_unbounded_connection_configuration() {
    let token = || ServiceToken::new("test-token-long-enough-for-runner-auth".into()).unwrap();
    assert!(RunnerClient::new("https://example.com".into(), token(), 4, 16).is_err());
    assert!(RunnerClient::new("ws://localhost/v1/execute".into(), token(), 0, 16).is_err());
    assert!(ServiceToken::new("short".into()).is_err());
}

struct Fixture {
    scratch: tempfile::TempDir,
    service: ExecutionService,
    client: RunnerClient,
    server: tokio::task::JoinHandle<()>,
}

impl Fixture {
    async fn new() -> Self {
        let scratch = tempfile::tempdir().unwrap();
        let binary = tokio::process::Command::new("which")
            .arg("deno")
            .output()
            .await
            .unwrap();
        assert!(binary.status.success(), "Deno 2.9.6 must be on PATH");
        let binary = PathBuf::from(String::from_utf8(binary.stdout).unwrap().trim());
        let runner = DenoRunner::new(binary, scratch.path().to_owned(), 128)
            .await
            .unwrap();
        let service = ExecutionService::new(Arc::new(runner), Limits::default()).unwrap();
        let token = ServiceToken::new("test-token-long-enough-for-runner-auth".into()).unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("ws://{}/v1/execute", listener.local_addr().unwrap());
        let app = inbound::router(service.clone(), token.clone(), 8);
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Self {
            scratch,
            service,
            client: RunnerClient::new(endpoint, token, 2, 2).unwrap(),
            server,
        }
    }

    async fn shutdown(self) {
        self.service.shutdown().await;
        assert_eq!(std::fs::read_dir(self.scratch.path()).unwrap().count(), 0);
        self.server.abort();
    }
}

struct GatedDispatcher {
    first: Semaphore,
    second: Semaphore,
}

impl GatedDispatcher {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            first: Semaphore::new(0),
            second: Semaphore::new(0),
        })
    }
}

#[async_trait::async_trait]
impl HostDispatcher for GatedDispatcher {
    async fn dispatch(&self, call: HostCall, context: DispatchContext) -> HostResult {
        context
            .progress
            .as_ref()
            .unwrap()
            .try_send(json!({ "waiting": true }))
            .unwrap();
        let gate = if call.args == 1 {
            &self.first
        } else {
            &self.second
        };
        tokio::select! {
            _ = context.cancellation.cancelled() => HostResult::Error { message: "cancelled".into() },
            permit = gate.acquire() => {
                permit.unwrap().forget();
                HostResult::Ok { value: json!(call.args.as_u64().unwrap() * 100) }
            }
        }
    }
}

async fn next_event(receiver: &mut mpsc::Receiver<BackendEvent>) -> BackendEvent {
    let event = tokio::time::timeout(Duration::from_secs(10), receiver.recv())
        .await
        .unwrap()
        .unwrap();
    // Exercise the representation that the backend can publish to a session UI.
    serde_json::from_str(&serde_json::to_string(&event).unwrap()).unwrap()
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn parallel_dispatch_streams_while_waiting_and_matches_out_of_order_replies() {
    let fixture = Fixture::new().await;
    let dispatcher = GatedDispatcher::new();
    let (events, mut receiver) = mpsc::channel(64);
    let client = fixture.client.clone();
    let host = dispatcher.clone();
    let execution = tokio::spawn(async move {
        client.execute(ExecuteRequest {
            source: "return await Promise.all([host.call('test.first', 1), host.call('test.second', 2)]);".into(), timeout_ms: 10_000,
        }, host, events, CancellationToken::new()).await
    });
    let mut started = Vec::new();
    let mut progressed = Vec::new();
    while started.len() < 2 || progressed.len() < 2 {
        match next_event(&mut receiver).await {
            BackendEvent::CallStarted { call_id, .. } => started.push(call_id),
            BackendEvent::CallProgress { call_id, .. } => progressed.push(call_id),
            BackendEvent::Execution(ExecutionEvent {
                kind: EventKind::Finished { outcome },
                ..
            }) => panic!("finished before gates opened: {outcome:?}"),
            _ => {}
        }
    }
    assert!(
        !execution.is_finished(),
        "progress must arrive during execution"
    );
    dispatcher.second.add_permits(1);
    loop {
        if let BackendEvent::CallFinished {
            call_id, failed, ..
        } = next_event(&mut receiver).await
        {
            assert_eq!(call_id, CallId(2));
            assert!(!failed);
            break;
        }
    }
    dispatcher.first.add_permits(1);
    let result = tokio::time::timeout(Duration::from_secs(10), execution)
        .await
        .unwrap()
        .unwrap();
    assert!(matches!(result, Outcome::Succeeded { value } if value == json!([100, 200])));
    fixture.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn cancellation_reaches_runner_during_a_host_call() {
    let fixture = Fixture::new().await;
    let (events, mut receiver) = mpsc::channel(64);
    let client = fixture.client.clone();
    let cancellation = CancellationToken::new();
    let token = cancellation.clone();
    let execution = tokio::spawn(async move {
        client
            .execute(
                ExecuteRequest {
                    source: "return await host.call('test.wait', 1);".into(),
                    timeout_ms: 10_000,
                },
                GatedDispatcher::new(),
                events,
                token,
            )
            .await
    });
    while !matches!(
        next_event(&mut receiver).await,
        BackendEvent::CallProgress { .. }
    ) {}
    cancellation.cancel();
    let result = tokio::time::timeout(Duration::from_secs(5), execution)
        .await
        .unwrap()
        .unwrap();
    assert!(matches!(result, Outcome::Cancelled));
    fixture.shutdown().await;
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn disconnect_reaps_its_run_without_cancelling_another_session() {
    let fixture = Fixture::new().await;
    let (events, mut receiver) = mpsc::channel(64);
    let client = fixture.client.clone();
    let first = tokio::spawn(async move {
        client
            .execute(
                ExecuteRequest {
                    source: "console.log('ready'); while(true) {}".into(),
                    timeout_ms: 10_000,
                },
                GatedDispatcher::new(),
                events,
                CancellationToken::new(),
            )
            .await
    });
    while !matches!(
        next_event(&mut receiver).await,
        BackendEvent::Execution(ExecutionEvent {
            kind: EventKind::Log { .. },
            ..
        })
    ) {}
    let (events, _receiver) = mpsc::channel(64);
    let client = fixture.client.clone();
    let second = tokio::spawn(async move {
        client
            .execute(
                ExecuteRequest {
                    source: "await new Promise(r => setTimeout(r, 100)); return 42;".into(),
                    timeout_ms: 5000,
                },
                GatedDispatcher::new(),
                events,
                CancellationToken::new(),
            )
            .await
    });
    first.abort();
    assert!(matches!(second.await.unwrap(), Outcome::Succeeded { value } if value == 42));
    fixture.shutdown().await;
}

struct LargeReplyDispatcher;

#[async_trait::async_trait]
impl HostDispatcher for LargeReplyDispatcher {
    async fn dispatch(&self, _call: HostCall, _context: DispatchContext) -> HostResult {
        HostResult::Ok {
            value: json!("x".repeat(12_000)),
        }
    }
}

#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn drains_console_output_while_large_host_replies_are_in_flight() {
    let fixture = Fixture::new().await;
    let (events, _receiver) = mpsc::channel(64);
    let result = fixture.client.execute(ExecuteRequest {
        source: "const calls = Array.from({length: 8}, () => host.call('test.large')); for(let i=0;i<16;i++) console.log('x'.repeat(8000)); return (await Promise.all(calls)).map(x => x.length);".into(),
        timeout_ms: 5000,
    }, Arc::new(LargeReplyDispatcher), events, CancellationToken::new()).await;
    assert!(matches!(result, Outcome::Succeeded { value } if value == json!(vec![12000; 8])));
    fixture.shutdown().await;
}
