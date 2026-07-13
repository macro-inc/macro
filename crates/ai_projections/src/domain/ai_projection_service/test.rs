use std::sync::{Arc, Mutex};

use chrono::Utc;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_ai_projection::AiProjectionQueueMessage;

use crate::domain::{
    ai_projection_queue::AiProjectionQueue,
    ai_projection_repo::AiProjectionRepository,
    ai_projection_service::{
        AiProjectionService, AiProjectionServiceImpl, hash_projection_version,
    },
    model::{
        AiProjection, AiProjectionError, Expiry, ProjectionStatus, RefreshCadence, TargetType,
        UpsertProjectionError, UpsertProjectionParams, UserAiProjection,
    },
    projection_generator::{GenerationRequest, ProjectionGenerator},
    projection_notifier::ProjectionNotifier,
};

/// The prompt the mock repository reports for any projection definition.
const TEST_PROMPT: &str = "What is important?";

/// The version hash of [`TEST_PROMPT`] with no model or schema.
fn test_hash() -> String {
    hash_projection_version(TEST_PROMPT, None, None)
}

/// A tiny in-memory mock queue that records enqueued materialization messages.
#[derive(Clone, Default)]
struct MockQueue {
    enqueued: Arc<Mutex<Vec<AiProjectionQueueMessage>>>,
}

impl AiProjectionQueue for MockQueue {
    async fn enqueue_materialization(
        &self,
        message: AiProjectionQueueMessage,
    ) -> Result<(), AiProjectionError> {
        self.enqueued.lock().unwrap().push(message);
        Ok(())
    }
}

/// A mock generator that records its calls and returns a canned response (or an
/// error when `fail` is set).
#[derive(Clone, Default)]
struct MockGenerator {
    response: String,
    fail: bool,
    calls: Arc<Mutex<Vec<(String, String, Option<String>, Option<serde_json::Value>)>>>,
}

impl ProjectionGenerator for MockGenerator {
    async fn generate(
        &self,
        user_id: &MacroUserIdStr<'_>,
        request: GenerationRequest<'_>,
    ) -> Result<String, AiProjectionError> {
        self.calls.lock().unwrap().push((
            user_id.as_ref().to_string(),
            request.prompt.to_string(),
            request.model.map(str::to_string),
            request.output_schema.cloned(),
        ));
        if self.fail {
            return Err(AiProjectionError::Generation("boom".to_string()));
        }
        Ok(self.response.clone())
    }
}

/// A mock notifier that records the instances it was asked to push.
#[derive(Clone, Default)]
struct MockNotifier {
    notified: Arc<Mutex<Vec<(TargetType, UserAiProjection)>>>,
}

impl ProjectionNotifier for MockNotifier {
    async fn notify_updated(
        &self,
        target_type: TargetType,
        instance: &UserAiProjection,
    ) -> anyhow::Result<()> {
        self.notified
            .lock()
            .unwrap()
            .push((target_type, instance.clone()));
        Ok(())
    }
}

type TestService = AiProjectionServiceImpl<MockRepo, MockQueue, MockGenerator, MockNotifier>;

/// Builds a service from a repo, using default mock collaborators.
fn service_with(repo: MockRepo) -> TestService {
    AiProjectionServiceImpl::new(
        repo,
        MockQueue::default(),
        MockGenerator::default(),
        MockNotifier::default(),
    )
}

/// A tiny in-memory mock repository for exercising the service layer.
#[derive(Clone, Default)]
struct MockRepo {
    has_permission: bool,
    team_ids: Vec<uuid::Uuid>,
    /// The instance returned by `get_or_create_target_projection`; defaults to
    /// a fresh cold instance when unset.
    existing_instance: Option<UserAiProjection>,
    created_target_projections: Arc<Mutex<Vec<UserAiProjection>>>,
    /// When set, `try_start_processing` reports the pair as already claimed.
    start_returns_false: bool,
    started: Arc<Mutex<Vec<(String, String)>>>,
    finished: Arc<Mutex<Vec<(String, String)>>>,
    statuses: Arc<Mutex<Vec<ProjectionStatus>>>,
    stored_results: Arc<Mutex<Vec<String>>>,
    stored_errors: Arc<Mutex<Vec<String>>>,
    upserted_definitions: Arc<Mutex<Vec<AiProjection>>>,
}

