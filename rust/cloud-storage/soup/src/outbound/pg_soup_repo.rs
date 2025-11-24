use crate::{
    domain::{
        models::{AdvancedSortParams, SimpleSortQuery, SimpleSortRequest},
        ports::SoupRepo,
    },
    outbound::pg_soup_repo::expanded::dynamic::ExpandedDynamicCursorArgs,
};
use either::Either;
use models_soup::item::SoupItem;
use sqlx::PgPool;

mod expanded;
mod unexpanded;

pub struct PgSoupRepo {
    inner: PgPool,
}

impl PgSoupRepo {
    pub fn new(inner: PgPool) -> Self {
        PgSoupRepo { inner }
    }
}

impl SoupRepo for PgSoupRepo {
    type Err = sqlx::Error;

    fn expanded_generic_cursor_soup<'a>(
        &self,
        req: SimpleSortRequest<'a>,
    ) -> impl Future<Output = Result<Vec<SoupItem>, Self::Err>> + Send {
        match req.cursor {
            SimpleSortQuery::ItemsAndFrecencyFilter(query) => {
                // Extract the EntityFilterAst from the tuple (Frecency, EntityFilterAst)
                Either::Left(Either::Left(
                    expanded::dynamic::expanded_dynamic_cursor_soup(
                        &self.inner,
                        ExpandedDynamicCursorArgs {
                            user_id: req.user_id,
                            limit: req.limit,
                            cursor: query.map_filter(|(_, ast)| ast),
                            exclude_frecency: true,
                        },
                    ),
                ))
            }
            SimpleSortQuery::ItemsFilter(ast) => Either::Left(Either::Right(
                expanded::dynamic::expanded_dynamic_cursor_soup(
                    &self.inner,
                    ExpandedDynamicCursorArgs {
                        user_id: req.user_id,
                        limit: req.limit,
                        cursor: ast,
                        exclude_frecency: false,
                    },
                ),
            )),
            SimpleSortQuery::FilterFrecency(f) => Either::Right(Either::Left(
                expanded::by_cursor::no_frecency_expanded_generic_soup(
                    &self.inner,
                    req.user_id,
                    req.limit,
                    f,
                ),
            )),
            SimpleSortQuery::NoFilter(f) => Either::Right(Either::Right(
                expanded::by_cursor::expanded_generic_cursor_soup(
                    &self.inner,
                    req.user_id,
                    req.limit,
                    f,
                ),
            )),
        }
    }

    fn unexpanded_generic_cursor_soup<'a>(
        &self,
        req: SimpleSortRequest<'a>,
    ) -> impl Future<Output = Result<Vec<SoupItem>, Self::Err>> + Send {
        match req.cursor {
            SimpleSortQuery::ItemsFilter(_) => Either::Left(Either::Left(not_implemented(req))),
            SimpleSortQuery::ItemsAndFrecencyFilter(_) => {
                Either::Left(Either::Right(not_implemented(req)))
            }
            SimpleSortQuery::FilterFrecency(f) => Either::Right(Either::Left(
                expanded::by_cursor::no_frecency_expanded_generic_soup(
                    &self.inner,
                    req.user_id,
                    req.limit,
                    f,
                ),
            )),
            SimpleSortQuery::NoFilter(f) => Either::Right(Either::Right(
                unexpanded::by_cursor::unexpanded_generic_cursor_soup(
                    &self.inner,
                    req.user_id,
                    req.limit,
                    f,
                ),
            )),
        }
    }

    fn expanded_soup_by_ids<'a>(
        &self,
        req: AdvancedSortParams<'a>,
    ) -> impl Future<Output = Result<Vec<SoupItem>, Self::Err>> + Send {
        expanded::by_ids::expanded_soup_by_ids(&self.inner, req.user_id, req.entities)
    }

    fn unexpanded_soup_by_ids<'a>(
        &self,
        req: AdvancedSortParams<'a>,
    ) -> impl Future<Output = Result<Vec<SoupItem>, Self::Err>> + Send {
        unexpanded::by_ids::unexpanded_soup_by_ids(&self.inner, req.user_id, req.entities)
    }
}

#[tracing::instrument(err)]
async fn not_implemented<Ok>(_req: SimpleSortRequest<'_>) -> Result<Ok, sqlx::Error> {
    Err(sqlx::Error::InvalidArgument(
        "Unexpanded soup ast filters are not yet supported".to_string(),
    ))
}

/// utility fn for queries to create a sqlx err
fn type_err<E: std::fmt::Display>(e: E) -> sqlx::Error {
    sqlx::Error::TypeNotFound {
        type_name: e.to_string(),
    }
}

/// this defines a macro which maps the soup query types for statically checked soup queries
/// This must be a macro because compile time queries cannot have a named type so we can't use a function
#[macro_export]
macro_rules! map_soup_type {
    () => {
        |r| match r.item_type.as_ref() {
            "document" => Ok(::models_soup::item::SoupItem::Document(
                ::models_soup::document::SoupDocument {
                    id: Uuid::parse_str(&r.id).map_err(type_err)?,
                    document_version_id: r
                        .document_version_id
                        .ok_or_else(|| type_err("document version id must exist"))
                        .and_then(|s| FromStr::from_str(&s).map_err(type_err))?,
                    owner_id: MacroUserIdStr::parse_from_str(&r.user_id)
                        .map_err(type_err)?
                        .into_owned(),
                    name: r.name,
                    file_type: r.file_type,
                    sha: r.sha,
                    project_id: r
                        .project_id
                        .as_deref()
                        .map(Uuid::parse_str)
                        .transpose()
                        .map_err(type_err)?,
                    branched_from_id: r
                        .branched_from_id
                        .as_deref()
                        .map(Uuid::parse_str)
                        .transpose()
                        .map_err(type_err)?,
                    branched_from_version_id: r.branched_from_version_id,
                    document_family_id: r.document_family_id,
                    created_at: r.created_at,
                    updated_at: r.updated_at,
                    viewed_at: r.viewed_at,
                },
            )),
            "chat" => Ok(::models_soup::item::SoupItem::Chat(
                ::models_soup::chat::SoupChat {
                    id: Uuid::parse_str(&r.id).map_err(type_err)?,
                    name: r.name,
                    owner_id: MacroUserIdStr::parse_from_str(&r.user_id)
                        .map_err(type_err)?
                        .into_owned(),
                    project_id: r
                        .project_id
                        .as_deref()
                        .map(Uuid::parse_str)
                        .transpose()
                        .map_err(type_err)?,
                    is_persistent: r.is_persistent.unwrap_or_default(),
                    created_at: r.created_at,
                    updated_at: r.updated_at,
                    viewed_at: r.viewed_at,
                },
            )),
            "project" => Ok(::models_soup::item::SoupItem::Project(
                ::models_soup::project::SoupProject {
                    id: Uuid::parse_str(&r.id).map_err(type_err)?,
                    name: r.name,
                    owner_id: MacroUserIdStr::parse_from_str(&r.user_id)
                        .map_err(type_err)?
                        .into_owned(),
                    parent_id: r
                        .project_id
                        .as_deref()
                        .map(Uuid::parse_str)
                        .transpose()
                        .map_err(type_err)?,
                    created_at: r.created_at,
                    updated_at: r.updated_at,
                    viewed_at: r.viewed_at,
                },
            )),
            _ => Err(sqlx::Error::TypeNotFound {
                type_name: r.item_type,
            }),
        }
    };
}
