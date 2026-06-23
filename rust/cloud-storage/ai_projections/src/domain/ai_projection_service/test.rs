use std::sync::{Arc, Mutex};

use chrono::Utc;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_ai_projection::AiProjectionQueueMessage;

use crate::domain::{
    ai_projection_queue::AiProjectionQueue,
    ai_projection_repo::AiProjectionRepository,
    ai_projection_service::{AiProjectionService, AiProjectionServiceImpl, hash_prompt},
    model::{
        AiProjection, AiProjectionError, Expiry, ProjectionStatus, RefreshCadence, TargetType,
        UpsertProjectionError, UpsertProjectionParams, UserAiProjection,
    },
    projection_generator::ProjectionGenerator,
};

/// The prompt the mock repository reports for any projection definition.
const TEST_PROMPT: &str = "What is important?";

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
    calls: Arc<Mutex<Vec<(String, String)>>>,
}

impl ProjectionGenerator for MockGenerator {
    async fn generate(
        &self,
        user_id: &MacroUserIdStr<'_>,
        prompt: &str,
    ) -> Result<String, AiProjectionError> {
        self.calls
            .lock()
            .unwrap()
            .push((user_id.as_ref().to_string(), prompt.to_string()));
        if self.fail {
            return Err(AiProjectionError::Generation("boom".to_string()));
        }
        Ok(self.response.clone())
    }
}

/// Builds a service from a repo, using a default mock queue and generator.
fn service_with(repo: MockRepo) -> AiProjectionServiceImpl<MockRepo, MockQueue, MockGenerator> {
    AiProjectionServiceImpl::new(repo, MockQueue::default(), MockGenerator::default())
}

/// A tiny in-memory mock repository for exercising the service layer.
#[derive(Clone, Default)]
struct MockRepo {
    has_permission: bool,
    team_ids: Vec<uuid::Uuid>,
    created_target_projections: Arc<Mutex<Vec<UserAiProjection>>>,
    /// When set, `try_start_processing` reports the pair as already claimed.
    start_returns_false: bool,
    started: Arc<Mutex<Vec<(String, String)>>>,
    finished: Arc<Mutex<Vec<(String, String)>>>,
    statuses: Arc<Mutex<Vec<ProjectionStatus>>>,
    stored_results: Arc<Mutex<Vec<String>>>,
    stored_errors: Arc<Mutex<Vec<String>>>,
}

impl AiProjectionRepository for MockRepo {
    async fn get_or_create_projection(
        &self,
        id: &str,
        prompt: &str,
        prompt_hash: &str,
        target_type: TargetType,
        refresh_cadence: RefreshCadence,
        expiry: Expiry,
    ) -> Result<AiProjection, AiProjectionError> {
        Ok(AiProjection {
            id: id.to_string(),
            prompt: prompt.to_string(),
            prompt_hash: prompt_hash.to_string(),
            target_type,
            refresh_cadence,
            expiry,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        })
    }

    async fn get_or_create_target_projection(
        &self,
        ai_projection_id: &str,
        target_id: &str,
        prompt_hash: &str,
    ) -> Result<UserAiProjection, AiProjectionError> {
        let target_projection = UserAiProjection {
            ai_projection_id: ai_projection_id.to_string(),
            target_id: target_id.to_string(),
            prompt_hash: prompt_hash.to_string(),
            status: ProjectionStatus::Cold,
            result: None,
            error: None,
            generated_at: None,
            stale_at: None,
        };
        self.created_target_projections
            .lock()
            .unwrap()
            .push(target_projection.clone());
        Ok(target_projection)
    }

