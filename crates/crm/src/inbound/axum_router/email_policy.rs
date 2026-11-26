//! Thin own-member API over the contribution policy service.
use super::CrmRouterState;
use crate::domain::email_policy_preview::*;
use crate::domain::{
    auth::CrmTeamReceipt,
    email_policy_api::*,
    email_rules::{EmailPolicyActorKind, EmailRuleSet},
    model::CrmError,
    service::CrmService,
};
use axum::{
    Json, RequestPartsExt, Router,
    extract::{DefaultBodyLimit, FromRef, FromRequestParts, Query, State},
    http::request::Parts,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use axum::{extract::Path, http::StatusCode};
use entity_access::{
    domain::{models::MemberTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::user_team_receipt,
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use std::{marker::PhantomData, sync::Arc};
use uuid::Uuid;

/// Authenticated user, verified provenance and the standard team capability.
/// There is no path/body member selector and no administrator override.
pub struct OwnEmailPolicyAccess<Eas, Auth> {
    access: CrmTeamReceipt<MemberTeamRole>,
    actor: EmailPolicyActor,
    marker: PhantomData<fn() -> (Eas, Auth)>,
}

impl<S, Eas, Auth> FromRequestParts<S> for OwnEmailPolicyAccess<Eas, Auth>
where
    S: Send + Sync + 'static,
    Arc<Eas>: FromRef<S>,
    MacroAuthorizationState<Auth>: FromRef<S>,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    type Rejection = Response;
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let authentication: MacroAuthorizationExtractor<Auth, UserOnly> = parts
            .extract_with_state(state)
            .await
            .map_err(IntoResponse::into_response)?;
        let user = authentication.authorization;
        let service = Arc::<Eas>::from_ref(state);
        let receipt =
            user_team_receipt::<MemberTeamRole, Eas>(service.as_ref(), user.macro_user_id.clone())
                .await
                .map_err(IntoResponse::into_response)?
                .ok_or_else(|| CrmError::AccessDenied.into_response())?;
        let kind = if user.agent_id.is_some() {
            EmailPolicyActorKind::Agent
        } else if user.is_human_session() && user.routine_id.is_none() {
            EmailPolicyActorKind::Member
        } else {
            EmailPolicyActorKind::Api
        };
        Ok(Self {
            access: CrmTeamReceipt::from_team_receipt(receipt)
                .map_err(IntoResponse::into_response)?,
            actor: EmailPolicyActor {
                kind,
                agent_id: user.agent_id.map(|id| id.as_uuid()),
                session_id: agent_correlation::context::current_session(),
                may_share: agent_correlation::context::may_share(),
            },
            marker: PhantomData,
        })
    }
}

/// Owner-only history cursor.
#[derive(serde::Deserialize, utoipa::IntoParams)]
pub struct EmailPolicyHistoryQuery {
    /// Exclusive audit event cursor; pages contain at most fifty events.
    pub before: Option<Uuid>,
}

/// Read sharing state without initializing consent or scheduling work.
#[utoipa::path(get,path="/crm/email-privacy/policy",operation_id="get_crm_email_policy",responses((status=200,body=EmailPolicyView)))]
pub async fn get_handler<
    C: CrmService + EmailPolicyService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: OwnEmailPolicyAccess<Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
) -> Result<Json<EmailPolicyView>, CrmError> {
    Ok(Json(state.service.email_policy(&access.access).await?))
}

/// Direct member/agent activation with CAS, idempotency and verified audit.
#[utoipa::path(put,path="/crm/email-privacy/policy",operation_id="update_crm_email_policy",request_body=EmailPolicyCommand,responses((status=200,body=EmailPolicyOutcome),(status=409,description="Consent changed; inspect before deciding again")))]
pub async fn update_handler<
    C: CrmService + EmailPolicyService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: OwnEmailPolicyAccess<Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
    Json(command): Json<EmailPolicyCommand>,
) -> Result<Json<EmailPolicyOutcome>, CrmError> {
    let result = state
        .service
        .change_email_policy(&access.access, access.actor, command)
        .await;
    if matches!(result, Err(CrmError::EmailPolicySharingRefused)) {
        let _ = agent_correlation::context::refuse_sharing(true);
    }
    Ok(Json(result?))
}

/// Canonicalize and authorize a definition without sharing mail.
#[utoipa::path(post,path="/crm/email-privacy/policy/validate",operation_id="validate_crm_email_rules",request_body=EmailRuleSet,responses((status=200,body=EmailRuleValidation)))]
pub async fn validate_handler<
    C: CrmService + EmailPolicyService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: OwnEmailPolicyAccess<Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
    Json(rules): Json<EmailRuleSet>,
) -> Result<Json<EmailRuleValidation>, CrmError> {
    Ok(Json(
        state
            .service
            .validate_email_rules(&access.access, rules)
            .await?,
    ))
}

