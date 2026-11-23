use crate::domain::models::list::ContactList;
use crate::domain::models::page::{ContactCursor, ContactPageSize};
use crate::domain::models::people::{PeopleSearchLimit, PeopleSearchQuery, PersonMatch};
use crate::domain::ports::{ContactListMembersService, ContactsService, PeopleSearchService};
use axum::extract::{FromRef, FromRequestParts, Json, Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{RequestPartsExt, Router};
use axum_extra::extract::Cached;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::Base64Str;
use rate_limit::domain::models::RateLimitOk;
use rate_limit::inbound::{RateLimitExtractable, rate_limit_middleware};
use rate_limit::{RateLimitConfig, RateLimitKey, RateLimitResult, RateLimitService};
use rootcause::Report;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tracing::instrument;
use utoipa::{OpenApi, ToSchema};

/// Response body for GET /contacts.
#[derive(Deserialize, Serialize, Debug, ToSchema)]
pub struct GetContactsResponse {
    /// The list of contact user IDs.
    #[schema(value_type = Vec<String>)]
    pub contacts: Vec<MacroUserIdStr<'static>>,
}

/// Request body for POST /contacts.
#[derive(Deserialize, Serialize, Debug, ToSchema)]
pub struct AddContactRequest {
    /// The user ID to add as a contact.
    #[schema(value_type = String)]
    pub user_id: MacroUserIdStr<'static>,
}

/// Query string for GET /contacts/search.
#[derive(Deserialize, Debug, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct SearchPeopleParams {
    /// Text matched against email and name. Under two characters after
    /// trimming returns no people; over 512 bytes is rejected.
    pub query: String,
    /// Maximum results: default 20, values over 50 are capped at 50, zero is rejected.
    #[param(minimum = 1)]
    pub limit: Option<u32>,
}

/// One ranked person in a GET /contacts/search response.
#[derive(Deserialize, Serialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SearchedPerson {
    /// The person's user ID (`macro|<email>`).
    #[schema(value_type = String)]
    pub user_id: MacroUserIdStr<'static>,
    /// Resolved name, as the contact directory shows it; null when unknown.
    pub name: Option<String>,
    /// Whether the person is on the viewer's current team.
    pub is_teammate: bool,
    /// Whether the person is an agent rather than a human; false for non-Macro contacts.
    pub is_agent: bool,
    /// The keys of the viewer's contact lists the person is in (`teammates`,
    /// `interacted`, `invited`, `gmail`, `outlook`; more may be added). Empty
    /// for the viewer and for a contact only the legacy directory knows.
    pub lists: Vec<String>,
}

impl From<PersonMatch> for SearchedPerson {
    fn from(person: PersonMatch) -> Self {
        Self {
            user_id: person.contact.user_id,
            name: person.contact.name,
            is_teammate: person.is_teammate,
            is_agent: person.is_agent,
            lists: person
                .contact
                .lists
                .iter()
                .map(|list| list.as_ref().to_owned())
                .collect(),
        }
    }
}

/// Response body for GET /contacts/search.
#[derive(Deserialize, Serialize, Debug, ToSchema)]
pub struct SearchPeopleResponse {
    /// Matches ranked by group, then prefix matches, then by name or email.
    /// Teammates come first. For a viewer on the list-aware directory,
    /// `interacted` and `invited` people come next, then `gmail` and
    /// `outlook` contacts.
    pub people: Vec<SearchedPerson>,
}

