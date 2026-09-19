use crate::domain::{
    models::{
        AdvancedSortParams, EnrichedSoupItem, FrecencyQueryInner, GetCrmCompaniesRequest,
        GetRemindersRequest, GroupedSortRequest, IntoSoupReqAst, NotifiedEntity,
        NotifiedHydratableTypes, NotifiedPagePosition, NotifiedQueryInner, NotifiedSoupRequest,
        SimpleQueryInner, SimpleSortQuery, SimpleSortRequest, SoupDocumentServerFacts, SoupErr,
        SoupProjectionHydration, SoupPropertiesField, SoupQuery, SoupRequest, SoupSortDirection,
        SoupType, TouchedPagePosition, TouchedQueryInner, TouchedSoupRequest,
        calendar_filter_supported_by_notified, grouping::ItemGroupingInfo,
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
    models::{EnrichedEmailThreadPreview, GetEmailsRequest, PreviewView, PreviewViewStandardLabel},
    ports::EmailPreviewServiceReadOnly,
};
use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole};
use filter_ast::Expr;
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
use item_filters::ast::{
    EntityFilterAst,
    channel::{ChannelLiteral, ChannelThreadLiteral},
    email::EmailLiteral,
    foreign_entity::ForeignEntityLiteral,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use models_pagination::{
    Base64Str, Cursor, CursorVal, Frecency, FrecencyValue, Identify, NotifiedAt, PaginateOn,
    Paginated, Query, SimpleSortMethod, SortOn, TouchedByMe,
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
    reminder::SoupReminder,
};
use reminders::domain::{models::SoupReminderQuery, ports::RemindersService};
use serde::Serialize;
use std::cmp::Ordering;
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

#[cfg(test)]
mod tests;

#[derive(Debug)]
struct SoupCandidate {
    item: SoupItem<()>,
    document_server_facts: Option<SoupDocumentServerFacts>,
    frecency_score: Option<AggregateFrecency>,
    touched_at: Option<chrono::DateTime<chrono::Utc>>,
    notified_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl SoupCandidate {
    /// A candidate with no frecency, touch or notification timestamp loaded yet.
    fn plain(item: SoupItem<()>) -> Self {
        SoupCandidate {
            item,
            document_server_facts: None,
            frecency_score: None,
            touched_at: None,
            notified_at: None,
        }
    }

    /// A candidate whose optional server facts came from the same repository row.
    fn from_projection_hydration(hydration: SoupProjectionHydration) -> Self {
        SoupCandidate {
            item: hydration.item,
            document_server_facts: hydration.document_server_facts,
            frecency_score: None,
            touched_at: None,
            notified_at: None,
        }
    }
}

/// Upper bound on candidate pages one notified-at page may consume while
/// refilling after hydration drops (see `handle_notified_request`).
const MAX_NOTIFIED_FILL_ROUNDS: usize = 4;

/// The per-domain hydration legs a notified-at page can draw on, built from
/// the request the same way the simple path builds its sub-requests. A `None`
/// leg is off for this request, and its entity type never enters the
/// candidate query.
struct NotifiedHydrationLegs {
    /// Every inbox the caller can read; gates email-thread candidates.
    link_ids: Vec<Uuid>,
    email: Option<GetEmailsRequest>,
    comms: Option<GetChannelsRequest>,
    comms_threads: Option<GetThreadReplyRowsRequest>,
    foreign_entities: Option<(Vec<SourceId>, ForeignEntityListQuery)>,
    reminders: Option<GetRemindersRequest<'static>>,
}

/// ANDs a leg's request-level filter tree onto the page's id tree, so the
/// leg returns exactly the candidates that also satisfy the request.
fn with_id_tree<T: Clone>(ids: Arc<Expr<T>>, tree: Option<&Arc<Expr<T>>>) -> Arc<Expr<T>> {
    match tree {
        Some(tree) => Arc::new(Expr::and(Arc::unwrap_or_clone(ids), (**tree).clone())),
        None => ids,
    }
}

/// Parses a candidate's id for a leg keyed by uuid, logging and skipping the
/// row when the unconstrained TEXT column holds something else.
fn push_candidate_uuid(ids: &mut Vec<Uuid>, entity: &Entity<'_>, leg: &'static str) {
    match Uuid::parse_str(&entity.entity_id) {
        Ok(id) => ids.push(id),
        Err(error) => {
            tracing::warn!(error = ?error, leg, "notified entity id is not a uuid; skipping")
        }
    }
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

/// Builds a balanced `Or` tree over the given expressions. Balanced rather
/// than a linear fold: a full 500-item page folded linearly produces a
/// recursion-deep tree that downstream walkers and serializers reject.
fn balanced_or_tree<T>(mut nodes: Vec<Expr<T>>) -> Option<Arc<Expr<T>>> {
    while nodes.len() > 1 {
        let mut next = Vec::with_capacity(nodes.len().div_ceil(2));
        let mut iter = nodes.into_iter();
        while let Some(first) = iter.next() {
            next.push(match iter.next() {
                Some(second) => Expr::or(first, second),
                None => first,
            });
        }
        nodes = next;
    }
    nodes.pop().map(Arc::new)
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
pub struct SoupImpl<T, U, V, C, K, Crm, F, Rem> {
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
    /// the interface for interacting with reminders
    reminders_service: Rem,
}

impl<T, U, V, C, K, Crm, F, Rem> SoupImpl<T, U, V, C, K, Crm, F, Rem>
where
    T: SoupRepo,
    anyhow::Error: From<T::Err>,
    U: FrecencyQueryService,
    V: EmailPreviewServiceReadOnly,
    C: ChannelListService,
    K: CallRecordQueryService,
    Crm: CrmService,
    F: ForeignEntityService,
    Rem: RemindersService,
{
    /// Creates a soup service from its repository and dependent domain services.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        soup_storage: T,
        frecency: U,
        email_service: V,
        comms_service: C,
        call_record_service: K,
        crm_service: Crm,
        foreign_entity_service: F,
        reminders_service: Rem,
    ) -> Self {
        SoupImpl {
            soup_storage,
            frecency,
            email_service,
            comms_service,
            call_record_service,
            crm_service,
            foreign_entity_service,
            reminders_service,
        }
    }

    #[tracing::instrument(err, skip(self, req))]
    async fn handle_simple_request(
        &self,
        soup_type: SoupType,
        req: SimpleSortRequest<'_>,
        include_projection: bool,
    ) -> Result<impl Iterator<Item = SoupCandidate>, SoupErr> {
        let candidates: Vec<_> = match (soup_type, include_projection) {
            (SoupType::Expanded, true) => self
                .soup_storage
                .expanded_generic_cursor_soup_with_projection(req)
                .await
                .map_err(anyhow::Error::from)?
                .into_iter()
                .map(SoupCandidate::from_projection_hydration)
                .collect(),
            (SoupType::Expanded, false) => self
                .soup_storage
                .expanded_generic_cursor_soup(req)
                .await
                .map_err(anyhow::Error::from)?
                .into_iter()
                .map(SoupCandidate::plain)
                .collect(),
            (SoupType::UnExpanded, _) => self
                .soup_storage
                .unexpanded_generic_cursor_soup(req)
                .await
                .map_err(anyhow::Error::from)?
                .into_iter()
                .map(SoupCandidate::plain)
                .collect(),
        };
        Ok(candidates.into_iter())
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
        include_projection: bool,
    ) -> Result<Vec<SoupCandidate>, T::Err> {
        match (soup_type, include_projection) {
            (SoupType::Expanded, true) => Ok(self
                .soup_storage
                .expanded_soup_by_ids_with_projection(req)
                .await?
                .into_iter()
                .map(SoupCandidate::from_projection_hydration)
                .collect()),
            (SoupType::Expanded, false) => Ok(self
                .soup_storage
                .expanded_soup_by_ids(req)
                .await?
                .into_iter()
                .map(SoupCandidate::plain)
                .collect()),
            (SoupType::UnExpanded, _) => Ok(self
                .soup_storage
                .unexpanded_soup_by_ids(req)
                .await?
                .into_iter()
                .map(SoupCandidate::plain)
                .collect()),
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
        include_projection: bool,
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
                include_projection,
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
        include_projection: bool,
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
                        include_projection,
                    )
                    .await?,
                ));
            }
        };

        Ok(Either::Right(
            self.handle_frecency_cursor(from_score, soup_type, user, limit, include_projection)
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
        include_projection: bool,
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
                include_projection,
            )
            .await
            .map_err(anyhow::Error::from)?
            .into_iter()
            .join_frecency(res, |candidate| AggregateId {
                entity: candidate.item.entity(),
                user_id: user.copied().into_owned(),
            })
            .into_iter()
            .map(|(mut candidate, frecency)| {
                candidate.frecency_score = Some(frecency);
                candidate
            });

        Ok(match res.len().cmp(&(limit as usize)) {
            // use either to avoid boxing for dynamic dispatch
            Ordering::Less => Either::Left(
                self.fallback_soup_data(soup_type, user, res, limit, include_projection)
                    .await?,
            ),
            Ordering::Greater | Ordering::Equal => Either::Right(res),
        })
    }

    /// Runs one page of the touched-by-me feed: fetches (entity, touched_at)
    /// candidates from the activity log, hydrates each entity type by id, and
    /// reassembles the page in touched order. Returns the ordered candidates
    /// plus the next keyset position when the candidate page was full.
    #[tracing::instrument(err, skip(self, cursor))]
    async fn handle_touched_request(
        &self,
        cursor: Query<String, TouchedByMe, Option<EntityFilterAst>>,
        soup_type: SoupType,
        user: MacroUserIdStr<'static>,
        limit: u16,
        link_ids: Vec<Uuid>,
        include_projection: bool,
    ) -> Result<(Vec<SoupCandidate>, Option<TouchedPagePosition>), SoupErr> {
        // Channel and email filter trees fold in their own domains' query
        // builders, which the touched candidate query cannot reach.
        // Rejecting beats accepting the filter and silently returning a
        // feed with that whole type missing.
        if let Some(ast) = cursor.filter() {
            if ast.channel_filter.is_some() {
                return Err(SoupErr::TouchedUnsupportedFilter("channel"));
            }
            if ast.email_filter.tree.is_some() || ast.email_filter.crm_scope.is_some() {
                return Err(SoupErr::TouchedUnsupportedFilter("email"));
            }
        }

        let after = match &cursor {
            Query::Sort(_, _) => None,
            Query::Cursor(c) => Some(TouchedPagePosition {
                occurred_at: c.val.last_val,
                entity_id: c.id.clone(),
            }),
        };
        let touched = self
            .soup_storage
            .touched_soup_page(TouchedSoupRequest {
                user_id: user.copied(),
                limit,
                after,
                filter: cursor.filter().as_ref(),
                link_ids: &link_ids,
            })
            .await
            .map_err(anyhow::Error::from)?;

        // The next cursor comes from the candidate page's own keyset, not
        // the hydrated item count: the candidate query already gates on
        // existence/access, so hydration only loses items to races, and a
        // race must not end the feed early.
        let next = (touched.len() == usize::from(limit))
            .then(|| {
                touched.last().map(|last| TouchedPagePosition {
                    occurred_at: last.touched_at,
                    entity_id: last.entity.entity_id.to_string(),
                })
            })
            .flatten();

        let mut main_entities = Vec::new();
        let mut project_entities = Vec::new();
        let mut channel_ids = Vec::new();
        let mut email_ids = Vec::new();
        for candidate in &touched {
            match candidate.entity.entity_type {
                EntityType::Document | EntityType::Chat => {
                    main_entities.push(candidate.entity.copied())
                }
                // Projects are rows of this feed in both soup types, but the
                // expanded by-ids query deliberately omits project rows, so
                // under Expanded they hydrate through a separate unexpanded
                // query. Under UnExpanded the main query is already the
                // unexpanded one — projects ride it, saving a round trip.
                EntityType::Project => match soup_type {
                    SoupType::Expanded => project_entities.push(candidate.entity.copied()),
                    SoupType::UnExpanded => main_entities.push(candidate.entity.copied()),
                },
                EntityType::Channel => match Uuid::parse_str(&candidate.entity.entity_id) {
                    Ok(id) => channel_ids.push(id),
                    Err(error) => {
                        tracing::warn!(error = ?error, "touched channel id is not a uuid; skipping")
                    }
                },
                EntityType::EmailThread => match Uuid::parse_str(&candidate.entity.entity_id) {
                    Ok(id) => email_ids.push(id),
                    Err(error) => {
                        tracing::warn!(error = ?error, "touched thread id is not a uuid; skipping")
                    }
                },
                // The candidate query only returns the types above.
                _ => {}
            }
        }

        let comms_request = balanced_or_tree(
            channel_ids
                .iter()
                .map(|id| Expr::val(ChannelLiteral::ChannelId(*id)))
                .collect(),
        )
        .map(|tree| GetChannelsRequest {
            macro_id: user.clone(),
            limit: Some(channel_ids.len() as u32),
            include_frecency: false,
            query: Query::Sort(SimpleSortMethod::UpdatedAt, Some(tree)),
        });
        let email_request = balanced_or_tree(
            email_ids
                .iter()
                .map(|id| Expr::val(EmailLiteral::ThreadId(*id)))
                .collect(),
        )
        .map(|tree| GetEmailsRequest {
            // The `All` view adds no thread/message conditions. Any other
            // view would re-filter threads the candidate query already
            // admitted (Inbox drops just-sent and archived threads), and a
            // candidate that fails hydration is lost from the page.
            view: PreviewView::StandardLabel(PreviewViewStandardLabel::All),
            link_ids: link_ids.clone(),
            macro_id: user.clone(),
            limit: Some(email_ids.len() as u32),
            query: Query::Sort(SimpleSortMethod::UpdatedAt, Some(tree)),
            include_frecency: false,
            team_receipt: None,
            crm_scope: None,
        });

        // The repo error type is not Send, so it cannot ride through
        // tokio::join!; convert inside the future instead.
        let main_items_fut = async {
            self.handle_soup_by_ids(
                soup_type,
                AdvancedSortParams {
                    entities: &main_entities,
                    user_id: user.copied(),
                },
                include_projection,
            )
            .await
            .map_err(anyhow::Error::from)
            .map_err(SoupErr::from)
        };
        let project_items_fut = async {
            if project_entities.is_empty() {
                return Ok(Vec::new());
            }
            self.soup_storage
                .unexpanded_soup_by_ids(AdvancedSortParams {
                    entities: &project_entities,
                    user_id: user.copied(),
                })
                .await
                .map_err(anyhow::Error::from)
                .map_err(SoupErr::from)
        };
        let (main_items, project_items, channel_candidates, email_candidates) = tokio::join!(
            main_items_fut,
            project_items_fut,
            self.handle_comms_request(comms_request),
            self.handle_email_request(email_request),
        );

        let mut candidates_by_entity: HashMap<(EntityType, String), SoupCandidate> = HashMap::new();
        for candidate in main_items?
            .into_iter()
            .chain(project_items?.into_iter().map(SoupCandidate::plain))
            .chain(channel_candidates?)
            .chain(email_candidates?)
        {
            let key = {
                let entity = candidate.item.entity();
                (entity.entity_type, entity.entity_id.to_string())
            };
            candidates_by_entity.insert(key, candidate);
        }

        let candidates = touched
            .into_iter()
            .filter_map(|touched_candidate| {
                let key = (
                    touched_candidate.entity.entity_type,
                    touched_candidate.entity.entity_id.to_string(),
                );
                let mut candidate = candidates_by_entity.remove(&key).or_else(|| {
                    // The candidate query gates on existence and access, so
                    // a miss is a race (revoked/deleted mid-request).
                    tracing::warn!(entity_type = ?key.0, "touched entity did not hydrate; skipping");
                    None
                })?;
                candidate.touched_at = Some(touched_candidate.touched_at);
                Some(candidate)
            })
            .collect();

        Ok((candidates, next))
    }

    /// Runs one page of the notified-at feed: fetches (entity, notified_at)
    /// candidates from the user's notifications, hydrates each entity type by
    /// id, and reassembles the page in notification order.
    ///
    /// Channel, channel-thread, email, foreign-entity and reminder candidates
    /// hydrate through their own domains' legs with the request's filter tree
    /// for that type ANDed in, so those filters apply at hydration rather
    /// than in the candidate query. A candidate the leg does not return is dropped and
    /// the page refills from the next candidate page, bounded by
    /// [`MAX_NOTIFIED_FILL_ROUNDS`] so a run of filtered-out candidates still
    /// answers promptly — with a cursor to continue from, since the feed is
    /// only exhausted once the candidate query itself runs dry.
    #[tracing::instrument(err, skip(self, cursor, legs))]
    async fn handle_notified_request(
        &self,
        cursor: Query<String, NotifiedAt, Option<EntityFilterAst>>,
        soup_type: SoupType,
        user: MacroUserIdStr<'static>,
        limit: u16,
        legs: NotifiedHydrationLegs,
        include_projection: bool,
    ) -> Result<(Vec<SoupCandidate>, Option<NotifiedPagePosition>), SoupErr> {
        let filter = cursor.filter().as_ref();
        // Calendar events hydrate by id through the main query, which takes
        // no filter, so the candidate query must fold the calendar tree
        // itself — and it only knows the id and notification literals.
        if !calendar_filter_supported_by_notified(
            filter.and_then(|f| f.calendar_event_filter.as_deref()),
        ) {
            return Err(SoupErr::NotifiedUnsupportedFilter("calendar_event"));
        }

        let mut after = match &cursor {
            Query::Sort(_, _) => None,
            Query::Cursor(c) => Some(NotifiedPagePosition {
                notified_at: c.val.last_val,
                entity_id: c.id.clone(),
            }),
        };
        let foreign_entity_sources: Vec<SourceId> = legs
            .foreign_entities
            .as_ref()
            .map(|(sources, _)| sources.clone())
            .unwrap_or_default();
        let hydratable = NotifiedHydratableTypes {
            channels: legs.comms.is_some(),
            channel_threads: legs.comms_threads.is_some(),
            email_threads: legs.email.is_some(),
            foreign_entities: legs.foreign_entities.is_some(),
            reminders: legs.reminders.is_some(),
        };
        let page_len = usize::from(limit);

        let mut page: Vec<SoupCandidate> = Vec::with_capacity(page_len);
        let mut next = None;
        for _ in 0..MAX_NOTIFIED_FILL_ROUNDS {
            let candidates = self
                .soup_storage
                .notified_soup_page(NotifiedSoupRequest {
                    user_id: user.copied(),
                    limit,
                    after: after.clone(),
                    filter,
                    link_ids: &legs.link_ids,
                    foreign_entity_sources: &foreign_entity_sources,
                    hydratable,
                })
                .await
                .map_err(anyhow::Error::from)?;
            let candidate_page_full = candidates.len() == page_len;
            let mut hydrated = self
                .hydrate_notified_candidates(
                    &candidates,
                    soup_type,
                    &user,
                    &legs,
                    include_projection,
                )
                .await?;

            // Walk candidates in feed order until the page is full. The
            // cursor is the last candidate walked, kept or dropped: anything
            // after it is re-fetched by the next page.
            let mut walked = None;
            let mut consumed = 0;
            for candidate in &candidates {
                if page.len() == page_len {
                    break;
                }
                consumed += 1;
                walked = Some(NotifiedPagePosition {
                    notified_at: candidate.notified_at,
                    entity_id: candidate.entity.entity_id.to_string(),
                });
                let key = (
                    candidate.entity.entity_type,
                    candidate.entity.entity_id.to_string(),
                );
                if let Some(mut item) = hydrated.remove(&key) {
                    item.notified_at = Some(candidate.notified_at);
                    page.push(item);
                }
            }

            let exhausted = !candidate_page_full && consumed == candidates.len();
            if page.len() == page_len {
                next = if exhausted { None } else { walked };
                break;
            }
            if exhausted {
                next = None;
                break;
            }
            next = walked.clone();
            after = walked;
        }

        Ok((page, next))
    }

    /// Hydrates one candidate page's entities through the by-id queries and
    /// the domain legs, keyed by entity for reassembly in candidate order.
    async fn hydrate_notified_candidates(
        &self,
        candidates: &[NotifiedEntity],
        soup_type: SoupType,
        user: &MacroUserIdStr<'static>,
        legs: &NotifiedHydrationLegs,
        include_projection: bool,
    ) -> Result<HashMap<(EntityType, String), SoupCandidate>, SoupErr> {
        let mut main_entities = Vec::new();
        let mut project_entities = Vec::new();
        let mut channel_ids = Vec::new();
        let mut thread_ids = Vec::new();
        let mut email_ids = Vec::new();
        let mut foreign_entity_ids = Vec::new();
        let mut reminder_ids = Vec::new();
        for candidate in candidates {
            match candidate.entity.entity_type {
                // Calendar events ride the main by-ids query in both soup types.
                EntityType::Document | EntityType::Chat | EntityType::CalendarEvent => {
                    main_entities.push(candidate.entity.copied())
                }
                // Same split as the touched feed: the expanded by-ids query
                // omits project rows, so they hydrate unexpanded separately.
                EntityType::Project => match soup_type {
                    SoupType::Expanded => project_entities.push(candidate.entity.copied()),
                    SoupType::UnExpanded => main_entities.push(candidate.entity.copied()),
                },
                EntityType::Channel => {
                    push_candidate_uuid(&mut channel_ids, &candidate.entity, "channel")
                }
                // Thread-scoped channel notifications are keyed on their
                // thread root, which is the thread row's id.
                EntityType::ChannelMessage => {
                    push_candidate_uuid(&mut thread_ids, &candidate.entity, "channel thread")
                }
                EntityType::EmailThread => {
                    push_candidate_uuid(&mut email_ids, &candidate.entity, "email")
                }
                EntityType::ForeignEntity => {
                    push_candidate_uuid(&mut foreign_entity_ids, &candidate.entity, "foreign")
                }
                EntityType::Reminder => {
                    push_candidate_uuid(&mut reminder_ids, &candidate.entity, "reminder")
                }
                // The candidate query only returns the types above.
                _ => {}
            }
        }

        let comms_request = legs.comms.as_ref().and_then(|template| {
            let ids = balanced_or_tree(
                channel_ids
                    .iter()
                    .map(|id| Expr::val(ChannelLiteral::ChannelId(*id)))
                    .collect(),
            )?;
            Some(GetChannelsRequest {
                macro_id: user.clone(),
                limit: Some(channel_ids.len() as u32),
                include_frecency: false,
                query: Query::Sort(
                    SimpleSortMethod::UpdatedAt,
                    Some(with_id_tree(ids, template.query.filter().as_ref())),
                ),
            })
        });
        let comms_thread_request = legs.comms_threads.as_ref().and_then(|template| {
            let ids = balanced_or_tree(
                thread_ids
                    .iter()
                    .map(|id| Expr::val(ChannelThreadLiteral::ThreadId(*id)))
                    .collect(),
            )?;
            Some(GetThreadReplyRowsRequest {
                macro_id: user.clone(),
                limit: Some(thread_ids.len() as u32),
                query: Query::Sort(
                    SimpleSortMethod::UpdatedAt,
                    Some(with_id_tree(ids, template.query.filter().as_ref())),
                ),
            })
        });
        let email_request = legs.email.as_ref().and_then(|template| {
            let ids = balanced_or_tree(
                email_ids
                    .iter()
                    .map(|id| Expr::val(EmailLiteral::ThreadId(*id)))
                    .collect(),
            )?;
            Some(GetEmailsRequest {
                view: template.view.clone(),
                link_ids: template.link_ids.clone(),
                macro_id: user.clone(),
                limit: Some(email_ids.len() as u32),
                query: Query::Sort(
                    SimpleSortMethod::UpdatedAt,
                    Some(with_id_tree(ids, template.query.filter().as_ref())),
                ),
                include_frecency: false,
                team_receipt: template.team_receipt.clone(),
                crm_scope: template.crm_scope.clone(),
            })
        });
        let (foreign_entity_sources, foreign_entity_query) = legs
            .foreign_entities
            .as_ref()
            .and_then(|(sources, template)| {
                let ids = balanced_or_tree(
                    foreign_entity_ids
                        .iter()
                        .map(|id| Expr::val(ForeignEntityLiteral::Id(*id)))
                        .collect(),
                )?;
                Some((
                    sources.clone(),
                    Query::Sort(
                        SimpleSortMethod::UpdatedAt,
                        Some(with_id_tree(ids, template.filter().as_ref())),
                    ),
                ))
            })
            .map_or((Vec::new(), None), |(sources, query)| {
                (sources, Some(query))
            });
        let reminder_request = legs.reminders.as_ref().and_then(|template| {
            // A request naming specific reminders keeps that constraint;
            // otherwise the page's candidates are the id set. An empty
            // intersection skips the leg: an empty id list means every
            // reminder to the reminders service.
            let ids: Vec<Uuid> = if template.reminder_ids.is_empty() {
                reminder_ids.clone()
            } else {
                reminder_ids
                    .iter()
                    .copied()
                    .filter(|id| template.reminder_ids.contains(id))
                    .collect()
            };
            if ids.is_empty() {
                return None;
            }
            Some(GetRemindersRequest {
                user_id: template.user_id.clone(),
                limit: ids.len() as i64,
                reminder_ids: ids,
                entities: template.entities.clone(),
                completed: template.completed,
                fired: template.fired,
                order: template.order,
            })
        });

        // The repo error type is not Send, so it cannot ride through
        // tokio::join!; convert inside the future instead.
        let main_items_fut = async {
            self.handle_soup_by_ids(
                soup_type,
                AdvancedSortParams {
                    entities: &main_entities,
                    user_id: user.copied(),
                },
                include_projection,
            )
            .await
            .map_err(anyhow::Error::from)
            .map_err(SoupErr::from)
        };
        let project_items_fut = async {
            if project_entities.is_empty() {
                return Ok(Vec::new());
            }
            self.soup_storage
                .unexpanded_soup_by_ids(AdvancedSortParams {
                    entities: &project_entities,
                    user_id: user.copied(),
                })
                .await
                .map_err(anyhow::Error::from)
                .map_err(SoupErr::from)
        };
        let (
            main_items,
            project_items,
            channel_candidates,
            thread_candidates,
            email_candidates,
            foreign_entity_candidates,
            reminder_candidates,
        ) = tokio::join!(
            main_items_fut,
            project_items_fut,
            self.handle_comms_request(comms_request),
            self.handle_comms_thread_request(comms_thread_request),
            self.handle_email_request(email_request),
            self.handle_foreign_entity_request(
                Some(user.to_string()),
                foreign_entity_sources,
                foreign_entity_ids.len() as u32,
                foreign_entity_query,
            ),
            self.handle_reminder_request(reminder_request),
        );

        let mut candidates_by_entity = HashMap::new();
        for candidate in main_items?
            .into_iter()
            .chain(project_items?.into_iter().map(SoupCandidate::plain))
            .chain(channel_candidates?)
            .chain(thread_candidates?)
            .chain(email_candidates?)
            .chain(foreign_entity_candidates?)
            .chain(reminder_candidates?)
        {
            let key = {
                let entity = candidate.item.entity();
                (entity.entity_type, entity.entity_id.to_string())
            };
            candidates_by_entity.insert(key, candidate);
        }
        Ok(candidates_by_entity)
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
                document_server_facts: None,
                frecency_score,
                touched_at: None,
                notified_at: None,
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
                            document_server_facts: None,
                            frecency_score,
                            touched_at: None,
                            notified_at: None,
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
                .map(|message| {
                    SoupCandidate::plain(SoupItem::ChannelThread(
                        SoupChannelThread::new_from_channel_message(message),
                    ))
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

        Ok(Either::Right(items.into_iter().map(SoupCandidate::plain)))
    }

    #[tracing::instrument(err, skip(self, req))]
    async fn handle_reminder_request(
        &self,
        req: Option<GetRemindersRequest<'_>>,
    ) -> Result<impl Iterator<Item = SoupCandidate>, SoupErr> {
        let Some(req) = req else {
            return Ok(Either::Left(None.into_iter()));
        };

        let GetRemindersRequest {
            user_id,
            reminder_ids,
            entities,
            completed,
            fired,
            order,
            limit,
        } = req;

        let items: Vec<SoupItem<()>> = self
            .reminders_service
            .list_reminders_for_soup(
                &user_id,
                SoupReminderQuery {
                    ids: &reminder_ids,
                    entities: &entities,
                    completed,
                    fired,
                    order,
                    limit,
                },
            )
            .await
            .map_err(|err| {
                tracing::error!(error = ?err, "reminder soup request failed");
                SoupErr::ReminderErr
            })?
            .into_iter()
            .map(|reminder| SoupItem::Reminder(SoupReminder::from(reminder)))
            .collect();

        Ok(Either::Right(items.into_iter().map(SoupCandidate::plain)))
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

        Ok(Either::Right(items.into_iter().map(SoupCandidate::plain)))
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
                .map(|entity| SoupCandidate::plain(foreign_entity_to_soup_item(entity))),
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

        let (items, enrichments): (Vec<_>, Vec<_>) = items
            .into_iter()
            .map(|item| {
                (
                    item.item,
                    (item.frecency_score, item.touched_at, item.notified_at),
                )
            })
            .unzip();
        let items = self
            .soup_storage
            .populate_properties(user_id, items)
            .await
            .map_err(anyhow::Error::from)?;
        if items.len() != enrichments.len() {
            return Err(SoupErr::SoupDbErr(anyhow::anyhow!(
                "property hydration changed the number of Soup items"
            )));
        }

        Ok(items
            .into_iter()
            .zip(enrichments)
            .map(
                |(item, (frecency_score, touched_at, notified_at))| EnrichedSoupItem {
                    item,
                    frecency_score,
                    touched_at,
                    notified_at,
                },
            )
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
            SoupOutput::Simple(page) => Ok(SoupOutput::Simple(
                self.populate_properties_page(user_id, page).await?,
            )),
            SoupOutput::Frecency(page) => Ok(SoupOutput::Frecency(
                self.populate_properties_page(user_id, page).await?,
            )),
            SoupOutput::Touched(page) => Ok(SoupOutput::Touched(
                self.populate_properties_page(user_id, page).await?,
            )),
            SoupOutput::Notified(page) => Ok(SoupOutput::Notified(
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
            SoupOutput::Simple(page) => Ok(SoupOutput::Simple(
                self.populate_frecency_page(user_id, page).await?,
            )),
            // Frecency sorting already loaded the scores needed for ordering
            // and cursor construction. Reuse them rather than issuing a
            // duplicate by-id lookup.
            SoupOutput::Frecency(page) => Ok(SoupOutput::Frecency(page)),
            // Touched sorting orders on the activity log, so scores are not
            // loaded during page construction; load them for the final page.
            SoupOutput::Touched(page) => Ok(SoupOutput::Touched(
                self.populate_frecency_page(user_id, page).await?,
            )),
            // Likewise for notified sorting, which orders on notifications.
            SoupOutput::Notified(page) => Ok(SoupOutput::Notified(
                self.populate_frecency_page(user_id, page).await?,
            )),
        }
    }

    fn into_raw_output<R>(output: SoupOutput<R, SoupCandidate>) -> SoupOutput<R> {
        output.map(|candidate| candidate.item)
    }

    fn into_enriched_output<R>(
        output: SoupOutput<R, SoupCandidate>,
    ) -> SoupOutput<R, EnrichedSoupItem> {
        output.map(|candidate| EnrichedSoupItem {
            item: candidate
                .item
                .map_extra(|()| SoupPropertiesField::default()),
            frecency_score: candidate.frecency_score,
            touched_at: candidate.touched_at,
            notified_at: candidate.notified_at,
        })
    }

    fn into_projection_output<R>(
        output: SoupOutput<R, SoupCandidate>,
    ) -> SoupOutput<R, SoupProjectionHydration> {
        output.map(|candidate| SoupProjectionHydration {
            item: candidate.item,
            document_server_facts: candidate.document_server_facts,
        })
    }

    fn into_enriched_projection_output<R>(
        output: SoupOutput<R, SoupCandidate>,
    ) -> SoupOutput<R, SoupProjectionHydration<EnrichedSoupItem>> {
        output.map(|candidate| SoupProjectionHydration {
            item: EnrichedSoupItem {
                item: candidate
                    .item
                    .map_extra(|()| SoupPropertiesField::default()),
                frecency_score: candidate.frecency_score,
                touched_at: candidate.touched_at,
                notified_at: candidate.notified_at,
            },
            document_server_facts: candidate.document_server_facts,
        })
    }

    fn clear_frecency<R>(
        output: SoupOutput<R, EnrichedSoupItem>,
    ) -> SoupOutput<R, EnrichedSoupItem> {
        output.map(|mut item| {
            item.frecency_score = None;
            item
        })
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
        include_projection: bool,
    ) -> Result<SoupOutput<R, SoupCandidate>, SoupErr>
    where
        SoupRequest<R>: IntoSoupReqAst,
        R: Clone + Serialize + Send,
    {
        let entity_filter = req.filters().clone();
        let req = req.into_ast()?;
        let limit = req.limit.clamp(1, 500);

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
        let reminder_request = req.build_reminder_request(limit.into());
        let sort_direction = req.sort_direction;

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
                    include_projection,
                );
                let email_soup_fut = self.handle_email_request(email_request);
                let comms_soup_fut = self.handle_comms_request(comms_request);
                let comms_thread_soup_fut = self.handle_comms_thread_request(comms_thread_request);
                let call_soup_fut = self.handle_call_request(call_request);
                let crm_company_soup_fut = self.handle_crm_company_request(crm_company_request);
                let reminder_soup_fut = self.handle_reminder_request(reminder_request);
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
                    reminder_soup,
                    foreign_entity_soup,
                ) = tokio::join!(
                    main_soup_fut,
                    email_soup_fut,
                    comms_soup_fut,
                    comms_thread_soup_fut,
                    call_soup_fut,
                    crm_company_soup_fut,
                    reminder_soup_fut,
                    foreign_entity_soup_fut,
                );

                let paginator = main_soup?
                    .chain(email_soup?)
                    .chain(comms_soup?)
                    .chain(comms_thread_soup?)
                    .chain(call_soup?)
                    .chain(crm_company_soup?)
                    .chain(reminder_soup?)
                    .chain(foreign_entity_soup?)
                    .paginate_on(limit.into(), sort_method)
                    .filter_on(entity_filter);

                let page = match sort_direction {
                    SoupSortDirection::Asc => paginator.sort_asc(),
                    SoupSortDirection::Desc => paginator.sort_desc(),
                }
                .into_page();

                Ok(SoupOutput::Simple(page))
            }
            SoupQuery::Frecency(FrecencyQueryInner(cursor)) => Ok(SoupOutput::Frecency(
                self.handle_advanced_sort(
                    cursor,
                    req.soup_type,
                    req.user,
                    limit,
                    include_projection,
                )
                .await?
                .paginate_on(limit.into(), Frecency)
                .filter_on(entity_filter)
                .into_page(),
            )),
            SoupQuery::Touched(TouchedQueryInner(cursor)) => {
                let (candidates, next) = self
                    .handle_touched_request(
                        cursor,
                        req.soup_type,
                        req.user,
                        limit,
                        req.link_ids,
                        include_projection,
                    )
                    .await?;
                let next_cursor = next.map(|position| {
                    Base64Str::encode_json(Cursor {
                        id: position.entity_id,
                        limit: limit.into(),
                        val: CursorVal {
                            sort_type: TouchedByMe,
                            last_val: position.occurred_at,
                        },
                        filter: entity_filter,
                    })
                });
                Ok(SoupOutput::Touched(Paginated::from_parts(
                    candidates,
                    next_cursor,
                )))
            }
            SoupQuery::Notified(NotifiedQueryInner(cursor)) => {
                let legs = NotifiedHydrationLegs {
                    link_ids: req.link_ids,
                    email: email_request,
                    comms: comms_request,
                    comms_threads: comms_thread_request,
                    foreign_entities: foreign_entity_query
                        .map(|query| (foreign_entity_source_ids, query)),
                    reminders: reminder_request,
                };
                let (candidates, next) = self
                    .handle_notified_request(
                        cursor,
                        req.soup_type,
                        req.user,
                        limit,
                        legs,
                        include_projection,
                    )
                    .await?;
                let next_cursor = next.map(|position| {
                    Base64Str::encode_json(Cursor {
                        id: position.entity_id,
                        limit: limit.into(),
                        val: CursorVal {
                            sort_type: NotifiedAt,
                            last_val: position.notified_at,
                        },
                        filter: entity_filter,
                    })
                });
                Ok(SoupOutput::Notified(Paginated::from_parts(
                    candidates,
                    next_cursor,
                )))
            }
        }
    }
}

