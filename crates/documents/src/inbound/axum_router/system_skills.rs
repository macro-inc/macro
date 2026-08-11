//! Handler for `GET /documents/system_skills`.

use axum::Json;
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOrInternal};

use crate::domain::models::{SystemSkillSummary, SystemSkillsResponse};

/// Lists the built-in system skills. System skills are static, code-defined
/// AI instructions (see the `system_skills` crate); they surface in the
/// skills menu and AI skill tools like user skills, but have no document
/// behind them, so clients must not offer to open them.
#[utoipa::path(
    tag = "document",
    get,
    path = "/documents/system_skills",
    responses(
        (status = 200, body = inline(SystemSkillsResponse)),
        (status = 401, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip_all)]
pub async fn get_system_skills_handler<Auth: MacroAuthorizationService>(
    _user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Json<SystemSkillsResponse> {
    Json(SystemSkillsResponse {
        skills: system_skills::SYSTEM_SKILLS
            .iter()
            .map(|skill| SystemSkillSummary {
                id: skill.id(),
                name: skill.name.to_string(),
            })
            .collect(),
    })
}
