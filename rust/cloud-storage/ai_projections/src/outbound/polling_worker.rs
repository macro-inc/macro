//! Tokio polling scheduler for enqueueing due AI projection refreshes.

use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use tokio::task::JoinHandle;

use crate::domain::models::{
    AiProjectionGenerationRequested, ProjectionInstance, ProjectionStatus,
    ReleaseProjectionClaimRequest, ScheduleGenerationReason,
};
use crate::domain::ports::{AiProjectionGenerationPublisher, AiProjectionRepository};

const DEFAULT_POLL_INTERVAL: Duration = Duration::from_secs(30);
const DEFAULT_CLEANUP_INTERVAL: Duration = Duration::from_secs(60 * 60);
const DEFAULT_MAX_PROJECTIONS_PER_TICK: usize = 10;
const MIN_POLL_INTERVAL: Duration = Duration::from_secs(1);
const MIN_CLEANUP_INTERVAL: Duration = Duration::from_secs(60);

/// Background scheduler that enqueues due projection refreshes.
pub struct AiProjectionPollingWorker<R, P> {
    repository: Arc<R>,
    publisher: Arc<P>,
    poll_interval: Duration,
    cleanup_interval: Duration,
    max_projections_per_tick: usize,
}

impl<R, P> AiProjectionPollingWorker<R, P>
where
    R: AiProjectionRepository,
    P: AiProjectionGenerationPublisher,
{
    /// Create a polling scheduler with conservative default intervals.
    pub fn new(repository: Arc<R>, publisher: Arc<P>) -> Self {
        Self {
            repository,
            publisher,
            poll_interval: DEFAULT_POLL_INTERVAL,
            cleanup_interval: DEFAULT_CLEANUP_INTERVAL,
            max_projections_per_tick: DEFAULT_MAX_PROJECTIONS_PER_TICK,
        }
    }

    /// Override the poll interval, clamped to a one-second minimum.
    pub fn with_poll_interval(mut self, poll_interval: Duration) -> Self {
        self.poll_interval = poll_interval.max(MIN_POLL_INTERVAL);
        self
    }

    /// Override the cleanup interval, clamped to a one-minute minimum.
    pub fn with_cleanup_interval(mut self, cleanup_interval: Duration) -> Self {
        self.cleanup_interval = cleanup_interval.max(MIN_CLEANUP_INTERVAL);
        self
    }

    /// Override how many due projections one polling tick may enqueue.
    pub fn with_max_projections_per_tick(mut self, max_projections_per_tick: usize) -> Self {
        self.max_projections_per_tick = max_projections_per_tick.max(1);
        self
    }

    /// Spawn this scheduler on the Tokio runtime.
    pub fn spawn(self) -> JoinHandle<()> {
        tokio::spawn(async move { self.run().await })
    }

    /// Run the scheduler forever, logging per-tick failures and continuing.
    pub async fn run(self) {
        let mut next_cleanup = Instant::now();

        loop {
            let tick_started = Instant::now();

            if let Err(error) = self.run_pending_once().await {
                tracing::error!(error = ?error, "AI projection due-refresh enqueue tick failed");
            }

            if Instant::now() >= next_cleanup {
                if let Err(error) = self.cleanup_expired().await {
                    tracing::error!(error = ?error, "AI projection cleanup failed");
                }
                next_cleanup = Instant::now() + self.cleanup_interval;
            }

            sleep_until_next_poll(tick_started, self.poll_interval).await;
        }
    }

    /// Enqueue currently due projections once, using the current time for claiming.
    pub async fn run_pending_once(&self) -> anyhow::Result<usize> {
        self.run_pending_once_at(Utc::now()).await
    }

    /// Enqueue currently due projections once, using an explicit time for claiming.
    pub async fn run_pending_once_at(&self, now: DateTime<Utc>) -> anyhow::Result<usize> {
        let mut processed = 0;

        while processed < self.max_projections_per_tick {
            let claimed = self.enqueue_next_due_projection_at(now).await?;
            if !claimed {
                break;
            }

            processed += 1;
        }

        if processed == self.max_projections_per_tick {
            tracing::debug!(
                processed,
                "AI projection polling tick reached the per-tick enqueue limit"
            );
        }

        Ok(processed)
    }

    /// Run expiry cleanup using the current time.
    pub async fn cleanup_expired(&self) -> anyhow::Result<u64> {
        self.cleanup_expired_at(Utc::now()).await
    }

    /// Run expiry cleanup using an explicit time.
    pub async fn cleanup_expired_at(&self, now: DateTime<Utc>) -> anyhow::Result<u64> {
        let deleted = self
            .repository
            .cleanup_expired(now)
            .await
            .map_err(anyhow_error)?;

        if deleted > 0 {
            tracing::info!(deleted, "deleted expired AI projection instances");
        }

        Ok(deleted)
    }

    async fn enqueue_next_due_projection_at(&self, now: DateTime<Utc>) -> anyhow::Result<bool> {
        let Some(instance) = self
            .repository
            .claim_next_due_projection(now)
            .await
            .map_err(anyhow_error)?
        else {
            return Ok(false);
        };

        self.enqueue_claimed_projection(instance, now).await?;
        Ok(true)
    }

    async fn enqueue_claimed_projection(
        &self,
        instance: ProjectionInstance,
        now: DateTime<Utc>,
    ) -> anyhow::Result<()> {
        let cache_key = instance.cache_key.clone();
        let event = AiProjectionGenerationRequested {
            cache_key: cache_key.clone(),
            reason: reason_for_due_instance(&instance),
            requested_by: instance.generation_user_id.clone(),
            generation_user_id: instance.generation_user_id,
            enqueued_at: now,
        };

        self.publisher
            .publish_generation_requested(event)
            .await
            .map_err(anyhow_error)?;

        self.repository
            .release_generation_claim(ReleaseProjectionClaimRequest {
                cache_key: cache_key.clone(),
                released_at: now,
            })
            .await
            .map_err(anyhow_error)?;

        tracing::info!(cache_key = ?cache_key, "AI projection refresh enqueued");
        Ok(())
    }
}

