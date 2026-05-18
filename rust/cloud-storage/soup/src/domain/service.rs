use crate::domain::{
    models::{
        AdvancedSortParams, FrecencyQueryInner, FrecencySoupItem, GroupedSortRequest,
        GroupedSoupItem, IntoSoupReqAst, SimpleQueryInner, SimpleSortQuery, SimpleSortRequest,
        SoupErr, SoupQuery, SoupRequest, SoupType,
    },
    ports::{SoupOutput, SoupRepo, SoupService},
};
use call::domain::{models::GetCallRecordsRequest, ports::CallRecordQueryService};
use comms::domain::{models::GetChannelsRequest, ports::ChannelsService};
use cowlike::CowLike;
use doppleganger::Mirror;
use either::Either;
use email::domain::{
    models::{EnrichedEmailThreadPreview, GetEmailsRequest},
    ports::EmailPreviewServiceReadOnly,
};
use frecency::domain::{
    models::{AggregateId, FrecencyPageRequest, JoinFrecency},
    ports::FrecencyQueryService,
};
use item_filters::ast::EntityFilterAst;
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{
    Cursor, CursorVal, Frecency, FrecencyValue, PaginateOn, Query, SimpleSortMethod, SortOn,
};
use models_soup::{
    call_record::SoupCallRecord,
    comms::SoupChannel,
    email_thread::{
        SoupAttachment, SoupContact, SoupEmailThreadPreview, SoupEnrichedEmailThreadPreview,
        SoupLabel,
    },
    item::SoupItem,
};
use serde::Serialize;
use std::cmp::Ordering;
use uuid::Uuid;

#[cfg(test)]
mod tests;

/// struct which handles the actual implementation of soup with abstracted interfaces for mocking
pub struct SoupImpl<T, U, V, C, K> {
    /// the interface for interacting with the db
    soup_storage: T,
    /// the interface for interacting with frecency
    frecency: U,
    /// the interface for interacting with email
    email_service: V,
    /// the interface for interacting with comms
    comms_service: C,
    /// the interface for interacting with call records
    call_record_service: K,
}

