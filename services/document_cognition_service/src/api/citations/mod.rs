use crate::api::context::{ApiContext, DcsAuthorizationService};
use axum::{
    Router,
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::get,
};
use macro_authorization::OptionalMacroAuthorizationExtractor;
use macro_db_client::dcs::get_part_by_id::get_part_by_id;
use model::citations::DocumentTextPart;
use sqlx::PgPool;

pub fn router() -> Router<ApiContext> {
    Router::new().route("/{id}", get(get_citation_handler))
}

#[derive(serde::Deserialize)]
pub struct Params {
    pub id: String,
}

#[utoipa::path(
  get,
  path = "/citations/{id}",
  params(
    ("id" = String, Path, description = "id of the citation")
  ),
  responses(
      (status = 200, body = DocumentTextPart),
      (status = 404, body = String),
      (status = 500, body = String),
  )
)]
#[tracing::instrument(skip(db, user), fields(user_id=?user.macro_user_id))]
pub async fn get_citation_handler(
    State(db): State<PgPool>,
    user: OptionalMacroAuthorizationExtractor<DcsAuthorizationService>,
    Path(Params { id }): Path<Params>,
) -> Result<Json<DocumentTextPart>, (StatusCode, String)> {
    match get_part_by_id(db, id.as_str()).await {
        Ok(Some(part)) => Ok(Json(part)),
        Ok(None) => Err((
            StatusCode::NOT_FOUND,
            "not found - possible hallucination".to_string(),
        )),
        Err(err) => {
            tracing::error!(user_id=?user.macro_user_id, citation_id=%id, error=%err, "failed to get citation");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to get citation".to_string(),
            ))
        }
    }
}
