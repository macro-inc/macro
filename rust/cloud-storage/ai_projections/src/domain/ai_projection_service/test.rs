use std::sync::{Arc, Mutex};

use chrono::Utc;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};

use crate::domain::{
    ai_projection_repo::AiProjectionRepository,
    ai_projection_service::{AiProjectionService, AiProjectionServiceImpl, hash_prompt},
    model::{
        AiProjection, AiProjectionError, Expiry, ProjectionStatus, RefreshCadence,
        UpsertProjectionParams, UserAiProjection,
    },
};

/// A tiny in-memory mock repository for exercising the service layer.
#[derive(Clone, Default)]
struct MockRepo {
    has_permission: bool,
    created_user_projections: Arc<Mutex<Vec<UserAiProjection>>>,
}

impl AiProjectionRepository for MockRepo {
    async fn get_or_create_projection(
        &self,
        id: &str,
        prompt: &str,
        prompt_hash: &str,
        refresh_cadence: RefreshCadence,
        expiry: Expiry,
    ) -> Result<AiProjection, AiProjectionError> {
        Ok(AiProjection {
            id: id.to_string(),
            prompt: prompt.to_string(),
            prompt_hash: prompt_hash.to_string(),
            refresh_cadence,
            expiry,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        })
    }

    async fn get_or_create_user_projection(
        &self,
        ai_projection_id: &str,
        user_id: &MacroUserIdStr<'_>,
        prompt_hash: &str,
    ) -> Result<UserAiProjection, AiProjectionError> {
        let user_projection = UserAiProjection {
            id: macro_uuid::generate_uuid_v7(),
            ai_projection_id: ai_projection_id.to_string(),
            user_id: user_id.as_ref().to_string(),
            prompt_hash: prompt_hash.to_string(),
            status: ProjectionStatus::Cold,
            result: None,
            error: None,
            generated_at: None,
            stale_at: None,
        };
        self.created_user_projections
            .lock()
            .unwrap()
            .push(user_projection.clone());
        Ok(user_projection)
    }

    async fn user_has_permission(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        _permission: &str,
    ) -> Result<bool, AiProjectionError> {
        Ok(self.has_permission)
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

#[tokio::test]
async fn upsert_projection_creates_cold_user_instance() {
    let repo = MockRepo::default();
    let service = AiProjectionServiceImpl::new(repo.clone());

    let user_projection = service
        .upsert_projection(
            &user_id(),
            UpsertProjectionParams {
                id: "inbox/important".to_string(),
                prompt: "What is important?".to_string(),
                refresh_cadence: RefreshCadence::High,
                expiry: Expiry::Day,
            },
        )
        .await
        .unwrap();

    assert_eq!(user_projection.ai_projection_id, "inbox/important");
    assert_eq!(user_projection.status, ProjectionStatus::Cold);
    assert_eq!(
        user_projection.prompt_hash,
        hash_prompt("What is important?")
    );
    assert_eq!(repo.created_user_projections.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn upsert_projection_rejects_empty_id_and_prompt() {
    let service = AiProjectionServiceImpl::new(MockRepo::default());

    let err = service
        .upsert_projection(
            &user_id(),
            UpsertProjectionParams {
                id: "  ".to_string(),
                prompt: "valid".to_string(),
                refresh_cadence: RefreshCadence::Low,
                expiry: Expiry::Week,
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(
        err,
        crate::domain::model::UpsertProjectionError::BadRequest(_)
    ));

    let err = service
        .upsert_projection(
            &user_id(),
            UpsertProjectionParams {
                id: "valid".to_string(),
                prompt: "".to_string(),
                refresh_cadence: RefreshCadence::Low,
                expiry: Expiry::Week,
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(
        err,
        crate::domain::model::UpsertProjectionError::BadRequest(_)
    ));
}
