use axum::body::Body;
use axum::http::Request;
use macro_authorization::{InternalIdentityClaims, MacroAuthorizationError, ValidatedCredential};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use model_user::UserContext;
use rootcause::Report;
use sqlx::PgPool;
use tower::ServiceExt;

use super::*;
use crate::domain::service::test::{OWNER, entity_idea, harness};

/// Every bearer token is the owner's own session.
#[derive(Clone)]
struct Owner;

impl MacroAuthorizationService for Owner {
    async fn authorize(&self, _: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        Ok(UserContext {
            user_id: OWNER.to_owned(),
            fusion_user_id: "owner".to_owned(),
            ..Default::default()
        })
    }

    async fn authorize_identity(
        &self,
        jwt: &str,
    ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
        self.authorize(jwt).await.map(ValidatedCredential::session)
    }

    async fn authorize_internal(
        &self,
        _: &str,
        _: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_person_themself_cannot_attach_a_draft(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "ideas").await;
    let idea = h
        .suggest(session, entity_idea("thread:reply"))
        .await
        .idea
        .unwrap();
    let app: Router = idea_router(IdeaRouterState {
        service: Arc::new(h.service),
        authorization_state: MacroAuthorizationState::new(Arc::new(Owner)),
    });
    let response = app
        .oneshot(
            Request::put(format!("/ideas/{}/draft", idea.id))
                .header("authorization", "Bearer owner")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "emailDraftId": Uuid::now_v7(),
                        "reason": "Drafted the reply",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}
