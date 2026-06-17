use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Duration, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::json;
use uuid::Uuid;

use super::*;
use crate::domain::models::{
    CompleteProjectionRequest, FailProjectionRequest, GenerateProjectionRequest,
    GeneratedProjection, ProjectionExpiry, RefreshCadence, prompt_hash,
};
use crate::domain::ports::ProjectionGenerator;

#[derive(Clone, Default)]
struct FakeRepository {
    state: Arc<Mutex<FakeRepositoryState>>,
}

#[derive(Default)]
struct FakeRepositoryState {
    instance: Option<ProjectionInstance>,
    team_access: HashSet<(String, String)>,
    upserts: Vec<UpsertProjectionInstanceRequest>,
    schedules: Vec<ScheduleProjectionRequest>,
}

impl FakeRepository {
    fn with_instance(instance: ProjectionInstance) -> Self {
        Self {
            state: Arc::new(Mutex::new(FakeRepositoryState {
                instance: Some(instance),
                ..FakeRepositoryState::default()
            })),
        }
    }

    fn allow_team_access(&self, user_id: &MacroUserIdStr<'_>, team_id: &str) {
        self.state
            .lock()
            .expect("repository state lock")
            .team_access
            .insert((user_id.to_string(), team_id.to_string()));
    }

    fn upserts(&self) -> Vec<UpsertProjectionInstanceRequest> {
        self.state
            .lock()
            .expect("repository state lock")
            .upserts
            .clone()
    }

    fn schedules(&self) -> Vec<ScheduleProjectionRequest> {
        self.state
            .lock()
            .expect("repository state lock")
            .schedules
            .clone()
    }
}

impl AiProjectionRepository for FakeRepository {
    type Err = anyhow::Error;

    fn get_or_create_instance(
        &self,
        request: UpsertProjectionInstanceRequest,
    ) -> impl Future<Output = std::result::Result<ProjectionInstance, Self::Err>> + Send {
        let state = self.state.clone();

        async move {
            let mut state = state.lock().expect("repository state lock");
            state.upserts.push(request.clone());

            if let Some(instance) = state.instance.clone() {
                return Ok(instance);
            }

            let instance = ProjectionInstance::cold(Uuid::new_v4(), &request);
            state.instance = Some(instance.clone());
            Ok(instance)
        }
    }

    fn schedule_generation(
        &self,
        request: ScheduleProjectionRequest,
    ) -> impl Future<Output = std::result::Result<(), Self::Err>> + Send {
        let state = self.state.clone();

        async move {
            state
                .lock()
                .expect("repository state lock")
                .schedules
                .push(request);
            Ok(())
        }
    }

    fn user_can_access_team(
        &self,
        user_id: MacroUserIdStr<'static>,
        team_id: String,
    ) -> impl Future<Output = std::result::Result<bool, Self::Err>> + Send {
        let state = self.state.clone();

        async move {
            Ok(state
                .lock()
                .expect("repository state lock")
                .team_access
                .contains(&(user_id.to_string(), team_id)))
        }
    }

    fn claim_next_due_projection(
        &self,
        _now: DateTime<Utc>,
    ) -> impl Future<Output = std::result::Result<Option<ProjectionInstance>, Self::Err>> + Send
    {
        async { Ok(None) }
    }

    fn complete_generation(
        &self,
        _request: CompleteProjectionRequest,
    ) -> impl Future<Output = std::result::Result<(), Self::Err>> + Send {
        async { Ok(()) }
    }

    fn fail_generation(
        &self,
        _request: FailProjectionRequest,
    ) -> impl Future<Output = std::result::Result<(), Self::Err>> + Send {
        async { Ok(()) }
    }

    fn cleanup_expired(
        &self,
        _now: DateTime<Utc>,
    ) -> impl Future<Output = std::result::Result<u64, Self::Err>> + Send {
        async { Ok(0) }
    }
}

struct FakeGenerator {
    output: String,
}

impl ProjectionGenerator for FakeGenerator {
    type Err = anyhow::Error;

    fn generate_projection(
        &self,
        _request: GenerateProjectionRequest,
    ) -> impl Future<Output = std::result::Result<GeneratedProjection, Self::Err>> + Send {
        let output = self.output.clone();

        async move { Ok(GeneratedProjection { output }) }
    }
}

