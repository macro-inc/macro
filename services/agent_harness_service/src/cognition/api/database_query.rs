//! HTTP adapter for live database question proposals.

use super::context::{ApiContext, DcsAuthorizationService, DcsChatModelAccess};
use super::structured_completion::StructuredCompletionError;
use crate::cognition::service::database_query::{self, DatabaseQueryAnswer, DatabaseQueryRequest};
use ai_billing::inbound::admission::admission_status;
use axum::{Json, extract::State, http::StatusCode};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use std::sync::Arc;
use std::time::Duration;
use tracing::Instrument;

const QUERY_TIMEOUT: Duration = Duration::from_secs(90);

#[cfg(test)]
mod test;

fn discovery_tools() -> ai_toolset::AsyncToolCollection<ai_tools::ToolServiceContext> {
    ai_toolset::AsyncToolCollection::new().add_subtoolset::<ai_tools::ToolDatabasesToolContext>(
        databases::inbound::toolset::databases_read_only_toolset(),
    )
}

#[utoipa::path(post, path = "/database-query", request_body = DatabaseQueryRequest,
    responses((status = 200, body = DatabaseQueryAnswer),
        (status = 401, description = "Unauthorized"),
        (status = 402, body = StructuredCompletionError),
        (status = 403, body = StructuredCompletionError),
        (status = 500, body = StructuredCompletionError),
        (status = 503, body = StructuredCompletionError),
        (status = 504, body = StructuredCompletionError)))]
#[tracing::instrument(skip_all, fields(user_id = %user.authorization.user.macro_user_id,
    database_query.model = %request.model), err)]
pub async fn generate_database_query(
    State(state): State<ApiContext>,
    model_access: DcsChatModelAccess,
    user: MacroAuthorizationExtractor<DcsAuthorizationService, UserOrInternal>,
    Json(request): Json<DatabaseQueryRequest>,
) -> Result<Json<DatabaseQueryAnswer>, StructuredCompletionError> {
    if !model_access.has_access(&request.model) {
        return Err(StructuredCompletionError {
            error: format!("No access to model {}", request.model),
            status: StatusCode::FORBIDDEN,
            code: None,
        });
    }
    let user_id = user.authorization.user.macro_user_id.clone();
    state
        .ai_admission
        .admit(&user_id, ai_usage::AiFeature::DynamicCompletionsApi)
        .instrument(tracing::info_span!("database_query.admission"))
        .await
        .map_err(|error| StructuredCompletionError {
            error: error.to_string(),
            status: admission_status(error),
            code: Some(error.code().to_string()),
        })?;
    // The adapter wires only view-capped database tools; no connector discovery.
    let reference = databases_sql::toolset::SQL_READ_GUIDE.to_owned();
    let tools = Arc::new(discovery_tools());
    let result = tokio::time::timeout(
        QUERY_TIMEOUT,
        database_query::generate(
            request,
            reference,
            tools,
            state.tool_service_context.clone(),
            ai_usage::UsageContext::new(ai_usage::AiFeature::DynamicCompletionsApi, user_id),
        ),
    )
    .await;
    match result {
        Ok(Ok(answer)) => Ok(Json(answer)),
        Ok(Err(error)) => Err(StructuredCompletionError {
            error: format!("Database query generation failed: {error}"),
            status: StatusCode::INTERNAL_SERVER_ERROR, code: None,
        }),
        Err(_) => Err(StructuredCompletionError {
            error: "The database question took too long. Try a more specific question or choose a database.".into(),
            status: StatusCode::GATEWAY_TIMEOUT, code: None,
        }),
    }
}
