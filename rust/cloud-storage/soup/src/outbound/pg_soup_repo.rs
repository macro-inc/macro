use crate::domain::{
    models::{AdvancedSortParams, SimpleSortFilter, SimpleSortRequest},
    ports::SoupRepo,
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
        match req.cursor.filter() {
            Some(SimpleSortFilter::Ast(_ast) | SimpleSortFilter::FrecencyAst(_, _ast)) => todo!(),
            Some(SimpleSortFilter::Frecency(f)) => {
                let f = *f;
                Either::Left(expanded::by_cursor::no_frecency_expanded_generic_soup(
                    &self.inner,
                    req.user_id,
                    req.limit,
                    req.cursor.map_filter(|_| f),
                ))
            }
            None => Either::Right(expanded::by_cursor::expanded_generic_cursor_soup(
                &self.inner,
                req.user_id,
                req.limit,
                req.cursor.map_filter(|_| ()),
            )),
        }
    }

    fn unexpanded_generic_cursor_soup<'a>(
        &self,
        req: SimpleSortRequest<'a>,
    ) -> impl Future<Output = Result<Vec<SoupItem>, Self::Err>> + Send {
        match req.cursor.filter() {
            Some(SimpleSortFilter::Ast(_ast) | SimpleSortFilter::FrecencyAst(_, _ast)) => todo!(),
            Some(SimpleSortFilter::Frecency(f)) => {
                let f = *f;
                Either::Left(expanded::by_cursor::no_frecency_expanded_generic_soup(
                    &self.inner,
                    req.user_id,
                    req.limit,
                    req.cursor.map_filter(|_| f),
                ))
            }
            None => Either::Right(unexpanded::by_cursor::unexpanded_generic_cursor_soup(
                &self.inner,
                req.user_id,
                req.limit,
                req.cursor.map_filter(|_| ()),
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
