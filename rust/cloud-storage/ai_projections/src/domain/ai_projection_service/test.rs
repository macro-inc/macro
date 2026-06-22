use std::sync::{Arc, Mutex};

use chrono::Utc;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};

use crate::domain::{
    ai_projection_repo::AiProjectionRepository,
    ai_projection_service::{AiProjectionService, AiProjectionServiceImpl, hash_prompt},
    model::{
        AiProjection, AiProjectionError, Expiry, ProjectionStatus, RefreshCadence, TargetType,
        UpsertProjectionError, UpsertProjectionParams, UserAiProjection,
    },
};

/// A tiny in-memory mock repository for exercising the service layer.
#[derive(Clone, Default)]
struct MockRepo {
    has_permission: bool,
    team_ids: Vec<uuid::Uuid>,
    created_target_projections: Arc<Mutex<Vec<UserAiProjection>>>,
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
            id: macro_uuid::generate_uuid_v7(),
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
    let service = AiProjectionServiceImpl::new(MockRepo {
        has_permission: true,
        ..Default::default()
    });
    assert!(service.has_professional_features(&user_id()).await.unwrap());

    let service = AiProjectionServiceImpl::new(MockRepo {
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
    let service = AiProjectionServiceImpl::new(repo.clone());

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
async fn upsert_projection_resolves_team_target_from_user() {
    let team_id = macro_uuid::generate_uuid_v7();
    let repo = MockRepo {
        team_ids: vec![team_id],
        ..Default::default()
    };
    let service = AiProjectionServiceImpl::new(repo.clone());

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
    let service = AiProjectionServiceImpl::new(MockRepo::default());
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
    let service = AiProjectionServiceImpl::new(MockRepo {
        team_ids: vec![
            macro_uuid::generate_uuid_v7(),
            macro_uuid::generate_uuid_v7(),
        ],
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
    let service = AiProjectionServiceImpl::new(MockRepo::default());

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