/// GET /contacts/search handler: ranked search of the viewer's contacts and team.
#[utoipa::path(get,
    tag = "contacts",
    operation_id = "search_people",
    path = "/contacts/search",
    params(SearchPeopleParams),
    responses(
    (status = 200, body=SearchPeopleResponse),
    (status = 400, body=String),
    (status = 401, body=String),
    (status = 500, body=String)))
]
#[instrument(skip_all)]
pub async fn search_people_handler<S: PeopleSearchService, Auth: MacroAuthorizationService>(
    State(service): State<Arc<S>>,
    Cached(authorization): Cached<MacroAuthorizationExtractor<Auth, UserOrInternal>>,
    Query(params): Query<SearchPeopleParams>,
) -> Result<Json<SearchPeopleResponse>, (StatusCode, &'static str)> {
    let query = PeopleSearchQuery::new(&params.query)
        .ok_or((StatusCode::BAD_REQUEST, "query is too long"))?;
    let limit = match params.limit {
        None => PeopleSearchLimit::DEFAULT,
        Some(limit) => PeopleSearchLimit::new(limit)
            .ok_or((StatusCode::BAD_REQUEST, "limit must be at least 1"))?,
    };
    let viewer = authorization.authorization.user.macro_user_id.clone();
    let people = service
        .search_people(viewer, &query, limit)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to search people");
            (StatusCode::INTERNAL_SERVER_ERROR, "failed to search people")
        })?;
    Ok(Json(SearchPeopleResponse {
        people: people.into_iter().map(SearchedPerson::from).collect(),
    }))
}

/// Query string for GET /contacts/lists/{list}/members.
#[derive(Deserialize, Debug, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ListMembersParams {
    /// Opaque `nextCursor` from the previous page of the same list.
    pub cursor: Option<String>,
    /// Page size: default 100; zero or over 500 is rejected.
    #[param(minimum = 1, maximum = 500)]
    pub limit: Option<u16>,
}

/// Response body for GET /contacts/lists/{list}/members.
#[derive(Deserialize, Serialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListMembersResponse {
    /// The members' user IDs (`macro|<email>`), in ID order. Never the viewer.
    #[schema(value_type = Vec<String>)]
    pub members: Vec<MacroUserIdStr<'static>>,
    /// Pass back as `cursor` for the next page. Only its absence means the
    /// list is exhausted: a page may be short, or even empty, and still have one.
    pub next_cursor: Option<String>,
}

/// GET /contacts/lists/{list}/members handler: one page of the members of one
/// of the viewer's contact lists. Read from the list-aware directory for every
/// viewer, whatever store the `contacts-list-reads` flag picks for their
/// other reads; stored lists may be incomplete until the list backfill has
/// run. `teammates` is the viewer's current team.
#[utoipa::path(get,
    tag = "contacts",
    operation_id = "list_contact_list_members",
    path = "/contacts/lists/{list}/members",
    params(("list" = ContactList, Path, description = "The list's key."), ListMembersParams),
    responses(
    (status = 200, body=ListMembersResponse),
    (status = 400, body=String),
    (status = 401, body=String),
    (status = 500, body=String)))
]
#[instrument(skip_all)]
pub async fn list_members_handler<S: ContactListMembersService, Auth: MacroAuthorizationService>(
    State(service): State<Arc<S>>,
    Cached(authorization): Cached<MacroAuthorizationExtractor<Auth, UserOrInternal>>,
    Path(list): Path<ContactList>,
    Query(params): Query<ListMembersParams>,
) -> Result<Json<ListMembersResponse>, (StatusCode, &'static str)> {
    let limit = match params.limit {
        None => ContactPageSize::DEFAULT,
        Some(limit) => ContactPageSize::new(limit)
            .ok_or((StatusCode::BAD_REQUEST, "limit must be from 1 to 500"))?,
    };
    let after = params
        .cursor
        .map(|raw| {
            Base64Str::<String>::new_from_string(raw)
                .decode_json()
                .ok()
                .and_then(ContactCursor::from_position)
                .ok_or((StatusCode::BAD_REQUEST, "invalid cursor"))
        })
        .transpose()?;
    let viewer = authorization.authorization.user.macro_user_id.clone();
    let page = service
        .list_members(viewer, list, after.as_ref(), limit)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to list contact list members");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to list contact list members",
            )
        })?;
    Ok(Json(ListMembersResponse {
        members: page
            .contacts
            .into_iter()
            .map(|entry| entry.user_id)
            .collect(),
        next_cursor: page
            .next_cursor
            .map(|cursor| Base64Str::encode_json(cursor.position()).type_erase()),
    }))
}

