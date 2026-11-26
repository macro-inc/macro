use std::sync::Arc;

use axum::{
    Extension, Json, Router,
    extract::{Path, State},
    http::{StatusCode, header::CACHE_CONTROL},
    response::{IntoResponse, Response},
    routing::get,
};

use super::{Authority, Journal, MacroUserIdStr, ReadError, Scope};

/// The test harness supplies a signed-in identity via request extensions.
/// A browser cannot set extensions. A real listener would mint this from
/// Macro user authentication, with a reviewed human viewer policy.
#[derive(Clone)]
pub(super) struct Viewer(pub(super) MacroUserIdStr<'static>);

struct JournalState<A> {
    authority: A,
    journal: Journal,
}

pub(super) fn router<A: Authority + 'static>(authority: A, journal: Journal) -> Router {
    Router::new()
        .route("/teams/{team}/agents/{agent}/journal", get(read::<A>))
        .with_state(Arc::new(JournalState { authority, journal }))
}

async fn read<A: Authority>(
    State(state): State<Arc<JournalState<A>>>,
    Path((team, agent)): Path<(String, String)>,
    viewer: Option<Extension<Viewer>>,
) -> Response {
    let result = match (team.parse(), MacroUserIdStr::try_from(agent), viewer) {
        (Ok(team), Ok(agent), Some(Extension(Viewer(viewer)))) => {
            state
                .journal
                .read(&state.authority, &viewer, &Scope { team, agent })
                .await
        }
        _ => Err(ReadError::Unavailable),
    };
    let response = match result {
        Ok(view) => Json(view).into_response(),
        Err(ReadError::Unavailable) => StatusCode::NOT_FOUND.into_response(),
        Err(ReadError::AuthorityFailed) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    };
    ([(CACHE_CONTROL, "no-store")], response).into_response()
}
