use crate::domain::{
    models::{
        AdvancedSortParams, FrecencySoupItem, SimpleSortQuery, SimpleSortRequest, SoupErr,
        SoupQuery, SoupRequest, SoupType,
    },
    ports::{SoupOutput, SoupRepo, SoupService},
};
use either::Either;
use frecency::domain::{
    models::{AggregateId, FrecencyPageRequest, JoinFrecency},
    ports::FrecencyQueryService,
};
use item_filters::ast::EntityFilterAst;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_entity::as_owned::ShallowClone;
use models_pagination::{
    Cursor, CursorVal, Frecency, FrecencyValue, PaginateOn, Query, SimpleSortMethod,
};
use models_soup::item::SoupItem;
use std::cmp::Ordering;

#[cfg(test)]
mod tests;

/// struct which handles the actual implementation of soup with abstracted interfaces for mocking
pub struct SoupImpl<T, U> {
    /// the interface for interacting with the db
    soup_storage: T,
    /// the interface for interacting with frecency
    frecency: U,
}

impl<T, U> SoupImpl<T, U>
where
    T: SoupRepo,
    anyhow::Error: From<T::Err>,
    U: FrecencyQueryService,
{
    pub fn new(soup_storage: T, frecency: U) -> Self {
        SoupImpl {
            soup_storage,
            frecency,
        }
    }

    async fn handle_simple_request(
        &self,
        soup_type: SoupType,
        req: SimpleSortRequest<'_>,
    ) -> Result<impl Iterator<Item = FrecencySoupItem>, SoupErr> {
        let res = match soup_type {
            SoupType::Expanded => self
                .soup_storage
                .expanded_generic_cursor_soup(req)
                .await
                .map_err(anyhow::Error::from)?,
            SoupType::UnExpanded => self
                .soup_storage
                .unexpanded_generic_cursor_soup(req)
                .await
                .map_err(anyhow::Error::from)?,
        };
        Ok(res.into_iter().map(|item| FrecencySoupItem {
            item,
            frecency_score: None,
        }))
    }

    async fn handle_soup_by_ids(
        &self,
        soup_type: SoupType,
        req: AdvancedSortParams<'_>,
    ) -> Result<Vec<SoupItem>, T::Err> {
        match soup_type {
            SoupType::Expanded => self.soup_storage.expanded_soup_by_ids(req).await,
            SoupType::UnExpanded => self.soup_storage.unexpanded_soup_by_ids(req).await,
        }
    }

    /// enriches a frecency response with further soup data if the initial results length was not long enough
    async fn fallback_soup_data(
        &self,
        soup_type: SoupType,
        user: MacroUserIdStr<'_>,
        frecency_items: impl ExactSizeIterator<Item = FrecencySoupItem>,
        limit: u16,
    ) -> Result<impl Iterator<Item = FrecencySoupItem>, SoupErr> {
        let len = frecency_items.len();
        let remainder_to_fetch = (limit as usize).saturating_sub(len);
        dbg!(remainder_to_fetch, len);

        let updated_at_soup = self
            .handle_simple_request(
                soup_type,
                SimpleSortRequest {
                    limit: remainder_to_fetch.try_into().unwrap_or(500),
                    cursor: SimpleSortQuery::FilterFrecency(Query::Sort(
                        SimpleSortMethod::UpdatedAt,
                        Frecency,
                    )),
                    user_id: user,
                },
            )
            .await?;
        Ok(frecency_items.chain(updated_at_soup))
    }

    async fn handle_advanced_sort(
        &self,
        cursor: Query<String, Frecency, Option<EntityFilterAst>>,
        soup_type: SoupType,
        user: MacroUserIdStr<'static>,
        limit: u16,
    ) -> Result<impl Iterator<Item = FrecencySoupItem>, SoupErr> {
        let from_score = match cursor {
            Query::Sort(_, _) => None,
            Query::Cursor(Cursor {
                val:
                    CursorVal {
                        sort_type: Frecency,
                        last_val: FrecencyValue::FrecencyScore(score),
                    },
                filter,
                ..
            }) => Some((score, filter)),
            // we have passed all the frecency values on this cursor so we pull from updated at
            Query::Cursor(Cursor {
                id,
                limit: cursor_limit,
                val:
                    CursorVal {
                        sort_type: Frecency,
                        last_val: FrecencyValue::UpdatedAt(updated),
                    },
                filter,
            }) => {
                return Ok(Either::Left(
                    self.handle_simple_request(
                        soup_type,
                        SimpleSortRequest {
                            limit,
                            cursor: match filter {
                                // the input has no ast filter, just filter out items with frecency score and sort by update at
                                None => SimpleSortQuery::FilterFrecency(Query::Cursor(Cursor {
                                    id,
                                    limit: cursor_limit,
                                    val: CursorVal {
                                        sort_type: SimpleSortMethod::UpdatedAt,
                                        last_val: updated,
                                    },
                                    filter: Frecency,
                                })),
                                // the input has an ast filter, we need to filter out items that have a frecency score and also items that don't match the filter
                                Some(ast) => {
                                    SimpleSortQuery::ItemsAndFrecencyFilter(Query::Cursor(Cursor {
                                        id,
                                        limit: cursor_limit,
                                        val: CursorVal {
                                            sort_type: SimpleSortMethod::UpdatedAt,
                                            last_val: updated,
                                        },
                                        filter: (Frecency, ast),
                                    }))
                                }
                            },
                            user_id: user,
                        },
                    )
                    .await?,
                ));
            }
        };

        Ok(Either::Right(
            self.handle_frecency_cursor(from_score, soup_type, user, limit)
                .await?,
        ))
    }

    async fn handle_frecency_cursor(
        &self,
        from_value: Option<(f64, Option<EntityFilterAst>)>,
        soup_type: SoupType,
        user: MacroUserIdStr<'static>,
        limit: u16,
    ) -> Result<impl Iterator<Item = FrecencySoupItem>, SoupErr> {
        let (from_score, filters) = match from_value {
            None => (None, None),
            Some((s, f)) => (Some(s), f),
        };

        let res = self
            .frecency
            .get_frecency_page(FrecencyPageRequest {
                user_id: user.copied(),
                from_score,
                limit: limit as u32,
                filters,
            })
            .await?;

        let entities: Vec<_> = res.ids().map(|f| f.entity.shallow_clone()).collect();

        let res = self
            .handle_soup_by_ids(
                soup_type,
                AdvancedSortParams {
                    entities: &entities,
                    user_id: user.copied(),
                },
            )
            .await
            .map_err(anyhow::Error::from)?
            .into_iter()
            .join_frecency(res, |id| AggregateId {
                entity: id.entity(),
                user_id: user.copied().into_owned(),
            })
            .into_iter()
            .map(|(soup_item, frecency)| FrecencySoupItem {
                item: soup_item,
                frecency_score: Some(frecency),
            });

        Ok(match res.len().cmp(&(limit as usize)) {
            // use either to avoid boxing for dynamic dispatch
            Ordering::Less => {
                Either::Left(self.fallback_soup_data(soup_type, user, res, limit).await?)
            }
            Ordering::Greater | Ordering::Equal => Either::Right(res),
        })
    }
}

impl<T, U> SoupService for SoupImpl<T, U>
where
    T: SoupRepo,
    anyhow::Error: From<T::Err>,
    U: FrecencyQueryService,
{
    async fn get_user_soup(&self, req: SoupRequest) -> Result<SoupOutput, SoupErr> {
        let limit = req.limit.clamp(20, 500);
        let paginate_filter = req.cursor.filter().cloned();
        match req.cursor {
            SoupQuery::Simple(cursor) => {
                let sort_method = *cursor.sort_method();

                Ok(Either::Left(
                    self.handle_simple_request(
                        req.soup_type,
                        SimpleSortRequest {
                            limit,
                            cursor: SimpleSortQuery::from_entity_cursor(cursor),
                            user_id: req.user,
                        },
                    )
                    .await?
                    .paginate_on(limit.into(), sort_method)
                    .filter_on(paginate_filter)
                    .into_page(),
                ))
            }
            SoupQuery::Frecency(cursor) => Ok(Either::Right(
                self.handle_advanced_sort(cursor, req.soup_type, req.user, limit)
                    .await?
                    .paginate_on(limit.into(), Frecency)
                    .filter_on(paginate_filter)
                    .into_page(),
            )),
        }
    }
}
