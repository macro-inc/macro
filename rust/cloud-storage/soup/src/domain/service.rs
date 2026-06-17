use crate::domain::{
    models::{
        AdvancedSortParams, FrecencyQueryInner, FrecencySoupItem, GetCrmCompaniesRequest,
        GroupedSortRequest, GroupedSoupItem, IntoSoupReqAst, SimpleQueryInner, SimpleSortQuery,
        SimpleSortRequest, SoupErr, SoupQuery, SoupRequest, SoupType,
    },
    ports::{SoupOutput, SoupRepo, SoupService},
};
use call::domain::{models::GetCallRecordsRequest, ports::CallRecordQueryService};
use channels::domain::{
    models::{GetChannelsRequest, GetThreadReplyRowsRequest},
    ports::ChannelListService,
};
use cowlike::CowLike;
use crm::domain::service::CrmService;
use doppleganger::Mirror;
use either::Either;
use email::domain::{
    models::{EnrichedEmailThreadPreview, GetEmailsRequest},
    ports::EmailPreviewServiceReadOnly,
};
use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole};
use foreign_entity::domain::{
    models::{ForeignEntity, SourceId},
    ports::{ForeignEntityListQuery, ForeignEntityService},
};
use frecency::domain::{
    models::{AggregateId, FrecencyPageRequest, JoinFrecency},
    ports::FrecencyQueryService,
};
use item_filters::ast::EntityFilterAst;
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{
    Cursor, CursorVal, Frecency, FrecencyValue, PaginateOn, Query, SimpleSortMethod,
};
use models_soup::{
    call_record::SoupCallRecord,
    comms::{SoupChannel, SoupChannelThread},
    crm_company::SoupCrmCompany,
    email_thread::{
        SoupAttachment, SoupContact, SoupEmailThreadPreview, SoupEnrichedEmailThreadPreview,
        SoupLabel,
    },
    foreign_entity::SoupForeignEntity,
    item::SoupItem,
};
use serde::Serialize;
use std::cmp::Ordering;
use uuid::Uuid;

#[cfg(test)]
mod tests;

fn foreign_entity_to_soup_item(entity: ForeignEntity) -> SoupItem {
    SoupItem::ForeignEntity(SoupForeignEntity {
        id: entity.id,
        foreign_entity_id: entity.foreign_entity_id,
        foreign_entity_source: entity.foreign_entity_source,
        metadata: entity.metadata,
        stored_for_id: entity.stored_for_id,
        stored_for_auth_entity: entity.stored_for_auth_entity,
        created_at: entity.created_at,
        updated_at: entity.updated_at,
    })
}

/// struct which handles the actual implementation of soup with abstracted interfaces for mocking
pub struct SoupImpl<T, U, V, C, K, Crm, F> {
    /// the interface for interacting with the db
    soup_storage: T,
    /// the interface for interacting with frecency
    frecency: U,
    /// the interface for interacting with email
    email_service: V,
    /// the interface for interacting with channels
    comms_service: C,
    /// the interface for interacting with call records
    call_record_service: K,
    /// the interface for interacting with CRM (companies)
    crm_service: Crm,
    /// the interface for interacting with foreign entities
    foreign_entity_service: F,
}