impl<T, U, V, C, K> SoupImpl<T, U, V, C, K>
where
    T: SoupRepo,
    anyhow::Error: From<T::Err>,
    U: FrecencyQueryService,
    V: EmailPreviewServiceReadOnly,
    C: ChannelsService,
    K: CallRecordQueryService,
{
    pub fn new(
        soup_storage: T,
        frecency: U,
        email_service: V,
        comms_service: C,
        call_record_service: K,
    ) -> Self {
        SoupImpl {
            soup_storage,
            frecency,
            email_service,
            comms_service,
            call_record_service,
        }
    }

    #[tracing::instrument(err, skip(self, req))]
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

    #[tracing::instrument(err, skip(self, req))]
    async fn handle_grouped_soup_request(
        &self,
        req: GroupedSortRequest<'_>,
    ) -> Result<Vec<GroupedSoupItem>, SoupErr> {
        self.soup_storage
            .expanded_grouped_cursor_soup(req)
            .await
            .map_err(anyhow::Error::from)
            .map_err(SoupErr::SoupDbErr)
    }

    #[tracing::instrument(skip(self, req))]
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
    #[tracing::instrument(err, skip(self, frecency_items))]
    async fn fallback_soup_data(
        &self,
        soup_type: SoupType,
        user: MacroUserIdStr<'_>,
        frecency_items: impl ExactSizeIterator<Item = FrecencySoupItem>,
        limit: u16,
    ) -> Result<impl Iterator<Item = FrecencySoupItem>, SoupErr> {
        let len = frecency_items.len();
        let remainder_to_fetch = (limit as usize).saturating_sub(len);

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

    #[tracing::instrument(err, skip(self, cursor))]
    async fn handle_advanced_sort(
        &self,
        cursor: Query<Uuid, Frecency, Option<EntityFilterAst>>,
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

    #[tracing::instrument(err, skip(self, from_value))]
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

        let entities: Vec<_> = res.ids().map(|f| f.entity.copied()).collect();

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

    #[tracing::instrument(err, skip(self, req))]
    async fn handle_email_request(
        &self,
        req: Option<GetEmailsRequest>,
    ) -> Result<impl Iterator<Item = FrecencySoupItem>, SoupErr> {
        use frecency::domain::models::AggregateFrecency;

        let Some(req) = req else {
            return Ok(Either::Left(None.into_iter()));
        };

        let email_response = self.email_service.get_email_thread_previews(req).await?;

        let mut frecency_scores: Vec<Option<AggregateFrecency>> =
            Vec::with_capacity(email_response.items.len());
        let mut items: Vec<SoupItem> = email_response
            .items
            .into_iter()
            .map(
                |EnrichedEmailThreadPreview {
                     thread,
                     attachments,
                     labels,
                     mut frecency_score,
                     participants,
                     ..
                 }| {
                    frecency_scores.push(frecency_score.take());
                    let soup_email = SoupEnrichedEmailThreadPreview {
                        thread: SoupEmailThreadPreview::mirror(thread),
                        attachments: Vec::<SoupAttachment>::mirror(attachments),
                        participants: Vec::<SoupContact>::mirror(participants),
                        labels: Vec::<SoupLabel>::mirror(labels),
                        properties: Default::default(),
                    };
                    SoupItem::EmailThread(soup_email)
                },
            )
            .collect();

        self.soup_storage
            .populate_properties(&mut items)
            .await
            .map_err(anyhow::Error::from)?;

        let emails_with_props: Vec<FrecencySoupItem> = items
            .into_iter()
            .zip(frecency_scores)
            .map(|(item, frecency_score)| FrecencySoupItem {
                item,
                frecency_score,
            })
            .collect();

        Ok(Either::Right(emails_with_props.into_iter()))
    }

    #[tracing::instrument(err, skip(self, req))]
    async fn handle_comms_request(
        &self,
        req: Option<GetChannelsRequest>,
    ) -> Result<impl Iterator<Item = FrecencySoupItem>, SoupErr> {
        let Some(req) = req else {
            return Ok(Either::Left(None.into_iter()));
        };

        Ok(Either::Right(
            self.comms_service
                .get_channels(req)
                .await
                .map_err(|_| SoupErr::CommsErr)
                .map(|r| {
                    r.into_iter().map(|mut c| {
                        let frecency_score = c.frecency_score.take();
                        let soup_channel = SoupChannel::mirror(c);
                        FrecencySoupItem {
                            item: SoupItem::Channel(soup_channel),
                            frecency_score,
                        }
                    })
                })?,
        ))
    }

    #[tracing::instrument(err, skip(self, req))]
    async fn handle_call_request(
        &self,
        req: Option<GetCallRecordsRequest>,
    ) -> Result<impl Iterator<Item = FrecencySoupItem>, SoupErr> {
        let Some(req) = req else {
            return Ok(Either::Left(None.into_iter()));
        };

        let user_id = req.user_id.as_ref().to_string();

        Ok(Either::Right(
            self.call_record_service
                .get_user_call_records(req)
                .await
                .map_err(|_| SoupErr::CallErr)
                .map(|records| {
                    records.into_iter().map(move |record| {
                        let soup_record = SoupCallRecord::from_record_for_user(record, &user_id);
                        FrecencySoupItem {
                            item: SoupItem::Call(soup_record),
                            frecency_score: None,
                        }
                    })
                })?,
        ))
    }
}

impl<T, U, V, C, K> SoupService for SoupImpl<T, U, V, C, K>
where
    T: SoupRepo,
    anyhow::Error: From<T::Err>,
    U: FrecencyQueryService,
    V: EmailPreviewServiceReadOnly,
    C: ChannelsService,
    K: CallRecordQueryService,
{
    #[tracing::instrument(err, skip(self, req))]
    async fn get_user_soup<R>(&self, req: SoupRequest<R>) -> Result<SoupOutput<R>, SoupErr>
    where
        SoupRequest<R>: IntoSoupReqAst,
        R: Clone + Serialize + Send,
    {
        let entity_filter = req.filters().clone();
        let req = req.into_ast()?;
        let limit = req.limit.clamp(20, 500);

        let email_request = req.build_email_request();
        let comms_request = req.build_comms_request();
        let call_request = req.build_call_request();

        match req.cursor {
            SoupQuery::Simple(SimpleQueryInner(cursor)) => {
                let sort_method = *cursor.sort_method();

                let main_soup_fut = self.handle_simple_request(
                    req.soup_type,
                    SimpleSortRequest {
                        limit,
                        cursor: SimpleSortQuery::from_entity_cursor(cursor),
                        user_id: req.user.copied(),
                    },
                );

                let email_soup_fut = self.handle_email_request(email_request);

                let comms_soup_fut = self.handle_comms_request(comms_request);

                let call_soup_fut = self.handle_call_request(call_request);

                let (main_soup, email_soup, comms_soup, call_soup) =
                    tokio::join!(main_soup_fut, email_soup_fut, comms_soup_fut, call_soup_fut);

                let page = main_soup?
                    .chain(email_soup?)
                    .chain(comms_soup?)
                    .chain(call_soup?)
                    .paginate_on(limit.into(), sort_method)
                    .filter_on(entity_filter.clone())
                    .sort_desc()
                    .into_page();

                // Email queries use CROSS JOIN LATERAL which can filter out
                // threads after the initial LIMIT, making the standard
                // "len < limit means last page" heuristic unreliable.
                // Force a cursor when emails are in the response.
                let has_emails = page
                    .items
                    .iter()
                    .any(|item| matches!(&item.item, SoupItem::EmailThread(_)));
                let page = if has_emails {
                    page.ensure_cursor(
                        limit.into(),
                        FrecencySoupItem::sort_on(sort_method),
                        entity_filter,
                    )
                } else {
                    page
                };

                Ok(Either::Left(page))
            }
            SoupQuery::Frecency(FrecencyQueryInner(cursor)) => Ok(Either::Right(
                self.handle_advanced_sort(cursor, req.soup_type, req.user, limit)
                    .await?
                    .paginate_on(limit.into(), Frecency)
                    .filter_on(entity_filter)
                    .into_page(),
            )),
        }
    }

    #[tracing::instrument(err, skip(self, req))]
    async fn get_user_soup_grouped(
        &self,
        req: GroupedSortRequest<'_>,
    ) -> Result<Vec<GroupedSoupItem>, SoupErr> {
        self.handle_grouped_soup_request(req).await
    }
}
