//! SQS-backed inbound worker for AI projection generation requests.

use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use tokio::task::JoinHandle;

use crate::domain::models::{
    AiProjectionGenerationRequested, ClaimProjectionGenerationRequest,
    ClaimProjectionGenerationResult, CompleteProjectionRequest, FailProjectionRequest,
    ProjectionInstance, RawProjectionGenerationMessage,
};
use crate::domain::ports::{
    AiProjectionGenerationQueue, AiProjectionRepository, ProjectionGenerator,
};

const IDLE_SLEEP: Duration = Duration::from_secs(1);

/// SQS worker that consumes projection generation messages and runs the generator.
pub struct AiProjectionSqsWorker<R, G, Q> {
    repository: Arc<R>,
    generator: Arc<G>,
    queue: Arc<Q>,
    idle_sleep: Duration,
}

impl<R, G, Q> AiProjectionSqsWorker<R, G, Q>
where
    R: AiProjectionRepository,
    G: ProjectionGenerator,
    Q: AiProjectionGenerationQueue,
{
    /// Create an SQS projection worker.
    pub fn new(repository: Arc<R>, generator: Arc<G>, queue: Arc<Q>) -> Self {
        Self {
            repository,
            generator,
            queue,
            idle_sleep: IDLE_SLEEP,
        }
    }

    /// Override the idle sleep used after empty polls or queue-level failures.
    pub fn with_idle_sleep(mut self, idle_sleep: Duration) -> Self {
        self.idle_sleep = idle_sleep;
        self
    }

    /// Spawn this worker on the Tokio runtime.
    pub fn spawn(self) -> JoinHandle<()> {
        tokio::spawn(async move { self.run().await })
    }

    /// Run the worker forever, logging failures and continuing.
    pub async fn run(self) {
        loop {
            match self.run_once().await {
                Ok(0) => tokio::time::sleep(self.idle_sleep).await,
                Ok(_) => {}
                Err(error) => {
                    tracing::error!(error = ?error, "AI projection SQS worker tick failed");
                    tokio::time::sleep(self.idle_sleep).await;
                }
            }
        }
    }

    /// Receive and handle one batch of projection generation messages.
    pub async fn run_once(&self) -> anyhow::Result<usize> {
        let messages = self
            .queue
            .receive_generation_messages()
            .await
            .map_err(anyhow_error)?;
        let message_count = messages.len();

        for message in messages {
            if let Err(error) = self.handle_raw_message(message).await {
                tracing::error!(error = ?error, "AI projection SQS message handling failed");
            }
        }

        Ok(message_count)
    }

    async fn handle_raw_message(
        &self,
        message: RawProjectionGenerationMessage,
    ) -> anyhow::Result<()> {
        let message_id = message.message_id.clone();
        let Some(receipt_handle) = message.receipt_handle else {
            tracing::warn!(message_id = ?message_id, "AI projection SQS message missing receipt handle");
            return Ok(());
        };

        let Some(body) = message.body else {
            tracing::warn!(message_id = ?message_id, "AI projection SQS message missing body");
            self.delete_message(receipt_handle).await?;
            return Ok(());
        };

        let event = match serde_json::from_str::<AiProjectionGenerationRequested>(&body) {
            Ok(event) => event,
            Err(error) => {
                tracing::warn!(
                    message_id = ?message_id,
                    error = ?error,
                    body,
                    "AI projection SQS message is malformed"
                );
                self.delete_message(receipt_handle).await?;
                return Ok(());
            }
        };

        match self.handle_generation_event(&event).await? {
            MessageDisposition::Delete => self.delete_message(receipt_handle).await?,
            MessageDisposition::RetryLater => {
                tracing::debug!(
                    message_id = ?message_id,
                    cache_key = ?event.cache_key,
                    "AI projection generation message left for retry"
                );
            }
        }

        Ok(())
    }

    async fn handle_generation_event(
        &self,
        event: &AiProjectionGenerationRequested,
    ) -> anyhow::Result<MessageDisposition> {
        let claim_result = self
            .repository
            .claim_generation_by_cache_key(ClaimProjectionGenerationRequest {
                cache_key: event.cache_key.clone(),
                generation_user_id: event.generation_user_id.clone(),
                enqueued_at: event.enqueued_at,
                claimed_at: Utc::now(),
            })
            .await
            .map_err(anyhow_error)?;

        match claim_result {
            ClaimProjectionGenerationResult::Claimed(instance) => {
                self.generate_claimed_projection(*instance).await?;
                Ok(MessageDisposition::Delete)
            }
            ClaimProjectionGenerationResult::NotFound => {
                tracing::warn!(cache_key = ?event.cache_key, "AI projection generation target not found");
                Ok(MessageDisposition::Delete)
            }
            ClaimProjectionGenerationResult::Expired => {
                tracing::info!(cache_key = ?event.cache_key, "AI projection generation target expired");
                Ok(MessageDisposition::Delete)
            }
            ClaimProjectionGenerationResult::Superseded => {
                tracing::debug!(cache_key = ?event.cache_key, "AI projection generation message superseded");
                Ok(MessageDisposition::Delete)
            }
            ClaimProjectionGenerationResult::AlreadyClaimed => {
                tracing::debug!(cache_key = ?event.cache_key, "AI projection already claimed");
                Ok(MessageDisposition::RetryLater)
            }
        }
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

    async fn delete_message(&self, receipt_handle: String) -> anyhow::Result<()> {
        self.queue
            .delete_generation_message(receipt_handle)
            .await
            .map_err(anyhow_error)
    }
}

/// Spawn a default SQS AI projection generation worker on the Tokio runtime.
pub fn spawn_ai_projection_sqs_worker<R, G, Q>(
    repository: Arc<R>,
    generator: Arc<G>,
    queue: Arc<Q>,
) -> JoinHandle<()>
where
    R: AiProjectionRepository,
    G: ProjectionGenerator,
    Q: AiProjectionGenerationQueue,
{
    AiProjectionSqsWorker::new(repository, generator, queue).spawn()
}

enum MessageDisposition {
    Delete,
    RetryLater,
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

    use chrono::{DateTime, Duration as ChronoDuration, Utc};
    use macro_user_id::user_id::MacroUserIdStr;
    use uuid::Uuid;

    use super::*;
    use crate::domain::models::{
        AiProjectionCacheKey, GeneratedProjection, MaterializeProjectionRequest, ProjectionExpiry,
        ProjectionStatus, RefreshCadence, ReleaseProjectionClaimRequest, ScheduleGenerationReason,
        ScheduleProjectionRequest, Target, UpsertProjectionInstanceRequest,
    };
    use crate::domain::ports::AiProjectionGenerationPublisher;

    #[tokio::test]
    async fn sqs_worker_deletes_malformed_message() {
        let repository = Arc::new(FakeRepository::default());
        let generator = Arc::new(FakeGenerator::with_responses([]));
        let queue = Arc::new(FakeQueue::with_messages([RawProjectionGenerationMessage {
            message_id: Some("message-1".to_string()),
            body: Some("not-json".to_string()),
            receipt_handle: Some("receipt-1".to_string()),
        }]));
        let worker = AiProjectionSqsWorker::new(repository, generator, queue.clone());

        let processed = worker.run_once().await.expect("worker run");

        assert_eq!(processed, 1);
        assert_eq!(queue.deleted_receipts(), vec!["receipt-1"]);
    }

    #[tokio::test]
    async fn sqs_worker_generates_claimed_projection_and_deletes_message() {
        let event = generation_event();
        let instance = projection_instance(&event.cache_key, event.generation_user_id.clone());
        let repository = Arc::new(FakeRepository::with_claim_results([
            ClaimProjectionGenerationResult::Claimed(Box::new(instance)),
        ]));
        let generator = Arc::new(FakeGenerator::with_responses([Ok(GeneratedProjection {
            output: "generated output".to_string(),
        })]));
        let queue = Arc::new(FakeQueue::with_messages([queue_message(&event)]));
        let worker = AiProjectionSqsWorker::new(repository.clone(), generator, queue.clone());

        let processed = worker.run_once().await.expect("worker run");

        assert_eq!(processed, 1);
        assert_eq!(repository.completed_outputs(), vec!["generated output"]);
        assert!(repository.failed_errors().is_empty());
        assert_eq!(queue.deleted_receipts(), vec!["receipt-1"]);
    }

    #[tokio::test]
    async fn sqs_worker_persists_failure_and_deletes_message() {
        let event = generation_event();
        let instance = projection_instance(&event.cache_key, event.generation_user_id.clone());
        let repository = Arc::new(FakeRepository::with_claim_results([
            ClaimProjectionGenerationResult::Claimed(Box::new(instance)),
        ]));
        let generator = Arc::new(FakeGenerator::with_responses([Err(anyhow::anyhow!(
            "generation failed"
        ))]));
        let queue = Arc::new(FakeQueue::with_messages([queue_message(&event)]));
        let worker = AiProjectionSqsWorker::new(repository.clone(), generator, queue.clone());

        let processed = worker.run_once().await.expect("worker run");

        assert_eq!(processed, 1);
        assert!(repository.completed_outputs().is_empty());
        assert_eq!(repository.failed_errors(), vec!["generation failed"]);
        assert_eq!(queue.deleted_receipts(), vec!["receipt-1"]);
    }

    #[tokio::test]
    async fn sqs_worker_leaves_already_claimed_message_for_retry() {
        let event = generation_event();
        let repository = Arc::new(FakeRepository::with_claim_results([
            ClaimProjectionGenerationResult::AlreadyClaimed,
        ]));
        let generator = Arc::new(FakeGenerator::with_responses([]));
        let queue = Arc::new(FakeQueue::with_messages([queue_message(&event)]));
        let worker = AiProjectionSqsWorker::new(repository, generator, queue.clone());

        let processed = worker.run_once().await.expect("worker run");

        assert_eq!(processed, 1);
        assert_eq!(queue.deleted_receipts(), Vec::<String>::new());
    }

    #[derive(Default)]
    struct FakeRepository {
        state: Mutex<FakeRepositoryState>,
    }

    #[derive(Default)]
    struct FakeRepositoryState {
        claim_results: VecDeque<ClaimProjectionGenerationResult>,
        completed: Vec<CompleteProjectionRequest>,
        failed: Vec<FailProjectionRequest>,
    }

    impl FakeRepository {
        fn with_claim_results(
            results: impl IntoIterator<Item = ClaimProjectionGenerationResult>,
        ) -> Self {
            Self {
                state: Mutex::new(FakeRepositoryState {
                    claim_results: results.into_iter().collect(),
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
            async { unreachable!("SQS worker does not create projection instances") }
        }

        fn schedule_generation(
            &self,
            _request: ScheduleProjectionRequest,
        ) -> impl Future<Output = Result<(), Self::Err>> + Send {
            async { unreachable!("SQS worker does not schedule materialization") }
        }

        fn user_can_access_team(
            &self,
            _user_id: MacroUserIdStr<'static>,
            _team_id: String,
        ) -> impl Future<Output = Result<bool, Self::Err>> + Send {
            async { unreachable!("SQS worker does not authorize projection targets") }
        }

        fn claim_next_due_projection(
            &self,
            _now: DateTime<Utc>,
        ) -> impl Future<Output = Result<Option<ProjectionInstance>, Self::Err>> + Send {
            async { unreachable!("SQS worker does not scan for due projections") }
        }

        fn claim_generation_by_cache_key(
            &self,
            _request: ClaimProjectionGenerationRequest,
        ) -> impl Future<Output = Result<ClaimProjectionGenerationResult, Self::Err>> + Send
        {
            let result = self
                .state
                .lock()
                .expect("fake repository state lock")
                .claim_results
                .pop_front()
                .unwrap_or(ClaimProjectionGenerationResult::NotFound);

            async move { Ok(result) }
        }

        fn release_generation_claim(
            &self,
            _request: ReleaseProjectionClaimRequest,
        ) -> impl Future<Output = Result<(), Self::Err>> + Send {
            async { unreachable!("SQS worker does not release enqueue claims") }
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
            async { Ok(0) }
        }
    }

    struct FakeGenerator {
        state: Mutex<VecDeque<Result<GeneratedProjection, anyhow::Error>>>,
    }

    impl FakeGenerator {
        fn with_responses(
            responses: impl IntoIterator<Item = Result<GeneratedProjection, anyhow::Error>>,
        ) -> Self {
            Self {
                state: Mutex::new(responses.into_iter().collect()),
            }
        }
    }

    impl ProjectionGenerator for FakeGenerator {
        type Err = anyhow::Error;

        fn generate_projection(
            &self,
            _request: crate::domain::models::GenerateProjectionRequest,
        ) -> impl Future<Output = Result<GeneratedProjection, Self::Err>> + Send {
            let response = self
                .state
                .lock()
                .expect("fake generator state lock")
                .pop_front()
                .unwrap_or_else(|| Err(anyhow::anyhow!("missing fake generator response")));

            async move { response }
        }
    }

    #[derive(Default)]
    struct FakeQueue {
        state: Mutex<FakeQueueState>,
    }

    #[derive(Default)]
    struct FakeQueueState {
        messages: VecDeque<RawProjectionGenerationMessage>,
        deleted_receipts: Vec<String>,
    }

    impl FakeQueue {
        fn with_messages(
            messages: impl IntoIterator<Item = RawProjectionGenerationMessage>,
        ) -> Self {
            Self {
                state: Mutex::new(FakeQueueState {
                    messages: messages.into_iter().collect(),
                    ..FakeQueueState::default()
                }),
            }
        }

        fn deleted_receipts(&self) -> Vec<String> {
            self.state
                .lock()
                .expect("fake queue state lock")
                .deleted_receipts
                .clone()
        }
    }

    impl AiProjectionGenerationPublisher for FakeQueue {
        type Err = anyhow::Error;

        fn publish_generation_requested(
            &self,
            _event: AiProjectionGenerationRequested,
        ) -> impl Future<Output = Result<(), Self::Err>> + Send {
            async { Ok(()) }
        }
    }

    impl AiProjectionGenerationQueue for FakeQueue {
        fn receive_generation_messages(
            &self,
        ) -> impl Future<Output = Result<Vec<RawProjectionGenerationMessage>, Self::Err>> + Send
        {
            let messages = self
                .state
                .lock()
                .expect("fake queue state lock")
                .messages
                .drain(..)
                .collect();

            async move { Ok(messages) }
        }

        fn delete_generation_message(
            &self,
            receipt_handle: String,
        ) -> impl Future<Output = Result<(), Self::Err>> + Send {
            self.state
                .lock()
                .expect("fake queue state lock")
                .deleted_receipts
                .push(receipt_handle);

            async { Ok(()) }
        }
    }

    fn queue_message(event: &AiProjectionGenerationRequested) -> RawProjectionGenerationMessage {
        RawProjectionGenerationMessage {
            message_id: Some("message-1".to_string()),
            body: Some(serde_json::to_string(event).expect("serialize event")),
            receipt_handle: Some("receipt-1".to_string()),
        }
    }

    fn generation_event() -> AiProjectionGenerationRequested {
        let user = user_id("macro|projection@example.com");
        AiProjectionGenerationRequested {
            cache_key: AiProjectionCacheKey {
                projection_id: "inbox/important".to_string(),
                target: Target::user(user.to_string()),
                prompt_hash: "hash".to_string(),
            },
            reason: ScheduleGenerationReason::ColdStart,
            requested_by: user.clone(),
            generation_user_id: user,
            enqueued_at: test_time(),
        }
    }

    fn projection_instance(
        cache_key: &AiProjectionCacheKey,
        generation_user_id: MacroUserIdStr<'static>,
    ) -> ProjectionInstance {
        let request = MaterializeProjectionRequest {
            id: cache_key.projection_id.clone(),
            target: cache_key.target.clone(),
            prompt: "What should I triage first?".to_string(),
            context: None,
            refresh_cadence: RefreshCadence::High,
            expiry: Some(ProjectionExpiry::Day),
            schema: None,
            force_refresh: false,
        };
        let upsert = UpsertProjectionInstanceRequest::from_materialize_request(
            &request,
            generation_user_id,
            test_time(),
        );
        let mut instance = ProjectionInstance::cold(Uuid::new_v4(), &upsert);
        instance.cache_key = cache_key.clone();
        instance.status = ProjectionStatus::Refreshing;
        instance.claimed_at = Some(test_time());
        instance.next_refresh_at = test_time() - ChronoDuration::minutes(1);
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
