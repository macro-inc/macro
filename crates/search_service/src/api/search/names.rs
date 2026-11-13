//! `POST /names`: the items of every kind the caller can access whose name is
//! one of the names asked for. The lookup itself is
//! [`crate::domain::names::NameLookup`]; this adapter authenticates the
//! caller, resolves their team and adds the sources that read this crate's
//! own stores to the ones the host app supplies.

use std::sync::Arc;

use axum::{
    extract::{Json, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use document_sub_type::DocumentSubType;
use entity_access::domain::models::{
    Entity, EntityAccessReceipt, EntityPermission, EntityType, MemberTeamRole,
};
use entity_access::domain::ports::EntityAccessService;
use futures::{StreamExt, TryStreamExt};
use macro_authorization::{MacroAuthorizationExtractor, MacroUserAuthentication, UserOrInternal};
use macro_user_id::user_id::MacroUserIdStr;
use model::response::ErrorResponse;
use models_search::{
    MatchType, SearchOn,
    names::{NameKind, NameSearchRequest, NameSearchResponse, NamedItem},
    unified::UnifiedSearchRequest,
};
use uuid::Uuid;

use crate::{
    api::{
        context::{SearchAuthorizationService, SearchHandlerState},
        search::{SearchPaginationParams, simple::simple_unified::perform_unified_search},
    },
    domain::names::{
        Candidate, NameLookup, NameLookupError, NameSource, NameSourceError, NameViewer, Needle,
        READS_PER_SOURCE,
    },
    outbound::names::ChannelNames,
};

#[cfg(test)]
mod test;

/// The shortest name the document index is searched for.
const MIN_INDEXED_NAME_CHARS: usize = 3;

/// How many documents one name's index search reads. The index returns the
/// most recently updated first, so an exact name that more than this many
/// newer documents contain is missed.
const DOCUMENTS_PER_NAME: u32 = 50;

/// The nil id, which leaves a kind out of a unified search.
const EXCLUDED: &str = "00000000-0000-0000-0000-000000000000";

/// Why a name lookup failed.
#[derive(Debug, thiserror::Error)]
pub enum NamesError {
    /// The request asked for no names, too many, or an empty or overlong one.
    #[error(transparent)]
    Invalid(#[from] NameLookupError),
    /// The caller's team couldn't be read.
    #[error("internal error")]
    Internal(rootcause::Report),
}

impl IntoResponse for NamesError {
    fn into_response(self) -> Response {
        let status = match &self {
            Self::Invalid(_) => StatusCode::BAD_REQUEST,
            Self::Internal(error) => {
                tracing::error!(error = ?error, "name lookup failed");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        (
            status,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}

/// Look up names: per name, the items of the kinds asked for that the caller
/// can access whose name is that name, ignoring case and one leading `#` or
/// `@`, then a few whose name contains it.
#[utoipa::path(
    post,
    path = "/search/names",
    operation_id = "search_names",
    request_body = NameSearchRequest,
    responses(
            (status = 200, body = NameSearchResponse),
            (status = 400, body = ErrorResponse),
            (status = 401, body = ErrorResponse),
            (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, fields(user_id = %authorization.authorization.user.user_context.user_id), err)]
pub(in crate::api) async fn handler(
    State(ctx): State<SearchHandlerState>,
    authorization: MacroAuthorizationExtractor<SearchAuthorizationService, UserOrInternal>,
    Json(request): Json<NameSearchRequest>,
) -> Result<Json<NameSearchResponse>, NamesError> {
    let caller = authorization.authorization.user;
    let user = caller.macro_user_id.clone();
    let team = if wants_team(&request) {
        team_receipt(&ctx, &user).await?
    } else {
        None
    };
    let viewer = NameViewer { user, team };

    let mut sources: Vec<Arc<dyn NameSource>> = vec![
        Arc::new(ChannelNames::new(ctx.db.clone())),
        Arc::new(IndexedDocuments {
            ctx: ctx.clone(),
            caller,
        }),
    ];
    sources.extend(ctx.name_sources.iter().cloned());

    Ok(Json(
        NameLookup::new(sources).lookup(&viewer, request).await?,
    ))
}

/// Whether any name looks in a kind that has team items.
fn wants_team(request: &NameSearchRequest) -> bool {
    request.names.iter().any(|query| {
        query.kinds.is_empty()
            || query
                .kinds
                .iter()
                .any(|kind| matches!(kind, NameKind::Tag | NameKind::ChannelLabel))
    })
}

/// The caller's team membership, when they are on a team.
async fn team_receipt(
    ctx: &SearchHandlerState,
    user: &MacroUserIdStr<'static>,
) -> Result<Option<EntityAccessReceipt<MemberTeamRole>>, NamesError> {
    let Some(team) = ctx
        .entity_access_service
        .get_user_team(user)
        .await
        .map_err(|error| NamesError::Internal(rootcause::Report::new(error).into_dynamic()))?
    else {
        return Ok(None);
    };
    // Member is the floor for MemberTeamRole, so this never rejects.
    EntityAccessReceipt::<MemberTeamRole>::try_new_authenticated_user(
        user.clone(),
        Entity {
            entity_id: team.team_id.to_string(),
            entity_type: EntityType::Team,
        },
        EntityPermission::TeamRole { role: team.role },
    )
    .map(Some)
    .map_err(|error| NamesError::Internal(rootcause::Report::new(error).into_dynamic()))
}

/// Documents and tasks, from the document index: the same search, and the
/// same access, as a name search of documents.
struct IndexedDocuments {
    ctx: SearchHandlerState,
    caller: MacroUserAuthentication,
}

#[async_trait::async_trait]
impl NameSource for IndexedDocuments {
    fn kinds(&self) -> &'static [NameKind] {
        &[NameKind::Document, NameKind::Task]
    }

    async fn find(
        &self,
        _viewer: &NameViewer,
        _kinds: &[NameKind],
        needles: &[Needle],
    ) -> Result<Vec<Candidate>, NameSourceError> {
        // Futures built up front: a stream `map` closure that borrows the
        // needles isn't `Send` enough for `async_trait`.
        let searches: Vec<_> = needles
            .iter()
            .filter(|needle| needle.as_str().chars().count() >= MIN_INDEXED_NAME_CHARS)
            .map(|needle| self.search(needle))
            .collect();
        let found: Vec<Vec<Uuid>> = futures::stream::iter(searches)
            .buffer_unordered(READS_PER_SOURCE)
            .try_collect()
            .await?;
        let hits: Vec<Uuid> = found.into_iter().flatten().collect();
        if hits.is_empty() {
            return Ok(Vec::new());
        }
        let ids: Vec<String> = hits.iter().map(Uuid::to_string).collect();
        let documents = macro_db_client::document::get_document_history::get_document_history_info(
            &self.ctx.db,
            &self.caller.user_context.user_id,
            &ids,
        )
        .await
        .map_err(|error| NameSourceError::Internal(rootcause::report!("{error:#}")))?;
        Ok(documents
            .into_values()
            .filter(|document| document.deleted_at.is_none())
            .filter_map(|document| {
                let id = Uuid::parse_str(&document.item_id).ok()?;
                let item = match document.sub_type {
                    None | Some(DocumentSubType::Snippet | DocumentSubType::Skill) => {
                        NamedItem::Document { id }
                    }
                    Some(DocumentSubType::Task) => NamedItem::Task { id },
                    // An initiative's description shares its initiative's name.
                    Some(DocumentSubType::InitiativeDescription) => return None,
                };
                Some(Candidate {
                    item,
                    name: document.file_name,
                    aliases: Vec::new(),
                })
            })
            .collect())
    }
}

impl IndexedDocuments {
    /// The ids of the documents whose name holds the needle as a phrase.
    async fn search(&self, needle: &Needle) -> Result<Vec<Uuid>, NameSourceError> {
        let mut request = UnifiedSearchRequest {
            query: needle.as_str().to_string(),
            match_type: MatchType::Exact,
            filters: Default::default(),
            search_on: SearchOn::Name,
            include_crm: false,
            calendar_event_scope: Default::default(),
            collapse: Some(true),
        };
        let filters = &mut request.filters;
        filters.agent_session_filters.ids = vec![EXCLUDED.to_string()];
        filters.calendar_event_filters.calendar_event_ids = vec![EXCLUDED.to_string()];
        filters.call_filters.channel_ids = vec![EXCLUDED.to_string()];
        filters.channel_filters.channel_ids = vec![EXCLUDED.to_string()];
        filters.chat_filters.chat_ids = vec![EXCLUDED.to_string()];
        filters.email_filters.email_thread_ids = vec![EXCLUDED.to_string()];
        filters.project_filters.project_ids = vec![EXCLUDED.to_string()];
        let (hits, _) = perform_unified_search(
            &self.ctx,
            &self.caller,
            None,
            SearchPaginationParams {
                page: None,
                page_size: Some(DOCUMENTS_PER_NAME),
                cursor: None,
            },
            request,
        )
        .await
        .map_err(|error| NameSourceError::Internal(rootcause::Report::new(error).into_dynamic()))?;
        Ok(hits
            .into_iter()
            .filter(|hit| hit.entity_type == models_opensearch::SearchEntityType::Documents)
            .map(|hit| hit.entity_id)
            .collect())
    }
}