/// GET /contacts handler.
#[utoipa::path(get,
    tag = "contacts",
    operation_id = "get_contacts",
    path = "/contacts",
    responses(
    (status = 200, body=GetContactsResponse),
    (status = 401, body=String),
    (status = 404, body=String),
    (status = 500, body=String)))
]
#[instrument(skip_all)]
pub async fn handler<S: ContactsService, Auth: MacroAuthorizationService>(
    State(contacts): State<Arc<S>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> impl IntoResponse {
    let user = authorization.authorization.user;

    match contacts.query_contacts(user.macro_user_id.clone()).await {
        Ok(contacts) if !contacts.is_empty() => {
            (StatusCode::OK, Json(Some(GetContactsResponse { contacts })))
        }
        Ok(_) => (StatusCode::NOT_FOUND, Json(None)),
        Err(_e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(None)),
    }
}

/// POST /contacts handler.
#[utoipa::path(post,
    tag = "contacts",
    operation_id = "add_contact",
    path = "/contacts",
    request_body = AddContactRequest,
    responses(
    (status = 204),
    (status = 401, body=String),
    (status = 500, body=String)))
]
#[instrument(skip_all, err)]
pub async fn add_contact_handler<S: ContactsService, Auth: MacroAuthorizationService>(
    State(service): State<Arc<S>>,
    Cached(authorization): Cached<MacroAuthorizationExtractor<Auth, UserOrInternal>>,
    Json(body): Json<AddContactRequest>,
) -> Result<StatusCode, StatusCode> {
    let user = authorization.authorization.user;

    service
        .invite_contact(user.macro_user_id.clone().into_owned(), body.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to record invited contact");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    Ok(StatusCode::NO_CONTENT)
}

/// Rate limit for adding contacts: 50 requests per user per hour.
pub struct PerUserAddContactRateLimit<Auth>(MacroAuthorizationExtractor<Auth, UserOrInternal>);

impl<S, Auth> RateLimitExtractable<S> for PerUserAddContactRateLimit<Auth>
where
    S: Send + Sync + 'static,
    Auth: MacroAuthorizationService,
    MacroAuthorizationState<Auth>: FromRef<S>,
{
    fn config() -> RateLimitConfig {
        RateLimitConfig {
            max_count: 50,
            window: Duration::from_mins(60),
        }
    }

    fn key(&self) -> RateLimitKey {
        RateLimitKey::builder(&"per-user-add-contact")
            .append(&self.0.authorization.user.macro_user_id.as_ref())
            .finish()
    }
}

impl<S, Auth> FromRequestParts<S> for PerUserAddContactRateLimit<Auth>
where
    S: Send + Sync + 'static,
    Auth: MacroAuthorizationService,
    MacroAuthorizationState<Auth>: FromRef<S>,
{
    type Rejection = macro_authorization::MacroAuthorizationRejection;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &S,
    ) -> Result<Self, Self::Rejection> {
        let Cached(authorization): Cached<MacroAuthorizationExtractor<Auth, UserOrInternal>> =
            parts.extract_with_state(state).await?;
        Ok(Self(authorization))
    }
}

/// Rate limit shared by people search and list members: 600 requests per
/// user per hour, the budget other interactive read routes use.
pub struct PerUserPeopleSearchRateLimit<Auth>(MacroAuthorizationExtractor<Auth, UserOrInternal>);

impl<S, Auth> RateLimitExtractable<S> for PerUserPeopleSearchRateLimit<Auth>
where
    S: Send + Sync + 'static,
    Auth: MacroAuthorizationService,
    MacroAuthorizationState<Auth>: FromRef<S>,
{
    fn config() -> RateLimitConfig {
        RateLimitConfig {
            max_count: 600,
            window: Duration::from_mins(60),
        }
    }

    fn key(&self) -> RateLimitKey {
        RateLimitKey::builder(&"per-user-people-search")
            .append(&self.0.authorization.user.macro_user_id.as_ref())
            .finish()
    }
}

impl<S, Auth> FromRequestParts<S> for PerUserPeopleSearchRateLimit<Auth>
where
    S: Send + Sync + 'static,
    Auth: MacroAuthorizationService,
    MacroAuthorizationState<Auth>: FromRef<S>,
{
    type Rejection = macro_authorization::MacroAuthorizationRejection;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &S,
    ) -> Result<Self, Self::Rejection> {
        let Cached(authorization): Cached<MacroAuthorizationExtractor<Auth, UserOrInternal>> =
            parts.extract_with_state(state).await?;
        Ok(Self(authorization))
    }
}

