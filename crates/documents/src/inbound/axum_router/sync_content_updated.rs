//! Handler for sync-content notifications from the synchronization service.

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor, MacroAuthorizationService};
use serde::Deserialize;

use super::{DocumentRouterState, Params};
use crate::domain::{
    events::DocumentEditor, models::DocumentError, ports::DocumentContentEventService,
};

/// One editor's attribution, from the sync service's verified document tokens.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReportedEditor {
    /// Actor that performed the edit.
    pub actor: String,
    /// User represented by the actor, if any.
    pub on_behalf_of: Option<String>,
}

/// Attribution for one sync publish: every editor whose accepted edits it
/// carries.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SyncContentUpdatedRequest {
    /// The editors this publish is attributed to.
    #[serde(default)]
    pub editors: Vec<ReportedEditor>,
    /// Superseded by [`Self::editors`]: the single actor sync reported before
    /// a publish could name several. Read while a sync deployment that
    /// predates `editors` is still calling.
    #[serde(default)]
    pub actor: Option<String>,
    /// User represented by [`Self::actor`], if any.
    #[serde(default)]
    pub on_behalf_of: Option<String>,
}

impl SyncContentUpdatedRequest {
    /// The reported editors as domain attributions, dropping entries whose
    /// actor id doesn't parse.
    fn editors(self) -> Vec<DocumentEditor> {
        let legacy = self
            .actor
            .map(|actor| ReportedEditor {
                actor,
                on_behalf_of: self.on_behalf_of,
            })
            .into_iter();
        self.editors
            .into_iter()
            .chain(legacy)
            .filter_map(|editor| DocumentEditor::from_reported(editor.actor, editor.on_behalf_of))
            .collect()
    }
}

/// Publish an event using the document's stored metadata.
#[tracing::instrument(err, skip(state, _internal_authorization))]
pub async fn sync_content_updated_handler<
    T: DocumentContentEventService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    _internal_authorization: MacroAuthorizationExtractor<Auth, InternalOnly>,
    Path(Params { document_id }): Path<Params>,
    Json(request): Json<SyncContentUpdatedRequest>,
) -> Result<StatusCode, DocumentError> {
    state
        .service
        .publish_sync_content_updated(&document_id, request.editors())
        .await?;
    Ok(StatusCode::OK)
}
