use crate::domain::{
    models::{
        FrecencyQueryInner, FrecencySoupItem, IntoSoupReqAst, SimpleQueryInner, SoupErr, SoupQuery,
        SoupRequest, SoupType,
    },
    ports::SoupService,
};
use axum::{
    Json, Router,
    extract::{FromRef, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use axum_extra::{either::Either, extract::Cached};
use email::{
    domain::{
        models::{Link, PreviewView},
        ports::EmailService,
    },
    inbound::{EmailLinkErr, EmailLinkExtractor, EmailRouterState},
};
use filter_ast::{Expr, ExprFrame};
use item_filters::{
    EntityFilters,
    ast::{
        EntityFilterAst, ExpandErr, LiteralTree, call::CallLiteral, channel::ChannelLiteral,
        chat::ChatLiteral, document::DocumentLiteral, email::EmailLiteral, project::ProjectLiteral,
        properties::PropertiesLiteral,
    },
};
use macro_user_id::user_id::MacroUserIdStr;
use model_error_response::ErrorResponse;
use model_user::axum_extractor::MacroUserExtractor;
use models_pagination::{
    CursorWithValAndFilter, Frecency, PaginatedOpaqueCursor, SimpleSortMethod, SortMethod,
    TypeEraseCursor,
};
use models_soup::item::SoupItem;
use non_empty::IsEmpty;
use recursion::CollapsibleExt;
use rootcause::{Report, report};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use thiserror::Error;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[cfg(test)]
mod tests;

#[derive(Debug, Default, serde::Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
pub struct Params {
    /// Whether to expand projects. Defaults to true.
    #[serde(default)]
    expand: Option<bool>,
    /// Limit the number of items returned. Defaults to 20. Max 500.
    #[serde(default)]
    limit: Option<u16>,
    /// Sort method. Options are viewed_at, created_at, updated_at, viewed_updated. Defaults to viewed_at.
    #[serde(default)]
    sort_method: Option<SoupApiSort>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SoupApiSort {
    ViewedAt,
    CreatedAt,
    UpdatedAt,
    ViewedUpdated,
    Frecency,
}

impl SoupApiSort {
    fn into_sort_method(self) -> SortMethod {
        match self {
            SoupApiSort::ViewedAt => SortMethod::Simple(SimpleSortMethod::ViewedAt),
            SoupApiSort::CreatedAt => SortMethod::Simple(SimpleSortMethod::CreatedAt),
            SoupApiSort::UpdatedAt => SortMethod::Simple(SimpleSortMethod::UpdatedAt),
            SoupApiSort::ViewedUpdated => SortMethod::Simple(SimpleSortMethod::ViewedUpdated),
            SoupApiSort::Frecency => SortMethod::Advanced(Frecency),
        }
    }
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct SoupPage {
    items: Vec<SoupApiItem>,
    next_cursor: Option<String>,
}

pub struct SoupRouterState<T, U> {
    service: Arc<T>,
    email: EmailRouterState<U>,
}

impl<T, U> Clone for SoupRouterState<T, U> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            email: self.email.clone(),
        }
    }
}

impl<T, U> FromRef<SoupRouterState<T, U>> for EmailRouterState<U> {
    fn from_ref(input: &SoupRouterState<T, U>) -> Self {
        input.email.clone()
    }
}

impl<T, U> SoupRouterState<T, U>
where
    T: SoupService,
    U: EmailService,
{
    pub fn new(service: T, email: U) -> Self {
        SoupRouterState {
            service: Arc::new(service),
            email: EmailRouterState::new(email),
        }
    }

    async fn handle<R>(
        &self,
        macro_user_id: MacroUserIdStr<'static>,
        email_link: Option<Link>,
        ApiSoupRequestInner {
            filters,
            params,
            email_view,
        }: ApiSoupRequestInner<R>,
        cursor: SoupCursor<R>,
    ) -> Result<Json<PaginatedOpaqueCursor<SoupApiItem>>, SoupHandlerErr>
    where
        SoupRequest<R>: IntoSoupReqAst,
        R: Clone + Serialize + Send,
    {
        let create_fallback = move || -> SoupQuery<R> {
            let params_sort = params
                .sort_method
                .map(|s| s.into_sort_method())
                .unwrap_or(SortMethod::Simple(SimpleSortMethod::ViewedAt));
            match params_sort {
                SortMethod::Simple(simple_sort_method) => {
                    SoupQuery::new_sort_simple(simple_sort_method, filters)
                }
                SortMethod::Advanced(frecency) => SoupQuery::new_sort_frecency(frecency, filters),
            }
        };

        let cursor: SoupQuery<R> = match cursor {
            Either::E1(l) => l
                .map(SoupQuery::new_cursor_simple)
                .unwrap_or_else(create_fallback),
            Either::E2(r) => r
                .map(SoupQuery::new_cursor_frecency)
                .unwrap_or_else(create_fallback),
        };

        let res = self
            .service
            .get_user_soup(SoupRequest {
                soup_type: match params.expand {
                    Some(true) | None => SoupType::Expanded,
                    Some(false) => SoupType::UnExpanded,
                },
                limit: params.limit.unwrap_or(20),
                cursor,
                user: macro_user_id,
                email_preview_view: email_view,
                link_id: email_link.map(|l| l.id),
            })
            .await?;

        Ok(Json(
            res.type_erase().map(SoupApiItem::from_frecency_soup_item),
        ))
    }
}

pub fn soup_router<T, U, S>(state: SoupRouterState<T, U>) -> Router<S>
where
    T: SoupService,
    U: EmailService,
    S: Send + Sync,
{
    Router::new()
        .route("/soup", get(get_soup_handler))
        .route("/soup", post(post_soup_handler))
        .route("/soup/ast", post(post_soup_ast_handler))
        .with_state(state)
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct SoupApiItem {
    #[serde(flatten)]
    item: SoupItem,
    frecency_score: f64,
}

impl SoupApiItem {
    fn from_frecency_soup_item(item: FrecencySoupItem) -> Self {
        let FrecencySoupItem {
            item,
            frecency_score,
        } = item;
        SoupApiItem {
            item,
            frecency_score: frecency_score
                .map(|f| f.data.frecency_score)
                .unwrap_or_default(),
        }
    }
}

#[derive(Debug, Error)]
pub enum SoupHandlerErr {
    #[error("An internal server error has occurred")]
    Internal(SoupErr),
    #[error("An internal email server error has occurred")]
    EmailLinkErr(#[from] EmailLinkErr),
    #[error("Invalid filter arguments provided")]
    ExpandErr(ExpandErr),
    #[error("Invalid compound filter could not be expanded")]
    Expand,
}

impl From<SoupErr> for SoupHandlerErr {
    fn from(value: SoupErr) -> Self {
        match value {
            SoupErr::AstErr(expand_err) => SoupHandlerErr::ExpandErr(expand_err),
            err => SoupHandlerErr::Internal(err),
        }
    }
}

impl IntoResponse for SoupHandlerErr {
    fn into_response(self) -> axum::response::Response {
        let status_code = match &self {
            SoupHandlerErr::ExpandErr(_) | SoupHandlerErr::Expand => StatusCode::BAD_REQUEST,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (
            status_code,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}

/// Gets the items the user has access to
#[utoipa::path(
    get,
    operation_id = "get_items_soup",
    path = "/items/soup",
    params(
        Params,
        ("cursor" = Option<String>, Query, description = "Base64 encoded cursor value."),
    ),
    responses(
            (status = 200, body=SoupPage),
            (status = 500, body=ErrorResponse),
    )
)]
pub async fn get_soup_handler<T, U>(
    State(service): State<SoupRouterState<T, U>>,
    Cached(MacroUserExtractor { macro_user_id, .. }): Cached<MacroUserExtractor>,
    email_link: Result<Cached<EmailLinkExtractor<U>>, EmailLinkErr>,
    Query(params): Query<Params>,
    cursor: SoupCursor<EntityFilters>,
) -> Result<Json<PaginatedOpaqueCursor<SoupApiItem>>, SoupHandlerErr>
where
    T: SoupService,
    U: EmailService,
{
    let link = match email_link {
        Ok(l) => Some(l.0.0),
        Err(EmailLinkErr::NotFound) => None,
        Err(e) => Err(e)?,
    };
    service
        .handle(
            macro_user_id,
            link,
            ApiSoupRequestInner {
                params,
                filters: EntityFilters::default(),
                email_view: Default::default(),
            },
            cursor,
        )
        .await
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PostSoupRequest {
    #[serde(default, flatten)]
    filters: EntityFilters,
    #[serde(default, flatten)]
    params: Params,
    /// the view of specific emails to display
    #[serde(default)]
    #[schema(value_type = String)]
    email_view: PreviewView,
}

struct ApiSoupRequestInner<T> {
    filters: T,
    params: Params,
    email_view: PreviewView,
}

type SoupCursor<R> = axum_extra::either::Either<
    Option<CursorWithValAndFilter<Uuid, SimpleSortMethod, R>>,
    Option<CursorWithValAndFilter<Uuid, Frecency, R>>,
>;

/// Gets the items the user has access to
#[utoipa::path(
    post,
    operation_id = "post_items_soup",
    path = "/items/soup",
    params(
        ("cursor" = Option<String>, Query, description = "Base64 encoded cursor value."),
    ),
    responses(
            (status = 200, body=SoupPage),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn post_soup_handler<T, U>(
    State(service): State<SoupRouterState<T, U>>,
    Cached(MacroUserExtractor { macro_user_id, .. }): Cached<MacroUserExtractor>,
    email_link: Result<Cached<EmailLinkExtractor<U>>, EmailLinkErr>,
    cursor: SoupCursor<EntityFilters>,
    Json(PostSoupRequest {
        filters,
        params,
        email_view,
    }): Json<PostSoupRequest>,
) -> Result<Json<PaginatedOpaqueCursor<SoupApiItem>>, SoupHandlerErr>
where
    T: SoupService,
    U: EmailService,
{
    let link = match email_link {
        Ok(l) => Some(l.0.0),
        Err(EmailLinkErr::NotFound) => None,
        Err(e) => Err(e)?,
    };
    service
        .handle(
            macro_user_id,
            link,
            ApiSoupRequestInner {
                filters,
                params,
                email_view,
            },
            cursor,
        )
        .await
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PostSoupAstRequest {
    #[serde(default, flatten)]
    #[schema(value_type = EntityFilterAst)]
    filters: ApiEntityFilterAst,
    #[serde(default, flatten)]
    params: Params,
    /// the view of specific emails to display
    #[serde(default)]
    #[schema(value_type = String)]
    email_view: PreviewView,
}

/// Gets the items the user has access to using AST filters
#[utoipa::path(
    post,
    operation_id = "post_items_soup_ast",
    path = "/items/soup/ast",
    params(
        ("cursor" = Option<String>, Query, description = "Base64 encoded cursor value."),
    ),
    request_body = PostSoupAstRequest,
    responses(
        (status = 200, body=SoupPage),
        (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn post_soup_ast_handler<T, U>(
    State(service): State<SoupRouterState<T, U>>,
    Cached(MacroUserExtractor { macro_user_id, .. }): Cached<MacroUserExtractor>,
    email_link: Result<Cached<EmailLinkExtractor<U>>, EmailLinkErr>,
    cursor: SoupCursor<ApiEntityFilterAst>,
    Json(PostSoupAstRequest {
        filters,
        params,
        email_view,
    }): Json<PostSoupAstRequest>,
) -> Result<Json<PaginatedOpaqueCursor<SoupApiItem>>, SoupHandlerErr>
where
    T: SoupService,
    U: EmailService,
{
    let link = match email_link {
        Ok(l) => Some(l.0.0),
        Err(EmailLinkErr::NotFound) => None,
        Err(e) => Err(e)?,
    };
    service
        .handle(
            macro_user_id,
            link,
            ApiSoupRequestInner {
                filters,
                params,
                email_view,
            },
            cursor,
        )
        .await
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ApiEntityFilterAst {
    /// the filters that should be applied to the document entity
    #[serde(default, rename = "df")]
    pub document_filter: LiteralTree<ApiDocumentLiteral>,
    /// the filters that should be applied to the project entity
    #[serde(default, rename = "pf")]
    pub project_filter: LiteralTree<ProjectLiteral>,
    /// the filters that should be applied to the chat entity
    #[serde(default, rename = "cf")]
    pub chat_filter: LiteralTree<ChatLiteral>,
    /// the filters that should be applied to the email entity
    #[serde(default, rename = "ef")]
    pub email_filter: LiteralTree<EmailLiteral>,
    /// the filters that should be applied to the channel entity
    #[serde(default, rename = "chanf")]
    pub channel_filter: LiteralTree<ChannelLiteral>,
    /// the filters that should be applied to the call entity
    #[serde(default, rename = "callf")]
    pub call_filter: LiteralTree<CallLiteral>,
    /// the filters that should be applied based on entity properties
    #[serde(default, rename = "propf")]
    pub properties_filter: LiteralTree<PropertiesLiteral>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
pub enum ApiDocumentLiteral {
    Plain(DocumentLiteral),
    FileAssoc(CompoundDocumentLiteral),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum CompoundDocumentLiteral {
    #[serde(rename = "fa")]
    FileAssoc(String),
}

impl IntoSoupReqAst for SoupRequest<ApiEntityFilterAst> {
    fn into_ast(self) -> Result<SoupRequest<Option<EntityFilterAst>>, ExpandErr> {
        let SoupRequest {
            soup_type,
            limit,
            cursor,
            user,
            email_preview_view,
            link_id,
        } = self;

        let cursor = match cursor {
            SoupQuery::Simple(SimpleQueryInner(query)) => SoupQuery::Simple(SimpleQueryInner(
                query.try_map_filter(ApiEntityFilterAst::into_optional_entity_ast)?,
            )),
            SoupQuery::Frecency(FrecencyQueryInner(query)) => {
                SoupQuery::Frecency(FrecencyQueryInner(
                    query.try_map_filter(ApiEntityFilterAst::into_optional_entity_ast)?,
                ))
            }
        };

        Ok(SoupRequest {
            soup_type,
            limit,
            cursor,
            user,
            email_preview_view,
            link_id,
        })
    }
}

impl ApiEntityFilterAst {
    fn into_optional_entity_ast(self) -> Result<Option<EntityFilterAst>, ExpandErr> {
        let ast = self
            .into_entity_ast()
            .map_err(|e| ExpandErr::ApiAst(e.to_string()))?;
        Ok((!ast.is_empty()).then_some(ast))
    }

    #[tracing::instrument(err, skip(self))]
    fn into_entity_ast(self) -> Result<EntityFilterAst, Report> {
        let ApiEntityFilterAst {
            document_filter,
            project_filter,
            chat_filter,
            email_filter,
            channel_filter,
            call_filter,
            properties_filter,
        } = self;

        let document_filter = document_filter
            .map(|tree| {
                tree.as_ref().try_collapse_frames(|frame| match frame {
                    ExprFrame::And(a, b) => Ok(Expr::and(a, b)),
                    ExprFrame::Or(a, b) => Ok(Expr::or(a, b)),
                    ExprFrame::Not(a) => Ok(Expr::is_not(a)),
                    ExprFrame::Literal(ApiDocumentLiteral::Plain(doc_lit)) => {
                        Ok(Expr::val(doc_lit))
                    }
                    ExprFrame::Literal(ApiDocumentLiteral::FileAssoc(compound)) => match compound {
                        CompoundDocumentLiteral::FileAssoc(s) => {
                            let (_, file_types) =
                                item_filters::ast::document::parse_to_file_types(&s)?;
                            file_types
                                .map(|ft| Expr::val(DocumentLiteral::FileType(ft)))
                                .reduce(Expr::or)
                                .ok_or(report!("File association list cannot be empty"))
                        }
                    },
                })
            })
            .transpose()?
            .map(Arc::new);

        Ok(EntityFilterAst {
            document_filter,
            project_filter,
            chat_filter,
            email_filter,
            channel_filter,
            call_filter,
            properties_filter,
        })
    }
}
