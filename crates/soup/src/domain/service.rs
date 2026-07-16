use crate::domain::{
    models::{
        AdvancedSortParams, EnrichedSoupItem, FrecencyQueryInner, GetCrmCompaniesRequest,
        GroupedSortRequest, IntoSoupReqAst, SimpleQueryInner, SimpleSortQuery, SimpleSortRequest,
        SoupErr, SoupPropertiesField, SoupQuery, SoupRequest, SoupType, grouping::ItemGroupingInfo,
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
    models::{
        AggregateFrecency, AggregateId, FrecencyByIdsRequest, FrecencyPageRequest, JoinFrecency,
    },
    ports::FrecencyQueryService,
};
use item_filters::ast::EntityFilterAst;
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{
    Cursor, CursorVal, Frecency, FrecencyValue, Identify, PaginateOn, Paginated, Query,
    SimpleSortMethod, SortOn,
};
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
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

#[derive(Debug)]
struct SoupCandidate {
    item: SoupItem<()>,
    frecency_score: Option<AggregateFrecency>,
}

impl Identify for SoupCandidate {
    type Id = String;

    fn id(&self) -> Self::Id {
        self.item.entity().entity_id.to_string()
    }
}

impl SortOn<Frecency> for SoupCandidate {
    fn sort_on(sort_type: Frecency) -> impl FnMut(&Self) -> CursorVal<Frecency> {
        move |candidate| CursorVal {
            sort_type,
            last_val: match &candidate.frecency_score {
                Some(frecency) => FrecencyValue::FrecencyScore(frecency.data.frecency_score),
                None => FrecencyValue::UpdatedAt(candidate.item.updated_at()),
            },
        }
    }
}

impl SortOn<SimpleSortMethod> for SoupCandidate {
    fn sort_on(sort: SimpleSortMethod) -> impl FnMut(&Self) -> CursorVal<SimpleSortMethod> {
        let mut sort_item = SoupItem::sort_on(sort);
        move |candidate| sort_item(&candidate.item)
    }
}

fn foreign_entity_to_soup_item(entity: ForeignEntity) -> SoupItem<()> {
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
    ) -> Result<impl Iterator<Item = SoupCandidate>, SoupErr> {
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

        Ok(res.into_iter().map(|item| SoupCandidate {
            item,
            frecency_score: None,
        }))
    }

    #[tracing::instrument(err, skip(self, req))]
    async fn handle_grouped_soup_request(
        &self,
        req: GroupedSortRequest<'_>,
    ) -> Result<T::GroupedItems, SoupErr> {
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
    ) -> Result<Vec<SoupItem<()>>, T::Err> {
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
        frecency_items: impl ExactSizeIterator<Item = SoupCandidate>,
        limit: u16,
    ) -> Result<impl Iterator<Item = SoupCandidate>, SoupErr> {
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
    ) -> Result<impl Iterator<Item = SoupCandidate>, SoupErr> {
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
    ) -> Result<impl Iterator<Item = SoupCandidate>, SoupErr> {
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
            .map(|(soup_item, frecency)| SoupCandidate {
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
    ) -> Result<impl Iterator<Item = SoupCandidate>, SoupErr> {
        use frecency::domain::models::AggregateFrecency;

        let Some(req) = req else {
            return Ok(Either::Left(None.into_iter()));
        };

        let email_response = self.email_service.get_email_thread_previews(req).await?;

        let mut frecency_scores: Vec<Option<AggregateFrecency>> =
            Vec::with_capacity(email_response.items.len());
        let items: Vec<SoupItem<()>> = email_response
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
                        extra: (),
                    };
                    SoupItem::EmailThread(soup_email)
                },
            )
            .collect();

        Ok(Either::Right(items.into_iter().zip(frecency_scores).map(
            |(item, frecency_score)| SoupCandidate {
                item,
                frecency_score,
            },
        )))
    }

    #[tracing::instrument(err, skip(self, req))]
    async fn handle_comms_request(
        &self,
        req: Option<GetChannelsRequest>,
    ) -> Result<impl Iterator<Item = SoupCandidate>, SoupErr> {
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
                        SoupCandidate {
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
    ) -> Result<impl Iterator<Item = SoupCandidate>, SoupErr> {
        let Some(req) = req else {
            return Ok(Either::Left(None.into_iter()));
        };

        Ok(Either::Right(
            self.comms_service
                .get_thread_messages(req)
                .await
                .map_err(|_| SoupErr::CommsErr)?
                .into_iter()
                .map(|message| SoupCandidate {
                    item: SoupItem::ChannelThread(SoupChannelThread::new_from_channel_message(
                        message,
                    )),
                    frecency_score: None,
                }),
        ))
    }

    #[tracing::instrument(err, skip(self, req))]
    async fn handle_crm_company_request(
        &self,
        req: Option<GetCrmCompaniesRequest>,
    ) -> Result<impl Iterator<Item = SoupCandidate>, SoupErr> {
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

        let items: Vec<SoupItem<()>> = self
            .crm_service
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
            .map_err(|err| match err {
                crm::domain::model::CrmError::AdminRoleRequired => SoupErr::CrmAdminRequired,
                _ => SoupErr::CrmErr,
            })?
            .into_iter()
            .map(|company| SoupItem::CrmCompany(SoupCrmCompany::from(company)))
            .collect();

        Ok(Either::Right(items.into_iter().map(|item| SoupCandidate {
            item,
            frecency_score: None,
        })))
    }

    #[tracing::instrument(err, skip(self, req))]
    async fn handle_call_request(
        &self,
        req: Option<GetCallRecordsRequest>,
    ) -> Result<impl Iterator<Item = SoupCandidate>, SoupErr> {
        let Some(req) = req else {
            return Ok(Either::Left(None.into_iter()));
        };

        let user_id_str = req.user_id.as_ref().to_string();

        let items: Vec<SoupItem<()>> = self
            .call_record_service
            .get_user_call_records(req)
            .await
            .map_err(|_| SoupErr::CallErr)?
            .into_iter()
            .map(|record| {
                SoupItem::Call(SoupCallRecord::from_record_for_user(record, &user_id_str))
            })
            .collect();

        Ok(Either::Right(items.into_iter().map(|item| SoupCandidate {
            item,
            frecency_score: None,
        })))
    }

    #[tracing::instrument(err, skip(self, source_ids, query))]
    async fn handle_foreign_entity_request(
        &self,
        requesting_user: Option<String>,
        source_ids: Vec<SourceId>,
        limit: u32,
        query: Option<ForeignEntityListQuery>,
    ) -> Result<impl Iterator<Item = SoupCandidate>, SoupErr> {
        let Some(query) = query else {
            return Ok(Either::Left(None.into_iter()));
        };

        Ok(Either::Right(
            self.foreign_entity_service
                .get_foreign_entities_for_user(requesting_user, source_ids, limit, query)
                .await?
                .into_iter()
                .map(|entity| SoupCandidate {
                    item: foreign_entity_to_soup_item(entity),
                    frecency_score: None,
                }),
        ))
    }

    async fn populate_properties_items(
        &self,
        user_id: MacroUserIdStr<'_>,
        items: Vec<SoupCandidate>,
    ) -> Result<Vec<EnrichedSoupItem>, SoupErr> {
        if items.is_empty() {
            return Ok(Vec::new());
        }

        let (items, frecency_scores): (Vec<_>, Vec<_>) = items
            .into_iter()
            .map(|item| (item.item, item.frecency_score))
            .unzip();
        let items = self
            .soup_storage
            .populate_properties(user_id, items)
            .await
            .map_err(anyhow::Error::from)?;
        if items.len() != frecency_scores.len() {
            return Err(SoupErr::SoupDbErr(anyhow::anyhow!(
                "property hydration changed the number of Soup items"
            )));
        }

        Ok(items
            .into_iter()
            .zip(frecency_scores)
            .map(|(item, frecency_score)| EnrichedSoupItem {
                item,
                frecency_score,
            })
            .collect())
    }

    async fn populate_properties_page<Cursor>(
        &self,
        user_id: MacroUserIdStr<'_>,
        page: Paginated<SoupCandidate, Cursor>,
    ) -> Result<Paginated<EnrichedSoupItem, Cursor>, SoupErr> {
        let (items, next_cursor) = page.into_parts();
        let items = self.populate_properties_items(user_id, items).await?;
        Ok(Paginated::from_parts(items, next_cursor))
    }

    async fn populate_properties_output<R>(
        &self,
        user_id: MacroUserIdStr<'_>,
        output: SoupOutput<R, SoupCandidate>,
    ) -> Result<SoupOutput<R, EnrichedSoupItem>, SoupErr> {
        match output {
            Either::Left(page) => Ok(Either::Left(
                self.populate_properties_page(user_id, page).await?,
            )),
            Either::Right(page) => Ok(Either::Right(
                self.populate_properties_page(user_id, page).await?,
            )),
        }
    }

    async fn populate_frecency_page<Cursor>(
        &self,
        user_id: MacroUserIdStr<'_>,
        mut page: Paginated<SoupCandidate, Cursor>,
    ) -> Result<Paginated<SoupCandidate, Cursor>, SoupErr> {
        if page.items.is_empty() {
            return Ok(page);
        }

        let entities: Vec<_> = page.items.iter().map(|item| item.item.entity()).collect();
        let mut frecency = self
            .frecency
            .get_frecencies_by_ids(FrecencyByIdsRequest {
                user_id: user_id.clone(),
                ids: &entities,
            })
            .await?
            .into_inner();

        for item in &mut page.items {
            let id = AggregateId {
                user_id: user_id.clone().into_owned(),
                entity: item.item.entity(),
            };
            item.frecency_score = frecency.remove(&id).map(|data| id.into_aggregate(data));
        }

        Ok(page)
    }

    async fn populate_frecency_output<R>(
        &self,
        user_id: MacroUserIdStr<'_>,
        output: SoupOutput<R, SoupCandidate>,
    ) -> Result<SoupOutput<R, SoupCandidate>, SoupErr> {
        match output {
            // Simple sorting does not need frecency to construct the page, so
            // load it once for only the final page.
            Either::Left(page) => Ok(Either::Left(
                self.populate_frecency_page(user_id, page).await?,
            )),
            // Frecency sorting already loaded the scores needed for ordering
            // and cursor construction. Reuse them rather than issuing a
            // duplicate by-id lookup.
            Either::Right(page) => Ok(Either::Right(page)),
        }
    }

    fn into_raw_output<R>(output: SoupOutput<R, SoupCandidate>) -> SoupOutput<R> {
        let into_raw = |candidate: SoupCandidate| candidate.item;
        match output {
            Either::Left(page) => Either::Left(page.map(into_raw)),
            Either::Right(page) => Either::Right(page.map(into_raw)),
        }
    }

    fn into_enriched_output<R>(
        output: SoupOutput<R, SoupCandidate>,
    ) -> SoupOutput<R, EnrichedSoupItem> {
        let into_enriched = |candidate: SoupCandidate| EnrichedSoupItem {
            item: candidate
                .item
                .map_extra(|()| SoupPropertiesField::default()),
            frecency_score: candidate.frecency_score,
        };
        match output {
            Either::Left(page) => Either::Left(page.map(into_enriched)),
            Either::Right(page) => Either::Right(page.map(into_enriched)),
        }
    }

    fn clear_frecency<R>(
        output: SoupOutput<R, EnrichedSoupItem>,
    ) -> SoupOutput<R, EnrichedSoupItem> {
        let clear = |mut item: EnrichedSoupItem| {
            item.frecency_score = None;
            item
        };
        match output {
            Either::Left(page) => Either::Left(page.map(clear)),
            Either::Right(page) => Either::Right(page.map(clear)),
        }
    }

    async fn populate_grouped_items(
        &self,
        user_id: MacroUserIdStr<'_>,
        items: impl Iterator<Item = ItemGroupingInfo> + Send,
    ) -> Result<impl Iterator<Item = ItemGroupingInfo<SoupPropertiesField>>, SoupErr> {
        let (items, metadata): (Vec<_>, Vec<_>) = items
            .map(|item| {
                (
                    item.item,
                    (item.key, item.total_group_count, item.index_in_group),
                )
            })
            .unzip();

        if items.is_empty() {
            return Ok(Vec::new().into_iter());
        }

        let items = self
            .soup_storage
            .populate_properties(user_id, items)
            .await
            .map_err(anyhow::Error::from)?;
        if items.len() != metadata.len() {
            return Err(SoupErr::SoupDbErr(anyhow::anyhow!(
                "property hydration changed the number of grouped Soup items"
            )));
        }

        Ok(items
            .into_iter()
            .zip(metadata)
            .map(
                |(item, (key, total_group_count, index_in_group))| ItemGroupingInfo {
                    item,
                    key,
                    total_group_count,
                    index_in_group,
                },
            )
            .collect::<Vec<_>>()
            .into_iter())
    }

    async fn get_user_soup_internal<R>(
        &self,
        req: SoupRequest<R>,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<SoupOutput<R, SoupCandidate>, SoupErr>
    where
        SoupRequest<R>: IntoSoupReqAst,
        R: Clone + Serialize + Send,
    {
        let entity_filter = req.filters().clone();
        let req = req.into_ast()?;
        let limit = req.limit.clamp(20, 500);

        // CRM-scoped visibility (team-wide email scope or hidden CRM
        // companies) requires a team receipt. Without this check the CRM
        // sub-request would silently skip for no-team callers, disguising
        // "no access" as "no data". The admin/owner role gate for hidden
        // companies lives one layer down in the CRM service, derived from
        // the receipt itself.
        if let Some(ast) = req.entity_ast()
            && (ast.requests_crm_scope() || ast.requests_crm_admin())
            && team_receipt.is_none()
        {
            return Err(SoupErr::CrmTeamRequired);
        }

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
        let output = self.get_user_soup_internal(req, team_receipt).await?;
        Ok(Self::into_raw_output(output))
    }

    #[tracing::instrument(err, skip(self, req, team_receipt))]
    async fn get_user_soup_with_frecency<R>(
        &self,
        req: SoupRequest<R>,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<SoupOutput<R, EnrichedSoupItem>, SoupErr>
    where
        SoupRequest<R>: IntoSoupReqAst,
        R: Clone + Serialize + Send,
    {
        let user_id = req.user.clone();
        let output = self.get_user_soup_internal(req, team_receipt).await?;
        let output = self.populate_frecency_output(user_id, output).await?;
        Ok(Self::into_enriched_output(output))
    }

    #[tracing::instrument(err, skip(self, req, team_receipt))]
    async fn get_user_soup_with_properties<R>(
        &self,
        req: SoupRequest<R>,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<SoupOutput<R, EnrichedSoupItem>, SoupErr>
    where
        SoupRequest<R>: IntoSoupReqAst,
        R: Clone + Serialize + Send,
    {
        let user_id = req.user.clone();
        let output = self.get_user_soup_internal(req, team_receipt).await?;
        let output = self.populate_properties_output(user_id, output).await?;
        Ok(Self::clear_frecency(output))
    }

    #[tracing::instrument(err, skip(self, req, team_receipt))]
    async fn get_user_soup_with_properties_and_frecency<R>(
        &self,
        req: SoupRequest<R>,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<SoupOutput<R, EnrichedSoupItem>, SoupErr>
    where
        SoupRequest<R>: IntoSoupReqAst,
        R: Clone + Serialize + Send,
    {
        let user_id = req.user.clone();
        let output = self.get_user_soup_internal(req, team_receipt).await?;
        let output = self
            .populate_frecency_output(user_id.clone(), output)
            .await?;
        self.populate_properties_output(user_id, output).await
    }

    #[tracing::instrument(err, skip(self, req))]
    async fn get_user_soup_grouped(
        &self,
        req: GroupedSortRequest<'_>,
    ) -> Result<impl Iterator<Item = ItemGroupingInfo<SoupPropertiesField>> + Send, SoupErr> {
        let user_id = req.user_id.clone();
        let items = self.handle_grouped_soup_request(req).await?;
        self.populate_grouped_items(user_id, items).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn caller_tag_sets<'a>(
        &self,
        user_id: MacroUserIdStr<'a>,
    ) -> Result<Vec<PropertyDefinitionWithOptions>, SoupErr> {
        Ok(self
            .soup_storage
            .caller_tag_sets(user_id)
            .await
            .map_err(anyhow::Error::from)?)
    }
}
