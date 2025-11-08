use either::Either;
use models_soup::item::SoupItem;
use sqlx::PgPool;

use crate::domain::{
    models::{AdvancedSortParams, SimpleSortRequest, SoupExclude},
    ports::SoupRepo,
};

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
        if req.exclude.contains(&SoupExclude::Frecency) {
            return Either::Left(expanded::by_cursor::no_frecency_expanded_generic_soup(
                &self.inner,
                req.user_id,
                req.limit,
                req.cursor,
            ));
        }

        Either::Right(expanded::by_cursor::expanded_generic_cursor_soup(
            &self.inner,
            req.user_id,
            req.limit,
            req.cursor,
        ))
    }

    fn unexpanded_generic_cursor_soup<'a>(
        &self,
        req: SimpleSortRequest<'a>,
    ) -> impl Future<Output = Result<Vec<SoupItem>, Self::Err>> + Send {
        if req.exclude.contains(&SoupExclude::Frecency) {
            return Either::Left(expanded::by_cursor::no_frecency_expanded_generic_soup(
                &self.inner,
                req.user_id,
                req.limit,
                req.cursor,
            ));
        }
        Either::Right(unexpanded::by_cursor::unexpanded_generic_cursor_soup(
            &self.inner,
            req.user_id,
            req.limit,
            req.cursor,
        ))
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