#[tokio::test]
async fn cold_request_creates_instance_and_schedules_generation() {
    let now = test_time();
    let requester = user_id("macro|projection@example.com");
    let request = materialize_request(Target::user(requester.to_string()));
    let repository = FakeRepository::default();
    let service = AiProjectionServiceImpl::new(repository.clone());

    let response = service
        .materialize_at(requester.clone(), request.clone(), now)
        .await
        .expect("materialize projection");

    assert_eq!(response.status, ProjectionStatus::Cold);
    assert_eq!(response.data, None);
    assert_eq!(response.error, None);

    let upserts = repository.upserts();
    assert_eq!(upserts.len(), 1);
    assert_eq!(upserts[0].cache_key, request.cache_key());
    assert_eq!(upserts[0].expiry, ProjectionExpiry::Day);

    let schedules = repository.schedules();
    assert_eq!(schedules.len(), 1);
    assert_eq!(schedules[0].reason, ScheduleGenerationReason::ColdStart);
    assert_eq!(schedules[0].cache_key, request.cache_key());
    assert_eq!(schedules[0].requested_by, requester);
    assert_eq!(schedules[0].scheduled_at, now);
}

#[tokio::test]
async fn ready_cached_projection_returns_without_scheduling() {
    let now = test_time();
    let requester = user_id("macro|projection@example.com");
    let request = materialize_request(Target::user(requester.to_string()));
    let instance = ready_instance(
        &request,
        requester.clone(),
        now - Duration::minutes(10),
        now + Duration::hours(1),
    );
    let repository = FakeRepository::with_instance(instance);
    let service = AiProjectionServiceImpl::new(repository.clone());

    let response = service
        .materialize_at(requester, request, now)
        .await
        .expect("materialize projection");

    assert_eq!(response.status, ProjectionStatus::Ready);
    assert_eq!(response.data.as_deref(), Some("cached output"));
    assert_eq!(repository.schedules(), Vec::new());
}

#[tokio::test]
async fn stale_cached_projection_returns_data_and_schedules_refresh() {
    let now = test_time();
    let requester = user_id("macro|projection@example.com");
    let request = materialize_request(Target::user(requester.to_string()));
    let instance = ready_instance(
        &request,
        requester.clone(),
        now - Duration::hours(2),
        now - Duration::seconds(1),
    );
    let repository = FakeRepository::with_instance(instance);
    let service = AiProjectionServiceImpl::new(repository.clone());

    let response = service
        .materialize_at(requester, request.clone(), now)
        .await
        .expect("materialize projection");

    assert_eq!(response.status, ProjectionStatus::Refreshing);
    assert_eq!(response.data.as_deref(), Some("cached output"));

    let schedules = repository.schedules();
    assert_eq!(schedules.len(), 1);
    assert_eq!(schedules[0].reason, ScheduleGenerationReason::Stale);
    assert_eq!(schedules[0].cache_key, request.cache_key());
}

#[tokio::test]
async fn force_refresh_schedules_even_when_cache_is_ready() {
    let now = test_time();
    let requester = user_id("macro|projection@example.com");
    let mut request = materialize_request(Target::user(requester.to_string()));
    request.force_refresh = true;
    let instance = ready_instance(
        &request,
        requester.clone(),
        now - Duration::minutes(10),
        now + Duration::hours(1),
    );
    let repository = FakeRepository::with_instance(instance);
    let service = AiProjectionServiceImpl::new(repository.clone());

    let response = service
        .materialize_at(requester, request.clone(), now)
        .await
        .expect("materialize projection");

    assert_eq!(response.status, ProjectionStatus::Refreshing);
    assert_eq!(response.data.as_deref(), Some("cached output"));

    let schedules = repository.schedules();
    assert_eq!(schedules.len(), 1);
    assert_eq!(schedules[0].reason, ScheduleGenerationReason::ForceRefresh);
    assert_eq!(schedules[0].cache_key, request.cache_key());
}