impl<T, U, V, C, K, Crm, F> SoupImpl<T, U, V, C, K, Crm, F>
where
    T: SoupRepo,
    anyhow::Error: From<T::Err>,
    U: FrecencyQueryService,
    V: EmailPreviewServiceReadOnly,
    C: ChannelListService,
    K: CallRecordQueryService,
    Crm: CrmService,
    F: ForeignEntityService,
{
    /// Creates a soup service from its repository and dependent domain services.
    pub fn new(
        soup_storage: T,
        frecency: U,
        email_service: V,
        comms_service: C,
        call_record_service: K,
        crm_service: Crm,
        foreign_entity_service: F,
    ) -> Self {
        SoupImpl {
            soup_storage,
            frecency,
            email_service,
            comms_service,
            call_record_service,
            crm_service,
            foreign_entity_service,
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
                        let soup_channel = SoupChannel::new_from_channels(c);
                        FrecencySoupItem {
                            item: SoupItem::Channel(soup_channel),
                            frecency_score,
                        }
                    })
                })?,
        ))
    }

    #[tracing::instrument(err, skip(self, req))]
    async fn handle_comms_thread_request(
        &self,
        req: Option<GetThreadReplyRowsRequest>,
    ) -> Result<impl Iterator<Item = FrecencySoupItem>, SoupErr> {
        let Some(req) = req else {
            return Ok(Either::Left(None.into_iter()));
        };

        Ok(Either::Right(
            self.comms_service
                .get_thread_reply_rows(req)
                .await
                .map_err(|_| SoupErr::CommsErr)?
                .into_iter()
                .map(|rows| FrecencySoupItem {
                    item: SoupItem::ChannelThread(SoupChannelThread::new_from_thread_reply_rows(
                        rows,
                    )),
                    frecency_score: None,
                }),
        ))
    }

    #[tracing::instrument(err, skip(self, req))]
    async fn handle_crm_company_request(
        &self,
        req: Option<GetCrmCompaniesRequest>,
    ) -> Result<impl Iterator<Item = FrecencySoupItem>, SoupErr> {
        let Some(req) = req else {
            return Ok(Either::Left(None.into_iter()));
        };

        let GetCrmCompaniesRequest {
            access,
            user_id,
            company_ids,
            hidden,
            sort,
            cursor,
            limit,
        } = req;

        Ok(Either::Right(
            self.crm_service
                .list_companies_for_soup(
                    &access,
                    user_id.as_ref(),
                    &company_ids,
                    hidden,
                    sort,
                    cursor,
                    limit,
                )
                .await
                .map_err(|_| SoupErr::CrmErr)?
                .into_iter()
                .map(|company| FrecencySoupItem {
                    item: SoupItem::CrmCompany(SoupCrmCompany::from(company)),
                    frecency_score: None,
                }),
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

    #[tracing::instrument(err, skip(self, source_ids, query))]
    async fn handle_foreign_entity_request(
        &self,
        requesting_user: Option<String>,
        source_ids: Vec<SourceId>,
        limit: u32,
        query: Option<ForeignEntityListQuery>,
    ) -> Result<impl Iterator<Item = FrecencySoupItem>, SoupErr> {
        let Some(query) = query else {
            return Ok(Either::Left(None.into_iter()));
        };

        Ok(Either::Right(
            self.foreign_entity_service
                .get_foreign_entities_for_user(requesting_user, source_ids, limit, query)
                .await?
                .into_iter()
                .map(|entity| FrecencySoupItem {
                    item: foreign_entity_to_soup_item(entity),
                    frecency_score: None,
                }),
        ))
    }
}

impl<T, U, V, C, K, Crm, F> SoupService for SoupImpl<T, U, V, C, K, Crm, F>
where
    T: SoupRepo,
    anyhow::Error: From<T::Err>,
    U: FrecencyQueryService,
    V: EmailPreviewServiceReadOnly,
    C: ChannelListService,
    K: CallRecordQueryService,
    Crm: CrmService,
    F: ForeignEntityService,
{
    #[tracing::instrument(err, skip(self, req, team_receipt))]
    async fn get_user_soup<R>(
        &self,
        req: SoupRequest<R>,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<SoupOutput<R>, SoupErr>
    where
        SoupRequest<R>: IntoSoupReqAst,
        R: Clone + Serialize + Send,
    {
        let entity_filter = req.filters().clone();
        let req = req.into_ast()?;
        let limit = req.limit.clamp(20, 500);

        // Borrow before email's builder consumes team_receipt.
        let crm_company_request = req.build_crm_company_request(&team_receipt);
        let foreign_entity_source_ids = req.build_foreign_entity_source_ids(team_receipt.as_ref());
        let foreign_entity_query = req.build_foreign_entity_query();
        let email_request = req.build_email_request(team_receipt);
        let comms_request = req.build_comms_request();
        let comms_thread_request = req.build_comms_thread_request();
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

                let comms_thread_soup_fut = self.handle_comms_thread_request(comms_thread_request);

                let call_soup_fut = self.handle_call_request(call_request);

                let crm_company_soup_fut = self.handle_crm_company_request(crm_company_request);

                let foreign_entity_soup_fut = self.handle_foreign_entity_request(
                    Some(req.user.to_string()),
                    foreign_entity_source_ids,
                    limit as u32,
                    foreign_entity_query,
                );

                let (
                    main_soup,
                    email_soup,
                    comms_soup,
                    comms_thread_soup,
                    call_soup,
                    crm_company_soup,
                    foreign_entity_soup,
                ) = tokio::join!(
                    main_soup_fut,
                    email_soup_fut,
                    comms_soup_fut,
                    comms_thread_soup_fut,
                    call_soup_fut,
                    crm_company_soup_fut,
                    foreign_entity_soup_fut,
                );

                let page = main_soup?
                    .chain(email_soup?)
                    .chain(comms_soup?)
                    .chain(comms_thread_soup?)
                    .chain(call_soup?)
                    .chain(crm_company_soup?)
                    .chain(foreign_entity_soup?)
                    .paginate_on(limit.into(), sort_method)
                    .filter_on(entity_filter)
                    .sort_desc()
                    .into_page();

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