impl MockRepo {
    /// The instance state `get_target_projection` reports, reflecting the
    /// mutations recorded so far (result stored -> ready, error stored ->
    /// error).
    fn current_instance(&self, ai_projection_id: &str, target_id: &str) -> UserAiProjection {
        let status = self
            .statuses
            .lock()
            .unwrap()
            .last()
            .copied()
            .unwrap_or(ProjectionStatus::Cold);
        UserAiProjection {
            ai_projection_id: ai_projection_id.to_string(),
            target_id: target_id.to_string(),
            prompt_hash: test_hash(),
            status,
            result: self.stored_results.lock().unwrap().last().cloned(),
            error: self.stored_errors.lock().unwrap().last().cloned(),
            generated_at: None,
            stale_at: None,
        }
    }
}

impl AiProjectionRepository for MockRepo {
    async fn upsert_projection_definition(
        &self,
        id: &str,
        prompt: &str,
        prompt_hash: &str,
        target_type: TargetType,
        refresh_cadence: RefreshCadence,
        expiry: Expiry,
        model: Option<&str>,
        output_schema: Option<&serde_json::Value>,
    ) -> Result<AiProjection, AiProjectionError> {
        let projection = AiProjection {
            id: id.to_string(),
            prompt: prompt.to_string(),
            prompt_hash: prompt_hash.to_string(),
            target_type,
            refresh_cadence,
            expiry,
            model: model.map(str::to_string),
            output_schema: output_schema.cloned(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        self.upserted_definitions
            .lock()
            .unwrap()
            .push(projection.clone());
        Ok(projection)
    }

    async fn get_or_create_target_projection(
        &self,
        ai_projection_id: &str,
        target_id: &str,
        prompt_hash: &str,
    ) -> Result<UserAiProjection, AiProjectionError> {
        let target_projection =
            self.existing_instance
                .clone()
                .unwrap_or_else(|| UserAiProjection {
                    ai_projection_id: ai_projection_id.to_string(),
                    target_id: target_id.to_string(),
                    prompt_hash: prompt_hash.to_string(),
                    status: ProjectionStatus::Cold,
                    result: None,
                    error: None,
                    generated_at: None,
                    stale_at: None,
                });
        self.created_target_projections
            .lock()
            .unwrap()
            .push(target_projection.clone());
        Ok(target_projection)
    }

    async fn get_target_projection(
        &self,
        ai_projection_id: &str,
        target_id: &str,
    ) -> Result<UserAiProjection, AiProjectionError> {
        Ok(self.current_instance(ai_projection_id, target_id))
    }

    async fn get_projection(&self, id: &str) -> Result<AiProjection, AiProjectionError> {
        Ok(AiProjection {
            id: id.to_string(),
            prompt: TEST_PROMPT.to_string(),
            prompt_hash: test_hash(),
            target_type: TargetType::User,
            refresh_cadence: RefreshCadence::High,
            expiry: Expiry::Day,
            model: None,
            output_schema: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        })
    }

    async fn try_start_processing(
        &self,
        ai_projection_id: &str,
        target_id: &str,
    ) -> Result<bool, AiProjectionError> {
        self.started
            .lock()
            .unwrap()
            .push((ai_projection_id.to_string(), target_id.to_string()));
        Ok(!self.start_returns_false)
    }

    async fn finish_processing(
        &self,
        ai_projection_id: &str,
        target_id: &str,
    ) -> Result<(), AiProjectionError> {
        self.finished
            .lock()
            .unwrap()
            .push((ai_projection_id.to_string(), target_id.to_string()));
        Ok(())
    }

    async fn set_projection_loading(
        &self,
        _ai_projection_id: &str,
        _target_id: &str,
        _prompt_hash: &str,
    ) -> Result<(), AiProjectionError> {
        self.statuses
            .lock()
            .unwrap()
            .push(ProjectionStatus::Loading);
        Ok(())
    }

    async fn set_projection_refreshing(
        &self,
        _ai_projection_id: &str,
        _target_id: &str,
    ) -> Result<(), AiProjectionError> {
        self.statuses
            .lock()
            .unwrap()
            .push(ProjectionStatus::Refreshing);
        Ok(())
    }

    async fn set_projection_result(
        &self,
        _ai_projection_id: &str,
        _target_id: &str,
        _prompt_hash: &str,
        result: &str,
        _generated_at: chrono::DateTime<chrono::Utc>,
        _stale_at: chrono::DateTime<chrono::Utc>,
    ) -> Result<(), AiProjectionError> {
        self.statuses.lock().unwrap().push(ProjectionStatus::Ready);
        self.stored_results.lock().unwrap().push(result.to_string());
        Ok(())
    }

    async fn set_projection_error(
        &self,
        _ai_projection_id: &str,
        _target_id: &str,
        _prompt_hash: &str,
        error: &str,
    ) -> Result<(), AiProjectionError> {
        self.statuses.lock().unwrap().push(ProjectionStatus::Error);
        self.stored_errors.lock().unwrap().push(error.to_string());
        Ok(())
    }

    async fn user_has_permission(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        _permission: &str,
    ) -> Result<bool, AiProjectionError> {
        Ok(self.has_permission)
    }

    async fn get_user_team_ids(
        &self,
        _user_id: &MacroUserIdStr<'_>,
    ) -> Result<Vec<uuid::Uuid>, AiProjectionError> {
        Ok(self.team_ids.clone())
    }
}

fn user_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|test@macro.com")
        .unwrap()
        .into_owned()
}

#[test]
fn hash_projection_version_is_deterministic_and_hex() {
    let a = hash_projection_version("hello world", None, None);
    let b = hash_projection_version("hello world", None, None);
    let c = hash_projection_version("different", None, None);
    assert_eq!(a, b);
    assert_ne!(a, c);
    assert_eq!(a.len(), 64);
    assert!(a.chars().all(|ch| ch.is_ascii_hexdigit()));
}

#[test]
fn hash_projection_version_covers_model_and_schema() {
    let base = hash_projection_version("prompt", None, None);
    let with_model = hash_projection_version("prompt", Some("cerebras/llama-3.3-70b"), None);
    let schema = serde_json::json!({"type": "object"});
    let with_schema = hash_projection_version("prompt", None, Some(&schema));
    assert_ne!(base, with_model);
    assert_ne!(base, with_schema);
    assert_ne!(with_model, with_schema);
}

#[tokio::test]
async fn has_professional_features_delegates_to_repo() {
    let service = service_with(MockRepo {
        has_permission: true,
        ..Default::default()
    });
    assert!(service.has_professional_features(&user_id()).await.unwrap());

    let service = service_with(MockRepo {
        has_permission: false,
        ..Default::default()
    });
    assert!(!service.has_professional_features(&user_id()).await.unwrap());
}

fn user_params(id: &str, prompt: &str) -> UpsertProjectionParams {
    UpsertProjectionParams {
        id: id.to_string(),
        prompt: prompt.to_string(),
        target_type: TargetType::User,
        refresh_cadence: RefreshCadence::High,
        expiry: Expiry::Day,
        model: None,
        output_schema: None,
        await_generation: false,
        regenerate: false,
    }
}

#[tokio::test]
async fn upsert_projection_creates_cold_target_instance_for_user() {
    let repo = MockRepo::default();
    let service = service_with(repo.clone());

    let target_projection = service
        .upsert_projection(
            &user_id(),
            user_params("inbox/important", "What is important?"),
        )
        .await
        .unwrap();

    assert_eq!(target_projection.ai_projection_id, "inbox/important");
    // The user target id is resolved from the authenticated user.
    assert_eq!(target_projection.target_id, "macro|test@macro.com");
    assert_eq!(target_projection.status, ProjectionStatus::Cold);
    assert_eq!(target_projection.prompt_hash, test_hash());
    assert_eq!(repo.created_target_projections.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn upsert_projection_enqueues_materialization_for_cold_instance() {
    let repo = MockRepo::default();
    let queue = MockQueue::default();
    let service = AiProjectionServiceImpl::new(
        repo,
        queue.clone(),
        MockGenerator::default(),
        MockNotifier::default(),
    );

    service
        .upsert_projection(
            &user_id(),
            user_params("inbox/important", "What is important?"),
        )
        .await
        .unwrap();

    let enqueued = queue.enqueued.lock().unwrap();
    assert_eq!(enqueued.len(), 1);
    assert_eq!(enqueued[0].ai_projection_id, "inbox/important");
    assert_eq!(enqueued[0].target_id, "macro|test@macro.com");
    assert_eq!(enqueued[0].prompt_hash, test_hash());
}

#[tokio::test]
async fn upsert_projection_passes_model_and_schema_into_version_hash() {
    let repo = MockRepo::default();
    let service = service_with(repo.clone());

    let schema =
        serde_json::json!({"type": "object", "properties": {"answer": {"type": "string"}}});
    let mut params = user_params("inbox/important", TEST_PROMPT);
    params.model = Some("cerebras/llama-3.3-70b".to_string());
    params.output_schema = Some(schema.clone());

    let target_projection = service.upsert_projection(&user_id(), params).await.unwrap();

    let expected =
        hash_projection_version(TEST_PROMPT, Some("cerebras/llama-3.3-70b"), Some(&schema));
    assert_eq!(target_projection.prompt_hash, expected);

    let definitions = repo.upserted_definitions.lock().unwrap();
    assert_eq!(
        definitions[0].model.as_deref(),
        Some("cerebras/llama-3.3-70b")
    );
    assert_eq!(definitions[0].output_schema.as_ref(), Some(&schema));
}

#[tokio::test]
async fn upsert_projection_returns_ready_instance_without_regenerating() {
    let ready = UserAiProjection {
        ai_projection_id: "inbox/important".to_string(),
        target_id: "macro|test@macro.com".to_string(),
        prompt_hash: test_hash(),
        status: ProjectionStatus::Ready,
        result: Some("cached".to_string()),
        error: None,
        generated_at: Some(Utc::now()),
        stale_at: Some(Utc::now()),
    };
    let repo = MockRepo {
        existing_instance: Some(ready),
        ..Default::default()
    };
    let queue = MockQueue::default();
    let generator = MockGenerator::default();
    let service = AiProjectionServiceImpl::new(
        repo,
        queue.clone(),
        generator.clone(),
        MockNotifier::default(),
    );

    let target_projection = service
        .upsert_projection(&user_id(), user_params("inbox/important", TEST_PROMPT))
        .await
        .unwrap();

    assert_eq!(target_projection.status, ProjectionStatus::Ready);
    assert_eq!(target_projection.result.as_deref(), Some("cached"));
    assert!(queue.enqueued.lock().unwrap().is_empty());
    assert!(generator.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn upsert_projection_regenerate_marks_refreshing_and_enqueues() {
    let ready = UserAiProjection {
        ai_projection_id: "inbox/important".to_string(),
        target_id: "macro|test@macro.com".to_string(),
        prompt_hash: test_hash(),
        status: ProjectionStatus::Ready,
        result: Some("cached".to_string()),
        error: None,
        generated_at: Some(Utc::now()),
        stale_at: Some(Utc::now()),
    };
    let repo = MockRepo {
        existing_instance: Some(ready),
        ..Default::default()
    };
    let queue = MockQueue::default();
    let service = AiProjectionServiceImpl::new(
        repo.clone(),
        queue.clone(),
        MockGenerator::default(),
        MockNotifier::default(),
    );

    let mut params = user_params("inbox/important", TEST_PROMPT);
    params.regenerate = true;

    let target_projection = service.upsert_projection(&user_id(), params).await.unwrap();

    // The stale result stays visible while the regeneration is queued.
    assert_eq!(target_projection.status, ProjectionStatus::Refreshing);
    assert_eq!(target_projection.result.as_deref(), Some("cached"));
    assert_eq!(
        repo.statuses.lock().unwrap().as_slice(),
        [ProjectionStatus::Refreshing]
    );
    assert_eq!(queue.enqueued.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn upsert_projection_await_generates_inline_and_returns_ready() {
    let repo = MockRepo::default();
    let queue = MockQueue::default();
    let generator = MockGenerator {
        response: "inline result".to_string(),
        ..Default::default()
    };
    let notifier = MockNotifier::default();
    let service =
        AiProjectionServiceImpl::new(repo.clone(), queue.clone(), generator, notifier.clone());

    let mut params = user_params("inbox/important", TEST_PROMPT);
    params.await_generation = true;

    let target_projection = service.upsert_projection(&user_id(), params).await.unwrap();

    // Inline generation finished before the response was returned.
    assert_eq!(target_projection.status, ProjectionStatus::Ready);
    assert_eq!(target_projection.result.as_deref(), Some("inline result"));
    // Nothing was enqueued; materialization happened in the request.
    assert!(queue.enqueued.lock().unwrap().is_empty());
    // Other connected clients still get the gateway push.
    assert_eq!(notifier.notified.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn upsert_projection_await_returns_error_state_on_generation_failure() {
    let repo = MockRepo::default();
    let generator = MockGenerator {
        fail: true,
        ..Default::default()
    };
    let service = AiProjectionServiceImpl::new(
        repo.clone(),
        MockQueue::default(),
        generator,
        MockNotifier::default(),
    );

    let mut params = user_params("inbox/important", TEST_PROMPT);
    params.await_generation = true;

    let target_projection = service.upsert_projection(&user_id(), params).await.unwrap();

    // The failure is surfaced on the instance rather than failing the request.
    assert_eq!(target_projection.status, ProjectionStatus::Error);
    assert!(target_projection.error.is_some());
}

fn materialize_message() -> AiProjectionQueueMessage {
    AiProjectionQueueMessage {
        ai_projection_id: "inbox/important".to_string(),
        target_id: "macro|test@macro.com".to_string(),
        prompt_hash: test_hash(),
    }
}

#[tokio::test]
async fn materialize_generates_stores_result_and_notifies() {
    let repo = MockRepo::default();
    let generator = MockGenerator {
        response: "the materialized result".to_string(),
        ..Default::default()
    };
    let notifier = MockNotifier::default();
    let service = AiProjectionServiceImpl::new(
        repo.clone(),
        MockQueue::default(),
        generator.clone(),
        notifier.clone(),
    );

    service.materialize(materialize_message()).await.unwrap();

    // The generator ran for the target user with the projection's prompt.
    let calls = generator.calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, "macro|test@macro.com");
    assert_eq!(calls[0].1, TEST_PROMPT);

    // The result was stored and the instance ended ready.
    assert_eq!(
        repo.stored_results.lock().unwrap().as_slice(),
        ["the materialized result"]
    );
    assert_eq!(
        repo.statuses.lock().unwrap().as_slice(),
        [ProjectionStatus::Loading, ProjectionStatus::Ready]
    );
    // The processing claim was acquired and released.
    assert_eq!(repo.started.lock().unwrap().len(), 1);
    assert_eq!(repo.finished.lock().unwrap().len(), 1);

    // Connected clients were pushed the ready instance.
    let notified = notifier.notified.lock().unwrap();
    assert_eq!(notified.len(), 1);
    assert_eq!(notified[0].0, TargetType::User);
    assert_eq!(notified[0].1.status, ProjectionStatus::Ready);
    assert_eq!(
        notified[0].1.result.as_deref(),
        Some("the materialized result")
    );
}

#[tokio::test]
async fn materialize_skips_when_already_processing() {
    let repo = MockRepo {
        start_returns_false: true,
        ..Default::default()
    };
    let generator = MockGenerator::default();
    let notifier = MockNotifier::default();
    let service = AiProjectionServiceImpl::new(
        repo.clone(),
        MockQueue::default(),
        generator.clone(),
        notifier.clone(),
    );

    service.materialize(materialize_message()).await.unwrap();

    // The generator never ran and nothing was stored, released, or pushed.
    assert!(generator.calls.lock().unwrap().is_empty());
    assert!(repo.statuses.lock().unwrap().is_empty());
    assert!(repo.finished.lock().unwrap().is_empty());
    assert!(notifier.notified.lock().unwrap().is_empty());
}

#[tokio::test]
async fn materialize_skips_stale_version_messages() {
    let repo = MockRepo::default();
    let generator = MockGenerator::default();
    let service = AiProjectionServiceImpl::new(
        repo.clone(),
        MockQueue::default(),
        generator.clone(),
        MockNotifier::default(),
    );

    // The definition's hash (test_hash) no longer matches this older message.
    let mut message = materialize_message();
    message.prompt_hash = hash_projection_version("an older prompt", None, None);

    service.materialize(message).await.unwrap();

    // The claim was never taken and the generator never ran.
    assert!(repo.started.lock().unwrap().is_empty());
    assert!(generator.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn materialize_on_error_records_error_notifies_and_returns_err() {
    let repo = MockRepo::default();
    let generator = MockGenerator {
        fail: true,
        ..Default::default()
    };
    let notifier = MockNotifier::default();
    let service = AiProjectionServiceImpl::new(
        repo.clone(),
        MockQueue::default(),
        generator,
        notifier.clone(),
    );

    let err = service
        .materialize(materialize_message())
        .await
        .unwrap_err();
    assert!(matches!(err, AiProjectionError::Generation(_)));

    // The error was recorded and the claim released so SQS can retry.
    assert_eq!(repo.stored_errors.lock().unwrap().len(), 1);
    assert_eq!(repo.finished.lock().unwrap().len(), 1);
    assert!(repo.stored_results.lock().unwrap().is_empty());
    assert_eq!(
        repo.statuses.lock().unwrap().as_slice(),
        [ProjectionStatus::Loading, ProjectionStatus::Error]
    );

    // Connected clients were pushed the errored instance.
    let notified = notifier.notified.lock().unwrap();
    assert_eq!(notified.len(), 1);
    assert_eq!(notified[0].1.status, ProjectionStatus::Error);
}

#[tokio::test]
async fn upsert_projection_resolves_team_target_from_user() {
    let team_id = uuid::Uuid::new_v4();
    let repo = MockRepo {
        team_ids: vec![team_id],
        ..Default::default()
    };
    let service = service_with(repo.clone());

    let target_projection = service
        .upsert_projection(
            &user_id(),
            UpsertProjectionParams {
                id: "team/focus".to_string(),
                prompt: "What is my team focused on?".to_string(),
                target_type: TargetType::Team,
                refresh_cadence: RefreshCadence::Medium,
                expiry: Expiry::Week,
                model: None,
                output_schema: None,
                await_generation: false,
                regenerate: false,
            },
        )
        .await
        .unwrap();

    assert_eq!(target_projection.target_id, team_id.to_string());
}

#[tokio::test]
async fn upsert_projection_team_target_errors_without_exactly_one_team() {
    let team_params = || UpsertProjectionParams {
        id: "team/focus".to_string(),
        prompt: "What is my team focused on?".to_string(),
        target_type: TargetType::Team,
        refresh_cadence: RefreshCadence::Medium,
        expiry: Expiry::Week,
        model: None,
        output_schema: None,
        await_generation: false,
        regenerate: false,
    };

    // Zero teams -> bad request.
    let service = service_with(MockRepo::default());
    let err = service
        .upsert_projection(&user_id(), team_params())
        .await
        .unwrap_err();
    assert!(matches!(err, UpsertProjectionError::BadRequest(_)));

    // Multiple teams -> ambiguous bad request.
    let service = service_with(MockRepo {
        team_ids: vec![uuid::Uuid::new_v4(), uuid::Uuid::new_v4()],
        ..Default::default()
    });
    let err = service
        .upsert_projection(&user_id(), team_params())
        .await
        .unwrap_err();
    assert!(matches!(err, UpsertProjectionError::BadRequest(_)));
}

#[tokio::test]
async fn upsert_projection_rejects_empty_id_and_prompt() {
    let service = service_with(MockRepo::default());

    let err = service
        .upsert_projection(&user_id(), user_params("  ", "valid"))
        .await
        .unwrap_err();
    assert!(matches!(err, UpsertProjectionError::BadRequest(_)));

    let err = service
        .upsert_projection(&user_id(), user_params("valid", ""))
        .await
        .unwrap_err();
    assert!(matches!(err, UpsertProjectionError::BadRequest(_)));
}