impl<T, U, V, C, K, Crm, F, Rem> SoupService for SoupImpl<T, U, V, C, K, Crm, F, Rem>
where
    T: SoupRepo,
    anyhow::Error: From<T::Err>,
    U: FrecencyQueryService,
    V: EmailPreviewServiceReadOnly,
    C: ChannelListService,
    K: CallRecordQueryService,
    Crm: CrmService,
    F: ForeignEntityService,
    Rem: RemindersService,
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
        let output = self
            .get_user_soup_internal(req, team_receipt, false)
            .await?;
        Ok(Self::into_raw_output(output))
    }

    #[tracing::instrument(err, skip(self, req, team_receipt))]
    async fn get_user_soup_with_projection<R>(
        &self,
        req: SoupRequest<R>,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<SoupOutput<R, SoupProjectionHydration>, SoupErr>
    where
        SoupRequest<R>: IntoSoupReqAst,
        R: Clone + Serialize + Send,
    {
        let output = self.get_user_soup_internal(req, team_receipt, true).await?;
        Ok(Self::into_projection_output(output))
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
        let output = self
            .get_user_soup_internal(req, team_receipt, false)
            .await?;
        let output = self.populate_frecency_output(user_id, output).await?;
        Ok(Self::into_enriched_output(output))
    }

    #[tracing::instrument(err, skip(self, req, team_receipt))]
    async fn get_user_soup_with_frecency_and_projection<R>(
        &self,
        req: SoupRequest<R>,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<SoupOutput<R, SoupProjectionHydration<EnrichedSoupItem>>, SoupErr>
    where
        SoupRequest<R>: IntoSoupReqAst,
        R: Clone + Serialize + Send,
    {
        let user_id = req.user.clone();
        let output = self.get_user_soup_internal(req, team_receipt, true).await?;
        let output = self.populate_frecency_output(user_id, output).await?;
        Ok(Self::into_enriched_projection_output(output))
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
        let output = self
            .get_user_soup_internal(req, team_receipt, false)
            .await?;
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
        let output = self
            .get_user_soup_internal(req, team_receipt, false)
            .await?;
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