/// Read only the acting member's audit history.
#[utoipa::path(get,path="/crm/email-privacy/policy/history",operation_id="list_crm_email_policy_history",params(EmailPolicyHistoryQuery),responses((status=200,body=EmailPolicyHistory)))]
pub async fn history_handler<
    C: CrmService + EmailPolicyService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: OwnEmailPolicyAccess<Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
    Query(query): Query<EmailPolicyHistoryQuery>,
) -> Result<Json<EmailPolicyHistory>, CrmError> {
    Ok(Json(
        state
            .service
            .email_policy_history(&access.access, query.before)
            .await?,
    ))
}

pub(super) fn routes<C, St, Eas, Auth>() -> Router<CrmRouterState<C, St, Eas, Auth>>
where
    C: CrmService + EmailPolicyService + EmailPreviewService,
    St: Send + Sync + 'static,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Router::new()
        .route(
            "/email-privacy/policy",
            get(get_handler::<C, St, Eas, Auth>).put(update_handler::<C, St, Eas, Auth>),
        )
        .route(
            "/email-privacy/policy/validate",
            post(validate_handler::<C, St, Eas, Auth>),
        )
        .route(
            "/email-privacy/policy/history",
            get(history_handler::<C, St, Eas, Auth>),
        )
        .route(
            "/email-privacy/policy/revisions/{revision}",
            get(revision_handler::<C, St, Eas, Auth>),
        )
        .route(
            "/email-privacy/policy/preview",
            get(preview_handler::<C, St, Eas, Auth>)
                .post(start_preview_handler::<C, St, Eas, Auth>),
        )
        .route(
            "/email-privacy/policy/preview/{preview_id}",
            axum::routing::delete(cancel_preview_handler::<C, St, Eas, Auth>),
        )
        // The wire envelope may include whitespace and CAS metadata; canonical
        // definitions separately enforce their exact 64 KiB storage budget.
        .layer(DefaultBodyLimit::max(128 * 1024))
}

/// Start optional count-only work; this never initializes or activates consent.
#[utoipa::path(post,path="/crm/email-privacy/policy/preview",operation_id="preview_crm_email_rules",request_body=EmailPreviewRequest,responses((status=200,body=EmailPreviewView)))]
pub async fn start_preview_handler<
    C: CrmService + EmailPreviewService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: OwnEmailPolicyAccess<Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
    Json(input): Json<EmailPreviewRequest>,
) -> Result<Json<EmailPreviewView>, CrmError> {
    Ok(Json(
        state
            .service
            .preview_email_rules(&access.access, input)
            .await?,
    ))
}
/// Inspect the owner's current count preview; no email content is returned.
#[utoipa::path(get,path="/crm/email-privacy/policy/preview",operation_id="get_crm_email_rule_preview",responses((status=200,body=Option<EmailPreviewView>)))]
pub async fn preview_handler<
    C: CrmService + EmailPreviewService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: OwnEmailPolicyAccess<Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
) -> Result<Json<Option<EmailPreviewView>>, CrmError> {
    Ok(Json(
        state.service.email_rule_preview(&access.access).await?,
    ))
}
/// Cancel the owner's current named preview, including while rollout is off.
#[utoipa::path(delete,path="/crm/email-privacy/policy/preview/{preview_id}",operation_id="cancel_crm_email_rule_preview",params(("preview_id"=Uuid,Path)),responses((status=204)))]
pub async fn cancel_preview_handler<
    C: CrmService + EmailPreviewService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: OwnEmailPolicyAccess<Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
    Path(preview_id): Path<Uuid>,
) -> Result<StatusCode, CrmError> {
    state
        .service
        .cancel_email_rule_preview(&access.access, preview_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Fetch one saved definition, independently of live CRM viewing permission.
#[utoipa::path(get,path="/crm/email-privacy/policy/revisions/{revision}",operation_id="get_crm_email_rule_revision",params(("revision"=i64,Path)),responses((status=200,body=Option<EmailPolicyRevision>)))]
pub async fn revision_handler<
    C: CrmService + EmailPolicyService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: OwnEmailPolicyAccess<Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
    Path(revision): Path<i64>,
) -> Result<Json<Option<EmailPolicyRevision>>, CrmError> {
    Ok(Json(
        state
            .service
            .email_policy_revision(&access.access, revision)
            .await?,
    ))
}
