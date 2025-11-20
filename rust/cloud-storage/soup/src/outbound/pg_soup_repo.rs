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