/// Spawn a default AI projection due-refresh scheduler on the Tokio runtime.
pub fn spawn_ai_projection_polling_worker<R, P>(
    repository: Arc<R>,
    publisher: Arc<P>,
) -> JoinHandle<()>
where
    R: AiProjectionRepository,
    P: AiProjectionGenerationPublisher,
{
    AiProjectionPollingWorker::new(repository, publisher).spawn()
}

fn reason_for_due_instance(instance: &ProjectionInstance) -> ScheduleGenerationReason {
    match instance.status {
        ProjectionStatus::Cold => ScheduleGenerationReason::ColdStart,
        ProjectionStatus::Error => ScheduleGenerationReason::Retry,
        ProjectionStatus::Ready | ProjectionStatus::Refreshing => ScheduleGenerationReason::Stale,
    }
}

async fn sleep_until_next_poll(tick_started: Instant, poll_interval: Duration) {
    let elapsed = tick_started.elapsed();
    if elapsed < poll_interval {
        tokio::time::sleep(poll_interval - elapsed).await;
    } else {
        tokio::task::yield_now().await;
    }
}

fn anyhow_error<E>(error: E) -> anyhow::Error
where
    E: Into<anyhow::Error>,
{
    error.into()
}

#[cfg(test)]
mod test {
    use std::collections::VecDeque;
    use std::future::Future;
    use std::sync::Mutex;

    use macro_user_id::user_id::MacroUserIdStr;
    use uuid::Uuid;

    use super::*;
    use crate::domain::models::{
        ClaimProjectionGenerationRequest, ClaimProjectionGenerationResult,
        CompleteProjectionRequest, FailProjectionRequest, MaterializeProjectionRequest,
        ProjectionExpiry, RawProjectionGenerationMessage, RefreshCadence,
        ScheduleProjectionRequest, Target, UpsertProjectionInstanceRequest,
    };
    use crate::domain::ports::AiProjectionGenerationQueue;