/// State required by the contacts HTTP router.
pub struct ContactsRouterState<S, R, Auth> {
    /// The contacts service implementation.
    pub contacts_service: Arc<S>,
    /// The rate-limit service implementation.
    pub rate_limit_service: R,
    /// State for request authorization.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, R: Clone, Auth> Clone for ContactsRouterState<S, R, Auth> {
    fn clone(&self) -> Self {
        Self {
            contacts_service: self.contacts_service.clone(),
            rate_limit_service: self.rate_limit_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, R, Auth> FromRef<ContactsRouterState<S, R, Auth>> for Arc<S> {
    fn from_ref(state: &ContactsRouterState<S, R, Auth>) -> Self {
        state.contacts_service.clone()
    }
}

impl<S, R, Auth> FromRef<ContactsRouterState<S, R, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &ContactsRouterState<S, R, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

struct AddContactRateLimitState<R, Auth> {
    rate_limit_service: R,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<R: Clone, Auth> Clone for AddContactRateLimitState<R, Auth> {
    fn clone(&self) -> Self {
        Self {
            rate_limit_service: self.rate_limit_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<R, Auth> FromRef<AddContactRateLimitState<R, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &AddContactRateLimitState<R, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

impl<R, Auth> RateLimitService for AddContactRateLimitState<R, Auth>
where
    R: RateLimitService,
    Auth: MacroAuthorizationService,
{
    async fn check_rate_limit(
        &self,
        key: RateLimitKey,
        config: RateLimitConfig,
    ) -> Result<RateLimitResult, Report> {
        self.rate_limit_service.check_rate_limit(key, config).await
    }

    async fn rollback_ticket(&self, ticket: RateLimitOk) -> Result<(), Report> {
        self.rate_limit_service.rollback_ticket(ticket).await
    }
}

/// Builds the contacts API router with authorization, and per-user rate
/// limits on POST /contacts, and on GET /contacts/search and
/// GET /contacts/lists/{list}/members, which share one read budget.
pub fn contacts_router<S, R, Auth, T>(state: ContactsRouterState<S, R, Auth>) -> Router<T>
where
    S: ContactsService + PeopleSearchService + ContactListMembersService,
    R: RateLimitService + Clone,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    let rate_limit_state = AddContactRateLimitState {
        rate_limit_service: state.rate_limit_service.clone(),
        authorization_state: state.authorization_state.clone(),
    };
    let post_route = Router::new()
        .route(
            "/contacts",
            axum::routing::post(add_contact_handler::<S, Auth>),
        )
        .layer(axum::middleware::from_fn_with_state(
            rate_limit_state.clone(),
            rate_limit_middleware::<
                AddContactRateLimitState<R, Auth>,
                PerUserAddContactRateLimit<Auth>,
                AddContactRateLimitState<R, Auth>,
            >,
        ));
    let search_route = Router::new()
        .route("/contacts/search", get(search_people_handler::<S, Auth>))
        .route(
            "/contacts/lists/{list}/members",
            get(list_members_handler::<S, Auth>),
        )
        .layer(axum::middleware::from_fn_with_state(
            rate_limit_state,
            rate_limit_middleware::<
                AddContactRateLimitState<R, Auth>,
                PerUserPeopleSearchRateLimit<Auth>,
                AddContactRateLimitState<R, Auth>,
            >,
        ));

    Router::new()
        .route("/contacts", get(handler::<S, Auth>))
        .merge(post_route)
        .merge(search_route)
        .with_state(state)
}

/// OpenAPI documentation.
#[derive(OpenApi)]
#[openapi(
        info(
            terms_of_service = "https://macro.com/terms",
        ),
        paths(
            handler,
            add_contact_handler,
            search_people_handler,
            list_members_handler,
        ),
        components(
            schemas(
                GetContactsResponse,
                AddContactRequest,
                SearchPeopleResponse,
                SearchedPerson,
                ContactList,
                ListMembersResponse,
            ),
        ),
        tags(
            (name = "macro contacts service", description = "Contacts Service")
        )
    )]
pub struct ApiDoc;

#[cfg(test)]
mod test;
