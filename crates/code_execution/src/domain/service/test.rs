use super::*;
use async_trait::async_trait;
use std::sync::atomic::{AtomicUsize, Ordering};

struct WaitingRunner(AtomicUsize);

#[async_trait]
impl CodeRunner for WaitingRunner {
    async fn run(
        &self,
        job: ExecutionJob,
        _events: &mut EventSink,
        _replies: mpsc::Receiver<HostReply>,
        cancellation: CancellationToken,
    ) -> Outcome {
        self.0.fetch_add(1, Ordering::SeqCst);
        tokio::select! {
            _ = cancellation.cancelled() => Outcome::Cancelled,
            _ = sleep_until(job.deadline) => Outcome::TimedOut,
        }
    }
}

fn request(timeout_ms: u64) -> ExecuteRequest {
    ExecuteRequest {
        source: "return 42;".into(),
        timeout_ms,
    }
}

#[tokio::test]
async fn validates_before_admission_and_bounds_queue() {
    let runner = Arc::new(WaitingRunner(AtomicUsize::new(0)));
    let service = ExecutionService::new(
        runner.clone(),
        Limits {
            max_running: 1,
            max_queued: 1,
            ..Limits::default()
        },
    )
    .unwrap();
    assert!(matches!(
        service.execute(request(0)),
        Err(AdmissionError::InvalidTimeout)
    ));
    assert!(matches!(
        service.execute(request(30_001)),
        Err(AdmissionError::InvalidTimeout)
    ));
    assert!(matches!(
        service.execute(ExecuteRequest {
            source: " ".into(),
            timeout_ms: 1
        }),
        Err(AdmissionError::InvalidSource)
    ));
    let mut first = service.execute(request(10_000)).unwrap();
    while !matches!(first.events.recv().await.unwrap().kind, EventKind::Started) {}
    let second = service.execute(request(10_000)).unwrap();
    assert!(matches!(
        service.execute(request(1)),
        Err(AdmissionError::Busy)
    ));
    assert_eq!(runner.0.load(Ordering::SeqCst), 1);
    drop(first);
    drop(second);
    service.shutdown().await;
    assert!(matches!(
        service.execute(request(1)),
        Err(AdmissionError::ShuttingDown)
    ));
}

#[tokio::test]
async fn queued_deadline_does_not_start_another_process() {
    let runner = Arc::new(WaitingRunner(AtomicUsize::new(0)));
    let service = ExecutionService::new(
        runner.clone(),
        Limits {
            max_running: 1,
            max_queued: 1,
            ..Limits::default()
        },
    )
    .unwrap();
    let mut first = service.execute(request(10_000)).unwrap();
    while !matches!(first.events.recv().await.unwrap().kind, EventKind::Started) {}
    let mut second = service.execute(request(20)).unwrap();
    let mut terminal = None;
    while let Some(event) = second.events.recv().await {
        if let EventKind::Finished { outcome } = event.kind {
            terminal = Some(outcome)
        }
    }
    assert!(matches!(terminal, Some(Outcome::TimedOut)));
    assert_eq!(runner.0.load(Ordering::SeqCst), 1);
    drop(first);
    service.shutdown().await;
}
