//! Planned IDLE renewals stay healthy and never enter reconnect backoff.
use super::fakes::IdleWorkControl;
use super::*;
use tracing_subscriber::prelude::*;

#[derive(Clone)]
struct RetryCounts(Arc<std::sync::Mutex<Vec<u64>>>);
impl<S: tracing::Subscriber> tracing_subscriber::Layer<S> for RetryCounts {
    fn on_new_span(
        &self,
        attrs: &tracing::span::Attributes<'_>,
        _: &tracing::span::Id,
        _: tracing_subscriber::layer::Context<'_, S>,
    ) {
        if attrs.metadata().name() != "imap.account_round" {
            return;
        }
        struct Visitor<'a>(&'a mut Vec<u64>);
        impl tracing::field::Visit for Visitor<'_> {
            fn record_debug(&mut self, _: &tracing::field::Field, _: &dyn std::fmt::Debug) {}
            fn record_u64(&mut self, field: &tracing::field::Field, value: u64) {
                if field.name() == "retry_count" {
                    self.0.push(value);
                }
            }
        }
        attrs.record(&mut Visitor(&mut self.0.lock().unwrap()));
    }
}

#[tokio::test(start_paused = true)]
async fn a_planned_idle_restart_stays_stable_and_starts_the_next_round_without_backoff() {
    let retry_counts = Arc::new(std::sync::Mutex::new(Vec::new()));
    let _subscriber = tracing::subscriber::set_default(
        tracing_subscriber::registry().with(RetryCounts(retry_counts.clone())),
    );
    let repository = Arc::new(MemoryRepository {
        revision: Default::default(),
        scoped_acquire_errors: Default::default(),
        owner_claims: Default::default(),
        owner_gate: Default::default(),
        owner_errors: Default::default(),
        releases: Default::default(),
        acquire_gate: None,
        owner_available: AtomicBool::new(true),
        state: Default::default(),
        saved_unknown: AtomicBool::new(false),
    });
    let idle = Arc::new(IdleWorkControl {
        started: Default::default(),
        released: tokio::sync::Semaphore::new(0),
        outcome: WaitOutcome::Restarted,
    });
    let (started, mut rounds) = tokio::sync::mpsc::unbounded_channel();
    let control = Arc::new(ProviderWorkControl {
        idle: Some(idle.clone()),
        failures: Default::default(),
        organization: None,
        source: None,
        started,
        released: tokio::sync::Semaphore::new(1),
    });
    let transport = Arc::new(UncertainTransport {
        repository: repository.clone(),
        submissions: Default::default(),
        deadline: AtomicBool::new(false),
        submission_deadline: Default::default(),
        refusal: None,
        sent_found: Default::default(),
        provider_work: Some(control),
    });
    let engine = Engine::new(repository, Arc::new(TestCipher), transport);
    let binding = Binding {
        link_id: Uuid::now_v7(),
        sync_generation: 1,
        grant_generation: 1,
    };
    let cancelled = tokio_util::sync::CancellationToken::new();
    let mut actor = Box::pin(engine.run_account(binding, cancelled.clone()));
    assert!(futures::poll!(actor.as_mut()).is_pending());
    assert_eq!(rounds.try_recv().unwrap(), binding.link_id);
    let entered = idle.started.notified();
    tokio::pin!(entered);
    assert!(futures::poll!(entered.as_mut()).is_ready());
    let before = tokio::time::Instant::now();
    tokio::time::advance(std::time::Duration::from_secs(180)).await;
    idle.released.add_permits(1);
    assert!(futures::poll!(actor.as_mut()).is_pending());
    assert_eq!(
        rounds.try_recv().unwrap(),
        binding.link_id,
        "the next round must start without a reconnect delay"
    );
    assert_eq!(*retry_counts.lock().unwrap(), vec![0, 0]);
    assert_eq!(before.elapsed(), std::time::Duration::from_secs(180));
    assert_eq!(
        engine
            .idle_policy
            .lock()
            .unwrap()
            .state("imap.example.net")
            .cloned(),
        Some(crate::domain::adaptive_idle::IdleState::default()),
        "planned renewal is Stable, not drop evidence"
    );
    cancelled.cancel();
    actor.await.unwrap();
}
