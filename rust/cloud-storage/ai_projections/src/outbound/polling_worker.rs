//! Tokio polling worker for background projection generation.

use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use tokio::task::JoinHandle;

use crate::domain::models::{CompleteProjectionRequest, FailProjectionRequest, ProjectionInstance};
use crate::domain::ports::{AiProjectionRepository, ProjectionGenerator};

const DEFAULT_POLL_INTERVAL: Duration = Duration::from_secs(30);
const DEFAULT_CLEANUP_INTERVAL: Duration = Duration::from_secs(60 * 60);
const DEFAULT_MAX_PROJECTIONS_PER_TICK: usize = 10;
const MIN_POLL_INTERVAL: Duration = Duration::from_secs(1);
const MIN_CLEANUP_INTERVAL: Duration = Duration::from_secs(60);

/// Background worker that polls for due projection instances and materializes them.
pub struct AiProjectionPollingWorker<R, G> {
    repository: Arc<R>,
    generator: Arc<G>,
    poll_interval: Duration,
    cleanup_interval: Duration,
    max_projections_per_tick: usize,
}

impl<R, G> AiProjectionPollingWorker<R, G>
where
    R: AiProjectionRepository,
    G: ProjectionGenerator,
{
    /// Create a polling worker with conservative default intervals.
    pub fn new(repository: Arc<R>, generator: Arc<G>) -> Self {
        Self {
            repository,
            generator,
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

    /// Override how many due projections one polling tick may process.
    pub fn with_max_projections_per_tick(mut self, max_projections_per_tick: usize) -> Self {
        self.max_projections_per_tick = max_projections_per_tick.max(1);
        self
    }

    /// Spawn this worker on the Tokio runtime.
    pub fn spawn(self) -> JoinHandle<()> {
        tokio::spawn(async move { self.run().await })
    }

    /// Run the worker forever, logging per-tick failures and continuing.
    pub async fn run(self) {
        let mut next_cleanup = Instant::now();

        loop {
            let tick_started = Instant::now();

            if let Err(error) = self.run_pending_once().await {
                tracing::error!(error = ?error, "AI projection polling tick failed");
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

    /// Process currently due projections once, using the current time for claiming.
    pub async fn run_pending_once(&self) -> anyhow::Result<usize> {
        self.run_pending_once_at(Utc::now()).await
    }

    /// Process currently due projections once, using an explicit time for claiming.
    pub async fn run_pending_once_at(&self, now: DateTime<Utc>) -> anyhow::Result<usize> {
        let mut processed = 0;

        while processed < self.max_projections_per_tick {
            let claimed = self.process_next_due_projection_at(now).await?;
            if !claimed {
                break;
            }

            processed += 1;
        }

        if processed == self.max_projections_per_tick {
            tracing::debug!(
                processed,
                "AI projection polling tick reached the per-tick processing limit"
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

    async fn process_next_due_projection_at(&self, now: DateTime<Utc>) -> anyhow::Result<bool> {
        let Some(instance) = self
            .repository
            .claim_next_due_projection(now)
            .await
            .map_err(anyhow_error)?
        else {
            return Ok(false);
        };

        self.generate_claimed_projection(instance).await?;
        Ok(true)
    }

    async fn generate_claimed_projection(
        &self,
        instance: ProjectionInstance,
    ) -> anyhow::Result<()> {
        let cache_key = instance.cache_key.clone();
        let generation = self
            .generator
            .generate_projection(instance.generation_request())
            .await;

        match generation {
            Ok(generated) => {
                self.repository
                    .complete_generation(CompleteProjectionRequest {
                        cache_key: cache_key.clone(),
                        output: generated.output,
                        generated_at: Utc::now(),
                    })
                    .await
                    .map_err(anyhow_error)?;

                tracing::info!(cache_key = ?cache_key, "AI projection generated successfully");
            }
            Err(error) => {
                let error = anyhow_error(error);
                let message = format!("{error:#}");

                self.repository
                    .fail_generation(FailProjectionRequest {
                        cache_key: cache_key.clone(),
                        error: message.clone(),
                        failed_at: Utc::now(),
                    })
                    .await
                    .map_err(anyhow_error)?;

                tracing::warn!(
                    cache_key = ?cache_key,
                    error = %message,
                    "AI projection generation failed"
                );
            }
        }

        Ok(())
    }
}

/// Spawn a default AI projection polling worker on the Tokio runtime.
pub fn spawn_ai_projection_polling_worker<R, G>(
    repository: Arc<R>,
    generator: Arc<G>,
) -> JoinHandle<()>
where
    R: AiProjectionRepository,
    G: ProjectionGenerator,
{
    AiProjectionPollingWorker::new(repository, generator).spawn()
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
        GenerateProjectionRequest, GeneratedProjection, MaterializeProjectionRequest,
        ProjectionExpiry, ProjectionStatus, RefreshCadence, ScheduleProjectionRequest, Target,
        UpsertProjectionInstanceRequest,
    };

    #[tokio::test]
    async fn run_pending_once_completes_successful_generation() {
        let instance = projection_instance();
        let repository = Arc::new(FakeRepository::with_claims([instance]));
        let generator = Arc::new(FakeGenerator::with_responses([Ok(GeneratedProjection {
            output: "generated output".to_string(),
        })]));
        let worker = AiProjectionPollingWorker::new(repository.clone(), generator)
            .with_max_projections_per_tick(1);

        let processed = worker.run_pending_once_at(test_time()).await.unwrap();

        assert_eq!(processed, 1);
        assert_eq!(repository.completed_outputs(), vec!["generated output"]);
        assert!(repository.failed_errors().is_empty());
    }

    #[tokio::test]
    async fn run_pending_once_records_generation_failure() {
        let instance = projection_instance();
        let repository = Arc::new(FakeRepository::with_claims([instance]));
        let generator = Arc::new(FakeGenerator::with_responses([Err(anyhow::anyhow!(
            "generation failed"
        ))]));
        let worker = AiProjectionPollingWorker::new(repository.clone(), generator)
            .with_max_projections_per_tick(1);

        let processed = worker.run_pending_once_at(test_time()).await.unwrap();

        assert_eq!(processed, 1);
        assert!(repository.completed_outputs().is_empty());
        assert_eq!(repository.failed_errors(), vec!["generation failed"]);
    }

    #[tokio::test]
    async fn cleanup_expired_delegates_to_repository() {
        let repository = Arc::new(FakeRepository::with_cleanup_deleted(3));
        let generator = Arc::new(FakeGenerator::with_responses([]));
        let worker = AiProjectionPollingWorker::new(repository, generator);

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
        completed: Vec<CompleteProjectionRequest>,
        failed: Vec<FailProjectionRequest>,
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

        fn completed_outputs(&self) -> Vec<String> {
            self.state
                .lock()
                .expect("fake repository state lock")
                .completed
                .iter()
                .map(|request| request.output.clone())
                .collect()
        }

        fn failed_errors(&self) -> Vec<String> {
            self.state
                .lock()
                .expect("fake repository state lock")
                .failed
                .iter()
                .map(|request| request.error.clone())
                .collect()
        }
    }

    impl AiProjectionRepository for FakeRepository {
        type Err = anyhow::Error;

        fn get_or_create_instance(
            &self,
            _request: UpsertProjectionInstanceRequest,
        ) -> impl Future<Output = Result<ProjectionInstance, Self::Err>> + Send {
            async { unreachable!("worker does not create projection instances") }
        }

        fn schedule_generation(
            &self,
            _request: ScheduleProjectionRequest,
        ) -> impl Future<Output = Result<(), Self::Err>> + Send {
            async { unreachable!("worker does not schedule projection instances") }
        }

        fn user_can_access_team(
            &self,
            _user_id: MacroUserIdStr<'static>,
            _team_id: String,
        ) -> impl Future<Output = Result<bool, Self::Err>> + Send {
            async { unreachable!("worker does not authorize projection targets") }
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

        fn complete_generation(
            &self,
            request: CompleteProjectionRequest,
        ) -> impl Future<Output = Result<(), Self::Err>> + Send {
            self.state
                .lock()
                .expect("fake repository state lock")
                .completed
                .push(request);

            async { Ok(()) }
        }

        fn fail_generation(
            &self,
            request: FailProjectionRequest,
        ) -> impl Future<Output = Result<(), Self::Err>> + Send {
            self.state
                .lock()
                .expect("fake repository state lock")
                .failed
                .push(request);

            async { Ok(()) }
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

    struct FakeGenerator {
        responses: Mutex<VecDeque<anyhow::Result<GeneratedProjection>>>,
    }

    impl FakeGenerator {
        fn with_responses(
            responses: impl IntoIterator<Item = anyhow::Result<GeneratedProjection>>,
        ) -> Self {
            Self {
                responses: Mutex::new(responses.into_iter().collect()),
            }
        }
    }

    impl ProjectionGenerator for FakeGenerator {
        type Err = anyhow::Error;

        fn generate_projection(
            &self,
            _request: GenerateProjectionRequest,
        ) -> impl Future<Output = Result<GeneratedProjection, Self::Err>> + Send {
            let response = self
                .responses
                .lock()
                .expect("fake generator responses lock")
                .pop_front()
                .expect("fake generator response");

            async move { response }
        }
    }

    fn projection_instance() -> ProjectionInstance {
        let request = MaterializeProjectionRequest {
            id: "inbox/important".to_string(),
            target: Target::user("macro|projection@example.com"),
            prompt: "What should I triage first?".to_string(),
            context: Some("Unread inbox notifications".to_string()),
            refresh_cadence: RefreshCadence::High,
            expiry: Some(ProjectionExpiry::Day),
            schema: None,
            force_refresh: false,
        };
        let upsert_request = UpsertProjectionInstanceRequest::from_materialize_request(
            &request,
            user_id("macro|projection@example.com"),
            test_time(),
        );

        let mut instance = ProjectionInstance::cold(Uuid::new_v4(), &upsert_request);
        instance.status = ProjectionStatus::Refreshing;
        instance.claimed_at = Some(test_time());
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