    #[tokio::test]
    async fn run_pending_once_enqueues_due_projection_and_releases_claim() {
        let instance = projection_instance();
        let repository = Arc::new(FakeRepository::with_claims([instance]));
        let publisher = Arc::new(FakePublisher::default());
        let worker = AiProjectionPollingWorker::new(repository.clone(), publisher.clone())
            .with_max_projections_per_tick(1);

        let processed = worker.run_pending_once_at(test_time()).await.unwrap();

        assert_eq!(processed, 1);
        assert_eq!(publisher.events().len(), 1);
        assert_eq!(
            publisher.events()[0].reason,
            ScheduleGenerationReason::Stale
        );
        assert_eq!(repository.released_count(), 1);
    }

    #[tokio::test]
    async fn run_pending_once_keeps_claim_when_publish_fails() {
        let instance = projection_instance();
        let repository = Arc::new(FakeRepository::with_claims([instance]));
        let publisher = Arc::new(FakePublisher::failing());
        let worker = AiProjectionPollingWorker::new(repository.clone(), publisher)
            .with_max_projections_per_tick(1);

        let error = worker
            .run_pending_once_at(test_time())
            .await
            .expect_err("enqueue should fail");

        assert!(error.to_string().contains("publisher unavailable"));
        assert_eq!(repository.released_count(), 0);
    }

    #[tokio::test]
    async fn cleanup_expired_delegates_to_repository() {
        let repository = Arc::new(FakeRepository::with_cleanup_deleted(3));
        let publisher = Arc::new(FakePublisher::default());
        let worker = AiProjectionPollingWorker::new(repository, publisher);

        let deleted = worker.cleanup_expired_at(test_time()).await.unwrap();

        assert_eq!(deleted, 3);
    }

    #[derive(Default)]
    struct FakeRepository {
        state: Mutex<FakeRepositoryState>,
    }

    #[derive(Default)]
    struct FakeRepositoryState {
        claims: VecDeque<ProjectionInstance>,
        released: Vec<ReleaseProjectionClaimRequest>,
        cleanup_deleted: u64,
    }

    impl FakeRepository {
        fn with_claims(claims: impl IntoIterator<Item = ProjectionInstance>) -> Self {
            Self {
                state: Mutex::new(FakeRepositoryState {
                    claims: claims.into_iter().collect(),
                    ..FakeRepositoryState::default()
                }),
            }
        }

        fn with_cleanup_deleted(cleanup_deleted: u64) -> Self {
            Self {
                state: Mutex::new(FakeRepositoryState {
                    cleanup_deleted,
                    ..FakeRepositoryState::default()
                }),
            }
        }

        fn released_count(&self) -> usize {
            self.state
                .lock()
                .expect("fake repository state lock")
                .released
                .len()
        }
    }

    impl AiProjectionRepository for FakeRepository {
        type Err = anyhow::Error;

        fn get_or_create_instance(
            &self,
            _request: UpsertProjectionInstanceRequest,
        ) -> impl Future<Output = Result<ProjectionInstance, Self::Err>> + Send {
            async { unreachable!("scheduler does not create projection instances") }
        }

        fn schedule_generation(
            &self,
            _request: ScheduleProjectionRequest,
        ) -> impl Future<Output = Result<(), Self::Err>> + Send {
            async { unreachable!("scheduler does not schedule from materialize requests") }
        }

        fn user_can_access_team(
            &self,
            _user_id: MacroUserIdStr<'static>,
            _team_id: String,
        ) -> impl Future<Output = Result<bool, Self::Err>> + Send {
            async { unreachable!("scheduler does not authorize projection targets") }
        }

        fn claim_next_due_projection(
            &self,
            _now: DateTime<Utc>,
        ) -> impl Future<Output = Result<Option<ProjectionInstance>, Self::Err>> + Send {
            let claim = self
                .state
                .lock()
                .expect("fake repository state lock")
                .claims
                .pop_front();

            async move { Ok(claim) }
        }

        fn claim_generation_by_cache_key(
            &self,
            _request: ClaimProjectionGenerationRequest,
        ) -> impl Future<Output = Result<ClaimProjectionGenerationResult, Self::Err>> + Send
        {
            async { unreachable!("scheduler does not consume queue messages") }
        }

