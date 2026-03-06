use super::*;
use std::sync::atomic::{AtomicBool, Ordering};
use tower_http::trace::OnResponse;
use tracing::subscriber::{set_default, with_default};

/// Minimal tracing subscriber that records whether WARN or INFO events were emitted.
struct LevelCapture {
    saw_warn: Arc<AtomicBool>,
    saw_info: Arc<AtomicBool>,
}

impl LevelCapture {
    fn new() -> (Self, Arc<AtomicBool>, Arc<AtomicBool>) {
        let saw_warn = Arc::new(AtomicBool::new(false));
        let saw_info = Arc::new(AtomicBool::new(false));
        (
            Self {
                saw_warn: saw_warn.clone(),
                saw_info: saw_info.clone(),
            },
            saw_warn,
            saw_info,
        )
    }
}

impl tracing::Subscriber for LevelCapture {
    fn enabled(&self, _metadata: &tracing::Metadata<'_>) -> bool {
        true
    }

    fn new_span(&self, _attrs: &tracing::span::Attributes<'_>) -> tracing::span::Id {
        tracing::span::Id::from_u64(1)
    }

    fn record(&self, _span: &tracing::span::Id, _values: &tracing::span::Record<'_>) {}

    fn record_follows_from(&self, _span: &tracing::span::Id, _follows: &tracing::span::Id) {}

    fn event(&self, event: &tracing::Event<'_>) {
        match *event.metadata().level() {
            Level::WARN => self.saw_warn.store(true, Ordering::SeqCst),
            Level::INFO => self.saw_info.store(true, Ordering::SeqCst),
            _ => {}
        }
    }

    fn enter(&self, _span: &tracing::span::Id) {}

    fn exit(&self, _span: &tracing::span::Id) {}
}

#[test]
fn warns_when_latency_exceeds_threshold() {
    let (subscriber, saw_warn, saw_info) = LevelCapture::new();

    with_default(subscriber, || {
        let on_response = CustomOnResponse::new_with_threshold(Duration::from_millis(200));
        let response = http::Response::builder().status(200).body(()).unwrap();
        let span = tracing::info_span!("test");
        on_response.on_response(&response, Duration::from_millis(300), &span);
    });

    assert!(saw_warn.load(Ordering::SeqCst));
    assert!(!saw_info.load(Ordering::SeqCst));
}

#[test]
fn info_when_latency_below_threshold() {
    let (subscriber, saw_warn, saw_info) = LevelCapture::new();

    with_default(subscriber, || {
        let on_response = CustomOnResponse::new_with_threshold(Duration::from_millis(200));
        let response = http::Response::builder().status(200).body(()).unwrap();
        let span = tracing::info_span!("test");
        on_response.on_response(&response, Duration::from_millis(50), &span);
    });

    assert!(!saw_warn.load(Ordering::SeqCst));
    assert!(saw_info.load(Ordering::SeqCst));
}

#[test]
fn warns_when_latency_equals_threshold() {
    let (subscriber, saw_warn, _saw_info) = LevelCapture::new();

    with_default(subscriber, || {
        let on_response = CustomOnResponse::new_with_threshold(Duration::from_millis(200));
        let response = http::Response::builder().status(200).body(()).unwrap();
        let span = tracing::info_span!("test");
        on_response.on_response(&response, Duration::from_millis(200), &span);
    });

    assert!(saw_warn.load(Ordering::SeqCst));
}

#[tokio::test]
async fn starvation_detector_warns_when_runtime_blocked() {
    let (subscriber, saw_warn, _saw_info) = LevelCapture::new();
    let _guard = set_default(subscriber);

    spawn_starvation_detector(Duration::from_millis(10));

    // Let the detector initialize, consume its first tick, and enter the timing loop
    tokio::time::sleep(Duration::from_millis(15)).await;

    // Block the runtime thread — simulates starvation
    std::thread::sleep(Duration::from_millis(50));

    // Let the detector observe the delay and emit the warning
    tokio::time::sleep(Duration::from_millis(15)).await;

    assert!(saw_warn.load(Ordering::SeqCst));
}

#[tokio::test]
async fn starvation_detector_does_not_warn_within_grace_period() {
    tokio::time::pause();

    let (subscriber, saw_warn, _saw_info) = LevelCapture::new();
    let _guard = set_default(subscriber);

    spawn_starvation_detector(Duration::from_millis(50));

    // Let the detector initialize and consume its first tick
    tokio::task::yield_now().await;

    // Advance time by interval + 4ms, within the 5ms grace period
    tokio::time::advance(Duration::from_millis(54)).await;
    tokio::task::yield_now().await;

    assert!(!saw_warn.load(Ordering::SeqCst));
}