#[test]
fn prompt_hash_changes_with_prompt_context_schema_and_toolset_version() {
    let base = prompt_hash("prompt", None, None);

    assert_eq!(base, prompt_hash("prompt", None, None));
    assert_ne!(base, prompt_hash("changed prompt", None, None));
    assert_ne!(base, prompt_hash("prompt", Some("context"), None));
    assert_ne!(base, prompt_hash("prompt", Some(""), None));

    let schema = json!({ "type": "string" });
    let changed_schema = json!({ "type": "number" });
    assert_ne!(base, prompt_hash("prompt", None, Some(&schema)));
    assert_ne!(
        prompt_hash("prompt", None, Some(&schema)),
        prompt_hash("prompt", None, Some(&changed_schema))
    );
}

#[tokio::test]
async fn user_target_mismatch_is_rejected_before_instance_creation() {
    let now = test_time();
    let requester = user_id("macro|projection@example.com");
    let request = materialize_request(Target::user("macro|other@example.com"));
    let repository = FakeRepository::default();
    let service = AiProjectionServiceImpl::new(repository.clone());

    let error = service
        .materialize_at(requester, request, now)
        .await
        .expect_err("request should fail");

    assert!(matches!(error, ProjectionError::UserTargetMismatch { .. }));
    assert_eq!(repository.upserts(), Vec::new());
    assert_eq!(repository.schedules(), Vec::new());
}

#[tokio::test]
async fn unauthorized_team_target_is_rejected_before_instance_creation() {
    let now = test_time();
    let requester = user_id("macro|projection@example.com");
    let request = materialize_request(Target::team("team-1"));
    let repository = FakeRepository::default();
    let service = AiProjectionServiceImpl::new(repository.clone());

    let error = service
        .materialize_at(requester, request, now)
        .await
        .expect_err("request should fail");

    assert!(matches!(
        error,
        ProjectionError::UnauthorizedTeamTarget { .. }
    ));
    assert_eq!(repository.upserts(), Vec::new());
    assert_eq!(repository.schedules(), Vec::new());
}

#[tokio::test]
async fn authorized_team_target_can_materialize_cold_projection() {
    let now = test_time();
    let requester = user_id("macro|projection@example.com");
    let request = materialize_request(Target::team("team-1"));
    let repository = FakeRepository::default();
    repository.allow_team_access(&requester, "team-1");
    let service = AiProjectionServiceImpl::new(repository.clone());

    let response = service
        .materialize_at(requester, request, now)
        .await
        .expect("materialize projection");

    assert_eq!(response.status, ProjectionStatus::Cold);
    assert_eq!(repository.schedules().len(), 1);
}

#[tokio::test]
async fn fake_generator_port_materializes_output() {
    let requester = user_id("macro|projection@example.com");
    let request = materialize_request(Target::user(requester.clone().to_string()));
    let upsert =
        UpsertProjectionInstanceRequest::from_materialize_request(&request, requester, test_time());
    let instance = ProjectionInstance::cold(Uuid::new_v4(), &upsert);
    let generator = FakeGenerator {
        output: "generated output".to_string(),
    };

    let generated = generator
        .generate_projection(instance.generation_request())
        .await
        .expect("generate projection");

    assert_eq!(generated.output, "generated output");
}

fn materialize_request(target: Target) -> MaterializeProjectionRequest {
    MaterializeProjectionRequest {
        id: "inbox/important".to_string(),
        target,
        prompt: "What should I triage first?".to_string(),
        context: None,
        refresh_cadence: RefreshCadence::High,
        expiry: None,
        schema: None,
        force_refresh: false,
    }
}

fn ready_instance(
    request: &MaterializeProjectionRequest,
    generation_user_id: MacroUserIdStr<'static>,
    generated_at: DateTime<Utc>,
    stale_at: DateTime<Utc>,
) -> ProjectionInstance {
    let upsert = UpsertProjectionInstanceRequest::from_materialize_request(
        request,
        generation_user_id,
        generated_at,
    );
    let mut instance = ProjectionInstance::cold(Uuid::new_v4(), &upsert);
    instance.status = ProjectionStatus::Ready;
    instance.output = Some("cached output".to_string());
    instance.generated_at = Some(generated_at);
    instance.stale_at = Some(stale_at);
    instance.next_refresh_at = stale_at;
    instance.updated_at = generated_at;
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