        fn release_generation_claim(
            &self,
            request: ReleaseProjectionClaimRequest,
        ) -> impl Future<Output = Result<(), Self::Err>> + Send {
            self.state
                .lock()
                .expect("fake repository state lock")
                .released
                .push(request);

            async { Ok(()) }
        }

        fn complete_generation(
            &self,
            _request: CompleteProjectionRequest,
        ) -> impl Future<Output = Result<(), Self::Err>> + Send {
            async { unreachable!("scheduler does not complete projection generation") }
        }

        fn fail_generation(
            &self,
            _request: FailProjectionRequest,
        ) -> impl Future<Output = Result<(), Self::Err>> + Send {
            async { unreachable!("scheduler does not record generation failures") }
        }

        fn cleanup_expired(
            &self,
            _now: DateTime<Utc>,
        ) -> impl Future<Output = Result<u64, Self::Err>> + Send {
            let deleted = self
                .state
                .lock()
                .expect("fake repository state lock")
                .cleanup_deleted;

            async move { Ok(deleted) }
        }
    }

    #[derive(Default)]
    struct FakePublisher {
        state: Mutex<FakePublisherState>,
    }

    #[derive(Default)]
    struct FakePublisherState {
        events: Vec<AiProjectionGenerationRequested>,
        fail: bool,
    }

    impl FakePublisher {
        fn failing() -> Self {
            Self {
                state: Mutex::new(FakePublisherState {
                    fail: true,
                    ..FakePublisherState::default()
                }),
            }
        }

        fn events(&self) -> Vec<AiProjectionGenerationRequested> {
            self.state
                .lock()
                .expect("fake publisher state lock")
                .events
                .clone()
        }
    }

    impl AiProjectionGenerationPublisher for FakePublisher {
        type Err = anyhow::Error;

        fn publish_generation_requested(
            &self,
            event: AiProjectionGenerationRequested,
        ) -> impl Future<Output = Result<(), Self::Err>> + Send {
            let result = {
                let mut state = self.state.lock().expect("fake publisher state lock");
                if state.fail {
                    Err(anyhow::anyhow!("publisher unavailable"))
                } else {
                    state.events.push(event);
                    Ok(())
                }
            };

            async move { result }
        }
    }

    impl AiProjectionGenerationQueue for FakePublisher {
        fn receive_generation_messages(
            &self,
        ) -> impl Future<Output = Result<Vec<RawProjectionGenerationMessage>, Self::Err>> + Send
        {
            async { Ok(Vec::new()) }
        }

        fn delete_generation_message(
            &self,
            _receipt_handle: String,
        ) -> impl Future<Output = Result<(), Self::Err>> + Send {
            async { Ok(()) }
        }
    }

    fn projection_instance() -> ProjectionInstance {
        let requester = user_id("macro|projection@example.com");
        let request = MaterializeProjectionRequest {
            id: "inbox/important".to_string(),
            target: Target::user(requester.to_string()),
            prompt: "What should I triage first?".to_string(),
            context: None,
            refresh_cadence: RefreshCadence::High,
            expiry: Some(ProjectionExpiry::Day),
            schema: None,
            force_refresh: false,
        };
        let upsert = UpsertProjectionInstanceRequest::from_materialize_request(
            &request,
            requester,
            test_time(),
        );
        let mut instance = ProjectionInstance::cold(Uuid::new_v4(), &upsert);
        instance.status = ProjectionStatus::Ready;
        instance.output = Some("cached output".to_string());
        instance.generated_at = Some(test_time() - chrono::Duration::hours(2));
        instance.stale_at = Some(test_time() - chrono::Duration::hours(1));
        instance.next_refresh_at = test_time() - chrono::Duration::hours(1);
        instance
    }

    fn user_id(value: &str) -> MacroUserIdStr<'static> {
        MacroUserIdStr::try_from(value.to_string()).expect("valid macro user id")
    }

    fn test_time() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-06-17T16:30:00Z")
            .expect("valid timestamp")
            .with_timezone(&Utc)
    }
}