    async fn get_projection(&self, id: &str) -> Result<AiProjection, AiProjectionError> {
        Ok(AiProjection {
            id: id.to_string(),
            prompt: TEST_PROMPT.to_string(),
            prompt_hash: hash_prompt(TEST_PROMPT),
            target_type: TargetType::User,
            refresh_cadence: RefreshCadence::High,
            expiry: Expiry::Day,
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
    ) -> Result<(), AiProjectionError> {
        self.statuses
            .lock()
            .unwrap()
            .push(ProjectionStatus::Loading);
        Ok(())
    }

    async fn set_projection_result(
        &self,
        _ai_projection_id: &str,
        _target_id: &str,
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
fn hash_prompt_is_deterministic_and_hex() {
    let a = hash_prompt("hello world");
    let b = hash_prompt("hello world");
    let c = hash_prompt("different");
    assert_eq!(a, b);
    assert_ne!(a, c);
    assert_eq!(a.len(), 64);
    assert!(a.chars().all(|ch| ch.is_ascii_hexdigit()));
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
    assert_eq!(
        target_projection.prompt_hash,
        hash_prompt("What is important?")
    );
    assert_eq!(repo.created_target_projections.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn upsert_projection_enqueues_materialization_for_cold_instance() {
    let repo = MockRepo::default();
    let queue = MockQueue::default();
    let service = AiProjectionServiceImpl::new(repo, queue.clone(), MockGenerator::default());

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
    assert_eq!(enqueued[0].prompt_hash, hash_prompt("What is important?"));
}

fn materialize_message() -> AiProjectionQueueMessage {
    AiProjectionQueueMessage {
        ai_projection_id: "inbox/important".to_string(),
        target_id: "macro|test@macro.com".to_string(),
        prompt_hash: hash_prompt(TEST_PROMPT),
    }
}

#[tokio::test]
async fn materialize_generates_and_stores_result() {
    let repo = MockRepo::default();
    let generator = MockGenerator {
        response: "the materialized result".to_string(),
        ..Default::default()
    };
    let service =
        AiProjectionServiceImpl::new(repo.clone(), MockQueue::default(), generator.clone());

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
}

#[tokio::test]
async fn materialize_skips_when_already_processing() {
    let repo = MockRepo {
        start_returns_false: true,
        ..Default::default()
    };
    let generator = MockGenerator::default();
    let service =
        AiProjectionServiceImpl::new(repo.clone(), MockQueue::default(), generator.clone());

    service.materialize(materialize_message()).await.unwrap();

    // The generator never ran and nothing was stored or released.
    assert!(generator.calls.lock().unwrap().is_empty());
    assert!(repo.statuses.lock().unwrap().is_empty());
    assert!(repo.finished.lock().unwrap().is_empty());
}

#[tokio::test]
async fn materialize_on_error_records_error_releases_claim_and_returns_err() {
    let repo = MockRepo::default();
    let generator = MockGenerator {
        fail: true,
        ..Default::default()
    };
    let service = AiProjectionServiceImpl::new(repo.clone(), MockQueue::default(), generator);

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
            },
        )
        .await
        .unwrap();

    assert_eq!(target_projection.target_id, team_id.to_string());
}

#[tokio::test]
async fn upsert_projection_team_target_errors_without_exactly_one_team() {
    // Zero teams -> bad request.
    let service = service_with(MockRepo::default());
    let err = service
        .upsert_projection(
            &user_id(),
            UpsertProjectionParams {
                id: "team/focus".to_string(),
                prompt: "What is my team focused on?".to_string(),
                target_type: TargetType::Team,
                refresh_cadence: RefreshCadence::Medium,
                expiry: Expiry::Week,
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(err, UpsertProjectionError::BadRequest(_)));

    // Multiple teams -> ambiguous bad request.
    let service = service_with(MockRepo {
        team_ids: vec![uuid::Uuid::new_v4(), uuid::Uuid::new_v4()],
        ..Default::default()
    });
    let err = service
        .upsert_projection(
            &user_id(),
            UpsertProjectionParams {
                id: "team/focus".to_string(),
                prompt: "What is my team focused on?".to_string(),
                target_type: TargetType::Team,
                refresh_cadence: RefreshCadence::Medium,
                expiry: Expiry::Week,
            },
        )
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
