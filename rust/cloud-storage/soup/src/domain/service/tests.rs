use crate::domain::models::FrecencySoupItem;
use crate::domain::ports::MockSoupRepo;
use chrono::Days;
use comms::domain::models::GetChannelsRequest;
use cool_asserts::assert_matches;
use email::domain::models::{EmailErr, EnrichedEmailThreadPreview, PreviewView};
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use frecency::domain::models::{FrecencyPageRequest, FrecencyPageResponse};
use frecency::domain::ports::MockFrecencyQueryService;
use frecency::domain::services::FrecencyQueryServiceImpl;
use frecency::{domain::models::AggregateFrecency, outbound::mock::MockFrecencyStorage};
use item_filters::EntityFilters;
use model_entity::EntityType;
use models_pagination::{
    Cursor, CursorVal, CursorWithValAndFilter, FrecencyValue, PaginatedCursor, SimpleSortMethod,
    TypeEraseCursor,
};
use models_soup::document::{SoupDocument, SoupDocumentSubType};
use ordered_float::OrderedFloat;
use rootcause::Report;
use sqlx::types::chrono::{DateTime, Utc};
use uuid::Uuid;

use super::*;

struct NoopEmailService;

impl EmailService for NoopEmailService {
    async fn get_email_thread_previews(
        &self,
        _req: email::domain::models::GetEmailsRequest,
    ) -> Result<
        PaginatedCursor<EnrichedEmailThreadPreview, Uuid, SimpleSortMethod, ()>,
        email::domain::models::EmailErr,
    > {
        Ok(Option::<EnrichedEmailThreadPreview>::None
            .into_iter()
            .paginate_on(0, SimpleSortMethod::CreatedAt)
            .into_page())
    }

    async fn get_link_by_auth_id_and_macro_id(
        &self,
        _auth_id: &str,
        _macro_id: MacroUserIdStr<'_>,
    ) -> Result<Option<email::domain::models::Link>, email::domain::models::EmailErr> {
        Err(EmailErr::RepoErr(anyhow::anyhow!("not implemented")))
    }

    async fn get_thread_with_messages(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _offset: i64,
        _limit: i64,
    ) -> Result<Option<email::domain::models::Thread>, EmailErr> {
        Err(EmailErr::RepoErr(anyhow::anyhow!("not implemented")))
    }

    async fn create_draft(
        &self,
        _link: &email::domain::models::Link,
        _input: email::domain::models::CreateDraftInput,
    ) -> Result<email::domain::models::CreatedDraft, EmailErr> {
        Err(EmailErr::RepoErr(anyhow::anyhow!("not implemented")))
    }
}

struct NoopCommsService;

impl ChannelsService for NoopCommsService {
    async fn get_channels(
        &self,
        _req: GetChannelsRequest,
    ) -> Result<Vec<comms::domain::models::channel::ChannelWithLatest>, Report> {
        Ok(Vec::new())
    }

    async fn get_activities(
        &self,
        _user: MacroUserIdStr<'_>,
    ) -> Result<Vec<comms::domain::models::channel::Activity>, Report> {
        Ok(Vec::new())
    }

    async fn get_names(
        &self,
        _names: std::collections::HashSet<MacroUserIdStr<'_>>,
    ) -> Result<Vec<comms::domain::models::UserName>, Report> {
        Ok(Vec::new())
    }
}

fn soup_document(id: &str) -> SoupDocument {
    // Create a deterministic UUID from the string ID
    let uuid = Uuid::parse_str(id).unwrap_or_else(|_| {
        // For simple IDs like "doc-1", create a zero UUID with the number embedded
        let num: u128 = id
            .chars()
            .filter(|c| c.is_numeric())
            .collect::<String>()
            .parse()
            .unwrap_or(0);
        Uuid::from_u128(num)
    });
    soup_document_uuid_with_updated(uuid, Default::default())
}

fn soup_document_with_updated(id: &str, updated_at: DateTime<Utc>) -> SoupDocument {
    // Create a deterministic UUID from the string ID
    let uuid = Uuid::parse_str(id).unwrap_or_else(|_| {
        // For simple IDs like "doc-1", create a zero UUID with the number embedded
        let num: u128 = id
            .chars()
            .filter(|c| c.is_numeric())
            .collect::<String>()
            .parse()
            .unwrap_or(0);
        Uuid::from_u128(num)
    });
    soup_document_uuid_with_updated(uuid, updated_at)
}

fn soup_document_uuid_with_updated(id: Uuid, updated_at: DateTime<Utc>) -> SoupDocument {
    soup_document_with_is_completed(id, updated_at, None)
}

fn soup_document_with_is_completed(
    id: Uuid,
    updated_at: DateTime<Utc>,
    is_completed: Option<bool>,
) -> SoupDocument {
    SoupDocument {
        id,
        document_version_id: 1,
        owner_id: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        name: Default::default(),
        file_type: None,
        sha: None,
        project_id: None,
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: None,
        created_at: Default::default(),
        updated_at,
        viewed_at: Default::default(),
        sub_type: is_completed.map(|is_completed| SoupDocumentSubType::Task { is_completed }),
        properties: Default::default(),
        deleted_at: None,
    }
}

#[tokio::test]
async fn it_should_not_query_frecency() {
    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_unexpanded_generic_cursor_soup()
        .withf(|a| {
            matches!(a.cursor.sort_method(), SimpleSortMethod::ViewedUpdated)
                && assert_matches!(
                    a,
                    SimpleSortRequest {
                        limit: 20,
                        user_id,
                        cursor: SimpleSortQuery::NoFilter(Query::Sort(SimpleSortMethod::ViewedUpdated, ())),
                    } => {
                        assert_eq!(user_id.as_ref(), "macro|test@example.com");
                        true
                    }
                )
        })
        .times(1)
        .returning(|_params| {
            Box::pin(async move {
                Ok(Some(soup_document("my-document"))
                    .into_iter()
                    .cycle()
                    .take(10)
                    .map(SoupItem::Document)
                    .collect())
            })
        });
    soup_mock
        .expect_populate_properties()
        .returning(|_| Box::pin(async { Ok(()) }));

    let res = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailService,
        NoopCommsService,
    )
    .get_user_soup(SoupRequest {
        email_preview_view: PreviewView::StandardLabel(
            email::domain::models::PreviewViewStandardLabel::Inbox,
        ),
        link_id: Some(Uuid::new_v4()),
        soup_type: SoupType::UnExpanded,
        limit: 0,
        cursor: SoupQuery::new_sort_simple(
            SimpleSortMethod::ViewedUpdated,
            EntityFilters::default(),
        ),
        user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
    })
    .await
    .unwrap()
    .type_erase();

    dbg!(&res);

    assert_eq!(res.items.len(), 10)
}

#[tokio::test]
async fn it_should_query_frecency() {
    let mut frecency_mock = MockFrecencyStorage::new();
    frecency_mock
        .expect_get_top_entities()
        .times(1)
        .withf(|req| {
            assert_eq!(req.user_id.as_ref(), "macro|test@example.com");
            assert_eq!(req.limit, 500);
            true
        })
        .returning(|req| {
            Box::pin(async move {
                Ok((1..=req.limit)
                    .map(|i| {
                        AggregateFrecency::new_mock(
                            EntityType::Document
                                .with_entity_string(uuid::Uuid::from_u128(i as u128).to_string()),
                            420.0,
                        )
                    })
                    .collect())
            })
        });

    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_unexpanded_soup_by_ids()
        .withf(|a| {
            assert_matches!(
                a,
                AdvancedSortParams {
                    user_id,
                    entities,
                } => {
                    assert_eq!(user_id.as_ref(), "macro|test@example.com");
                    dbg!(&entities);
                    assert_eq!(entities.len(), 500);
                    true
                }
            )
        })
        .times(1)
        .returning(|params| {
            let res = Ok(params
                .entities
                .iter()
                .map(|v| soup_document(&v.entity_id))
                .map(SoupItem::Document)
                .collect());
            Box::pin(async move { res })
        });

    let res = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(frecency_mock),
        NoopEmailService,
        NoopCommsService,
    )
    .get_user_soup(SoupRequest {
        email_preview_view: PreviewView::StandardLabel(
            email::domain::models::PreviewViewStandardLabel::Inbox,
        ),
        link_id: Some(Uuid::new_v4()),
        soup_type: SoupType::UnExpanded,
        limit: u16::MAX,
        cursor: SoupQuery::new_sort_frecency(Frecency, EntityFilters::default()),
        user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
    })
    .await
    .unwrap()
    .type_erase();

    dbg!(&res);

    assert_eq!(res.items.len(), 500)
}

#[tokio::test]
async fn it_should_sort_frecency_descending() {
    let mut frecency_mock = MockFrecencyStorage::new();
    frecency_mock
        .expect_get_top_entities()
        .times(1)
        .withf(|req| {
            assert_eq!(req.user_id.as_ref(), "macro|test@example.com");
            assert_eq!(req.limit, 500);
            true
        })
        .returning(|req| {
            Box::pin(async move {
                Ok((1..=req.limit)
                    .map(|v| {
                        AggregateFrecency::new_mock(
                            EntityType::Document
                                .with_entity_string(uuid::Uuid::from_u128(v as u128).to_string()),
                            f64::from(v),
                        )
                    })
                    .collect())
            })
        });

    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_unexpanded_soup_by_ids()
        .withf(|a| {
            assert_matches!(
                a,
                AdvancedSortParams {
                    user_id,
                    entities,
                } => {
                    assert_eq!(user_id.as_ref(), "macro|test@example.com");
                    assert_eq!(entities.len(), 500);
                    true
                }
            )
        })
        .times(1)
        .returning(|params| {
            let res = Ok(params
                .entities
                .iter()
                .map(|v| soup_document(&v.entity_id))
                .map(SoupItem::Document)
                .collect());

            Box::pin(async move { res })
        });

    let res = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(frecency_mock),
        NoopEmailService,
        NoopCommsService,
    )
    .get_user_soup(SoupRequest {
        email_preview_view: PreviewView::StandardLabel(
            email::domain::models::PreviewViewStandardLabel::Inbox,
        ),
        link_id: Some(Uuid::new_v4()),
        soup_type: SoupType::UnExpanded,
        limit: u16::MAX,
        cursor: SoupQuery::new_sort_frecency(Frecency, EntityFilters::default()),
        user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
    })
    .await
    .unwrap()
    .type_erase();

    dbg!(&res);

    assert_eq!(res.items.len(), 500);
    assert!(res.items.is_sorted_by_key(|a| {
        std::cmp::Reverse(OrderedFloat(
            a.frecency_score
                .as_ref()
                .map(|f| f.data.frecency_score)
                .unwrap_or_default(),
        ))
    }));
}

#[tokio::test]
async fn frecency_should_fallback() {
    let mut frecency = MockFrecencyQueryService::new();
    frecency
        .expect_get_frecency_page()
        .withf(|params| assert_matches!(params, FrecencyPageRequest { limit: 100, .. } => true))
        .times(1)
        .returning(|_params| {
            let iter = (1..=25).map(|v| {
                AggregateFrecency::new_mock(
                    EntityType::Document
                        .with_entity_string(uuid::Uuid::from_u128(v as u128).to_string()),
                    v as f64,
                )
            });
            let res = Ok(FrecencyPageResponse::new_mock(iter));
            Box::pin(async move { res })
        });

    let mut soup = MockSoupRepo::new();
    soup.expect_unexpanded_soup_by_ids()
        .times(1)
        .returning(|params| {
            let vec = params
                .entities
                .iter()
                .map(|id| soup_document(&id.entity_id))
                .map(SoupItem::Document)
                .collect();
            Box::pin(async move { Ok(vec) })
        });
    soup.expect_unexpanded_generic_cursor_soup()
        .withf(|params| {
            assert_matches!(
                params,
                SimpleSortRequest {
                    limit: 75,
                    cursor: SimpleSortQuery::FilterFrecency(Query::Sort(SimpleSortMethod::UpdatedAt, Frecency)),
                    ..
                } => {
                    true
                }
            )
        })
        .times(1)
        .returning(|_| {
            let iter = (26..=200)
                .map(|v| {
                    soup_document_with_updated(
                        &uuid::Uuid::from_u128(v as u128).to_string(),
                        DateTime::default() + Days::new(v),
                    )
                })
                .map(SoupItem::Document)
                .collect();
            let res = Ok(iter);
            Box::pin(async move { res })
        });

    let res = SoupImpl::new(soup, frecency, NoopEmailService, NoopCommsService)
        .get_user_soup(SoupRequest {
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_id: Some(Uuid::new_v4()),
            soup_type: SoupType::UnExpanded,
            limit: 100,
            cursor: SoupQuery::new_sort_frecency(Frecency, EntityFilters::default()),
            user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        })
        .await
        .unwrap()
        .unwrap_right();

    // output should be the limit
    assert_eq!(res.items.len(), 100);
    // first 25 items should be frecency
    res.items.get(0..25).unwrap().iter().for_each(|v| {
        assert!(v.frecency_score.is_some());
    });
    // last 75 items should be updated at
    res.items.get(25..100).unwrap().iter().for_each(|v| {
        assert!(v.frecency_score.is_none());
    });
    // cursor should encode correct info
    let typed_cursor: CursorWithValAndFilter<String, Frecency, EntityFilters> =
        res.next_cursor.unwrap().decode_json().unwrap();
    assert_matches!(
        typed_cursor,
        CursorWithValAndFilter { id, limit: 100, val: CursorVal { sort_type: Frecency, last_val: FrecencyValue::UpdatedAt(updated) }, filter: _ } => {
        let expected_uuid_str = Uuid::from_u128(100).to_string();
        assert_eq!(id, expected_uuid_str);
        assert_eq!(updated, <DateTime<Utc>>::default() + Days::new(100));

    });
}

#[tokio::test]
async fn frecency_should_paginate() {
    let mut frecency = MockFrecencyQueryService::new();
    let mut soup = MockSoupRepo::new();

    frecency
        .expect_get_frecency_page()
        .withf(|params| assert_matches!(params, FrecencyPageRequest { limit: 100, .. } => true))
        .times(1)
        .returning(|params| {
            let iter = (1..=params.limit).map(|v| {
                AggregateFrecency::new_mock(
                    EntityType::Document
                        .with_entity_string(uuid::Uuid::from_u128(v as u128).to_string()),
                    v.into(),
                )
            });
            let res = Ok(FrecencyPageResponse::new_mock(iter));
            Box::pin(async move { res })
        });

    soup.expect_unexpanded_soup_by_ids()
        .times(1)
        .returning(|params| {
            let vec = params
                .entities
                .iter()
                .map(|id| soup_document(&id.entity_id))
                .map(SoupItem::Document)
                .collect();
            Box::pin(async move { Ok(vec) })
        });

    let res = SoupImpl::new(soup, frecency, NoopEmailService, NoopCommsService)
        .get_user_soup(SoupRequest {
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_id: Some(Uuid::new_v4()),
            soup_type: SoupType::UnExpanded,
            limit: 100,
            cursor: SoupQuery::new_sort_frecency(Frecency, EntityFilters::default()),
            user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        })
        .await
        .unwrap()
        .unwrap_right();

    // output should be the limit
    assert_eq!(res.items.len(), 100);

    // first all items should be frecency
    assert!(
        res.items
            .get(0..100)
            .unwrap()
            .iter()
            .all(|v| v.frecency_score.is_some())
    );

    // cursor should encode correct info
    let typed_cursor: CursorWithValAndFilter<String, Frecency, EntityFilters> =
        res.next_cursor.unwrap().decode_json().unwrap();
    assert_matches!(
        typed_cursor,
        CursorWithValAndFilter { id, limit: 100, val: CursorVal { sort_type: Frecency, last_val: FrecencyValue::FrecencyScore(score) }, filter: _} => {
        let expected_uuid_str = Uuid::from_u128(1).to_string();
        assert_eq!(id, expected_uuid_str);
        // last item should be the lowest score because we sort desc
        assert_eq!(score as u32, 1u32);
    });
}

#[tokio::test]
async fn frecency_should_resume_cursor() {
    let mut frecency = MockFrecencyQueryService::new();
    let mut soup = MockSoupRepo::new();

    frecency
        .expect_get_frecency_page()
        .withf(|params| assert_matches!(params, FrecencyPageRequest { limit: 100, .. } => true))
        .times(1)
        .returning(|params| {
            let iter = (1..=params.limit).map(|v| {
                AggregateFrecency::new_mock(
                    EntityType::Document
                        .with_entity_string(uuid::Uuid::from_u128(v as u128).to_string()),
                    5.0 - (f64::from(v) / params.limit as f64),
                )
            });
            let res = Ok(FrecencyPageResponse::new_mock(iter));
            Box::pin(async move { res })
        });

    soup.expect_unexpanded_soup_by_ids()
        .times(1)
        .returning(|params| {
            let vec = params
                .entities
                .iter()
                .map(|id| soup_document(&id.entity_id))
                .map(SoupItem::Document)
                .collect();
            Box::pin(async move { Ok(vec) })
        });

    let res = SoupImpl::new(soup, frecency, NoopEmailService, NoopCommsService)
        .get_user_soup(SoupRequest {
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_id: Some(Uuid::new_v4()),
            soup_type: SoupType::UnExpanded,
            limit: 100,
            cursor: SoupQuery::new_cursor_frecency(CursorWithValAndFilter {
                id: Uuid::from_u128(5),
                limit: 100,
                val: CursorVal {
                    sort_type: Frecency,
                    last_val: FrecencyValue::FrecencyScore(5.0),
                },
                filter: Default::default(),
            }),
            user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        })
        .await
        .unwrap()
        .unwrap_right();

    // first all items should be frecency
    assert!(
        res.items
            .get(0..100)
            .unwrap()
            .iter()
            .all(|v| v.frecency_score.is_some())
    );

    // cursor should encode correct info
    let typed_cursor: CursorWithValAndFilter<String, Frecency, EntityFilters> =
        res.next_cursor.unwrap().decode_json().unwrap();
    assert_matches!(
        typed_cursor,
        CursorWithValAndFilter { id, limit: 100, val: CursorVal { sort_type: Frecency, last_val: FrecencyValue::FrecencyScore(score) }, filter: _} => {
        let expected_uuid_str = Uuid::from_u128(100).to_string();  // "next-100" -> 100
        assert_eq!(id, expected_uuid_str);
        // last item should be the lowest score because we sort desc
        assert_eq!(score as u32, 4u32);
    });
}

#[tokio::test]
async fn frecency_fallback_cursor_should_resume() {
    let frecency = MockFrecencyQueryService::new();
    let mut soup = MockSoupRepo::new();

    soup.expect_unexpanded_generic_cursor_soup()
        .withf(|params| {
            assert_matches!(
                params,
                SimpleSortRequest {
                    limit: 100,
                    cursor: SimpleSortQuery::FilterFrecency(Query::Cursor(Cursor {
                        id,
                        limit: 100,
                        filter: Frecency,
                        val: CursorVal {
                            sort_type: SimpleSortMethod::UpdatedAt,
                            last_val,
                        }
                    })),
                    ..
                } => {
                let expected_time = <DateTime<Utc>>::default() + Days::new(5);
                assert_eq!(last_val, &expected_time);
                let expected_uuid = Uuid::from_u128(100);
                assert_eq!(id, &expected_uuid);
                true
            })
        })
        .times(1)
        .returning(|params| {
            let iter = (1..=params.limit * 2)
                .map(|v| {
                    soup_document_with_updated(
                        &uuid::Uuid::from_u128(v as u128).to_string(),
                        DateTime::default() + Days::new(v.into()),
                    )
                })
                .map(SoupItem::Document)
                .collect();
            let res = Ok(iter);
            Box::pin(async move { res })
        });

    let res = SoupImpl::new(soup, frecency, NoopEmailService, NoopCommsService)
        .get_user_soup(SoupRequest {
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_id: Some(Uuid::new_v4()),
            soup_type: SoupType::UnExpanded,
            limit: 100,
            cursor: SoupQuery::new_cursor_frecency(CursorWithValAndFilter {
                id: Uuid::from_u128(100),
                limit: 100,
                val: CursorVal {
                    sort_type: Frecency,
                    last_val: FrecencyValue::UpdatedAt(DateTime::default() + Days::new(5)),
                },
                filter: Default::default(),
            }),
            user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        })
        .await
        .unwrap()
        .unwrap_right();

    assert!(res.items.iter().all(|v| v.frecency_score.is_none()));
    let cursor: CursorWithValAndFilter<String, Frecency, EntityFilters> =
        res.next_cursor.unwrap().decode_json().unwrap();
    assert_matches!(cursor, CursorWithValAndFilter { id, limit: 100, val: CursorVal { sort_type: Frecency, last_val: FrecencyValue::UpdatedAt(updated) }, filter: _ } => {
        let expected_uuid_str = Uuid::from_u128(100).to_string();  // "next-100" -> 100
        assert_eq!(id, expected_uuid_str);
        let expected_date = <DateTime<Utc>>::default() + Days::new(100);
        assert_eq!(updated, expected_date);
    })
}

#[tokio::test]
async fn cursor_should_return_simple_sort() {
    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_unexpanded_generic_cursor_soup()
        .withf(|a| {
            matches!(a.cursor.sort_method(), SimpleSortMethod::ViewedUpdated)
                && assert_matches!(
                    a,
                    SimpleSortRequest {
                        limit: 20,
                        user_id,
                        cursor: SimpleSortQuery::NoFilter(Query::Sort(SimpleSortMethod::ViewedUpdated, ())),
                    } => {
                        assert_eq!(user_id.as_ref(), "macro|test@example.com");
                        true
                    }
                )
        })
        .times(1)
        .returning(|_params| {
            let res = (0..100)
                .map(|i| soup_document(&format!("my-document-{i}")))
                .map(SoupItem::Document)
                .collect();
            Box::pin(async move { Ok(res) })
        });
    soup_mock
        .expect_populate_properties()
        .returning(|_| Box::pin(async { Ok(()) }));

    let res = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailService,
        NoopCommsService,
    )
    .get_user_soup(SoupRequest {
        email_preview_view: PreviewView::StandardLabel(
            email::domain::models::PreviewViewStandardLabel::Inbox,
        ),
        link_id: Some(Uuid::new_v4()),
        soup_type: SoupType::UnExpanded,
        limit: 0,
        cursor: SoupQuery::new_sort_simple(
            SimpleSortMethod::ViewedUpdated,
            EntityFilters::default(),
        ),
        user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
    })
    .await
    .unwrap();

    let simple_cursor = res.unwrap_left();
    let cursor_decoded: CursorWithValAndFilter<String, SimpleSortMethod, EntityFilters> =
        simple_cursor.next_cursor.unwrap().decode_json().unwrap();
    assert_matches!(cursor_decoded, CursorWithValAndFilter { id, limit: 20, val: CursorVal { sort_type: SimpleSortMethod::ViewedUpdated, last_val }, filter: _ } => {
        let expected_uuid_str = Uuid::from_u128(19).to_string();  // "my-document-19" -> 19
        assert_eq!(id, expected_uuid_str);
        let date: DateTime<Utc> = Default::default();
        assert_eq!(last_val, date);
    })
}

#[tokio::test]
async fn cursor_should_return_frecency() {
    let mut frecency = MockFrecencyQueryService::new();
    let mut soup = MockSoupRepo::new();

    frecency
        .expect_get_frecency_page()
        .withf(|params| assert_matches!(params, FrecencyPageRequest { limit: 100, .. } => true))
        .times(1)
        .returning(|params| {
            let iter = (1..=params.limit).map(|v| {
                AggregateFrecency::new_mock(
                    EntityType::Document
                        .with_entity_string(uuid::Uuid::from_u128(v as u128).to_string()),
                    v.into(),
                )
            });
            let res = Ok(FrecencyPageResponse::new_mock(iter));
            Box::pin(async move { res })
        });

    soup.expect_unexpanded_soup_by_ids()
        .times(1)
        .returning(|params| {
            let vec = params
                .entities
                .iter()
                .map(|id| soup_document(&id.entity_id))
                .map(SoupItem::Document)
                .collect();
            Box::pin(async move { Ok(vec) })
        });

    let res = SoupImpl::new(soup, frecency, NoopEmailService, NoopCommsService)
        .get_user_soup(SoupRequest {
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_id: Some(Uuid::new_v4()),
            soup_type: SoupType::UnExpanded,
            limit: 100,
            cursor: SoupQuery::new_sort_frecency(Frecency, EntityFilters::default()),
            user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        })
        .await
        .unwrap();

    let simple_cursor = res.unwrap_right();
    let cursor_decoded: CursorWithValAndFilter<String, Frecency, EntityFilters> =
        simple_cursor.next_cursor.unwrap().decode_json().unwrap();
    assert_matches!(cursor_decoded, CursorWithValAndFilter { id, limit: 100, val: CursorVal { sort_type: Frecency, last_val: FrecencyValue::FrecencyScore(1.0) }, filter: _ } => {
        // frecency sort is descending so the last item is id 1
        let expected_uuid_str = Uuid::from_u128(1).to_string();
        assert_eq!(id, expected_uuid_str);
    })
}

/// Helper to extract is_completed from a FrecencySoupItem
fn get_is_completed(item: &FrecencySoupItem) -> Option<bool> {
    match &item.item {
        SoupItem::Document(doc) => doc.sub_type.as_ref().and_then(|st| st.is_task_completed()),
        _ => None,
    }
}

#[tokio::test]
async fn it_should_return_is_completed_true_for_completed_tasks() {
    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_unexpanded_generic_cursor_soup()
        .times(1)
        .returning(|_params| {
            Box::pin(async move {
                Ok(vec![SoupItem::Document(soup_document_with_is_completed(
                    Uuid::from_u128(1),
                    Default::default(),
                    Some(true),
                ))])
            })
        });
    soup_mock
        .expect_populate_properties()
        .returning(|_| Box::pin(async { Ok(()) }));

    let res = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailService,
        NoopCommsService,
    )
    .get_user_soup(SoupRequest {
        email_preview_view: PreviewView::StandardLabel(
            email::domain::models::PreviewViewStandardLabel::Inbox,
        ),
        link_id: Some(Uuid::new_v4()),
        soup_type: SoupType::UnExpanded,
        limit: 0,
        cursor: SoupQuery::new_sort_simple(
            SimpleSortMethod::ViewedUpdated,
            EntityFilters::default(),
        ),
        user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
    })
    .await
    .unwrap()
    .type_erase();

    assert_eq!(res.items.len(), 1);
    assert_eq!(get_is_completed(res.items.first().unwrap()), Some(true));
}

#[tokio::test]
async fn it_should_return_is_completed_false_for_incomplete_tasks() {
    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_unexpanded_generic_cursor_soup()
        .times(1)
        .returning(|_params| {
            Box::pin(async move {
                Ok(vec![SoupItem::Document(soup_document_with_is_completed(
                    Uuid::from_u128(1),
                    Default::default(),
                    Some(false),
                ))])
            })
        });
    soup_mock
        .expect_populate_properties()
        .returning(|_| Box::pin(async { Ok(()) }));

    let res = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailService,
        NoopCommsService,
    )
    .get_user_soup(SoupRequest {
        email_preview_view: PreviewView::StandardLabel(
            email::domain::models::PreviewViewStandardLabel::Inbox,
        ),
        link_id: Some(Uuid::new_v4()),
        soup_type: SoupType::UnExpanded,
        limit: 0,
        cursor: SoupQuery::new_sort_simple(
            SimpleSortMethod::ViewedUpdated,
            EntityFilters::default(),
        ),
        user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
    })
    .await
    .unwrap()
    .type_erase();

    assert_eq!(res.items.len(), 1);
    assert_eq!(get_is_completed(res.items.first().unwrap()), Some(false));
}

#[tokio::test]
async fn it_should_return_is_completed_none_for_non_tasks() {
    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_unexpanded_generic_cursor_soup()
        .times(1)
        .returning(|_params| {
            Box::pin(async move {
                Ok(vec![SoupItem::Document(soup_document_with_is_completed(
                    Uuid::from_u128(1),
                    Default::default(),
                    None,
                ))])
            })
        });
    soup_mock
        .expect_populate_properties()
        .returning(|_| Box::pin(async { Ok(()) }));

    let res = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailService,
        NoopCommsService,
    )
    .get_user_soup(SoupRequest {
        email_preview_view: PreviewView::StandardLabel(
            email::domain::models::PreviewViewStandardLabel::Inbox,
        ),
        link_id: Some(Uuid::new_v4()),
        soup_type: SoupType::UnExpanded,
        limit: 0,
        cursor: SoupQuery::new_sort_simple(
            SimpleSortMethod::ViewedUpdated,
            EntityFilters::default(),
        ),
        user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
    })
    .await
    .unwrap()
    .type_erase();

    assert_eq!(res.items.len(), 1);
    assert_eq!(get_is_completed(res.items.first().unwrap()), None);
}

#[tokio::test]
async fn it_should_preserve_is_completed_for_mixed_items() {
    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_unexpanded_generic_cursor_soup()
        .times(1)
        .returning(|_params| {
            Box::pin(async move {
                Ok(vec![
                    SoupItem::Document(soup_document_with_is_completed(
                        Uuid::from_u128(1),
                        Default::default(),
                        Some(true),
                    )),
                    SoupItem::Document(soup_document_with_is_completed(
                        Uuid::from_u128(2),
                        Default::default(),
                        Some(false),
                    )),
                    SoupItem::Document(soup_document_with_is_completed(
                        Uuid::from_u128(3),
                        Default::default(),
                        None,
                    )),
                ])
            })
        });
    soup_mock
        .expect_populate_properties()
        .returning(|_| Box::pin(async { Ok(()) }));

    let res = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailService,
        NoopCommsService,
    )
    .get_user_soup(SoupRequest {
        email_preview_view: PreviewView::StandardLabel(
            email::domain::models::PreviewViewStandardLabel::Inbox,
        ),
        link_id: Some(Uuid::new_v4()),
        soup_type: SoupType::UnExpanded,
        limit: 0,
        cursor: SoupQuery::new_sort_simple(
            SimpleSortMethod::ViewedUpdated,
            EntityFilters::default(),
        ),
        user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
    })
    .await
    .unwrap()
    .type_erase();

    assert_eq!(res.items.len(), 3);
    assert_eq!(get_is_completed(&res.items[0]), Some(true));
    assert_eq!(get_is_completed(&res.items[1]), Some(false));
    assert_eq!(get_is_completed(&res.items[2]), None);
}

#[tokio::test]
async fn it_should_preserve_is_completed_in_by_ids_queries() {
    let mut frecency = MockFrecencyQueryService::new();
    frecency
        .expect_get_frecency_page()
        .withf(|params| assert_matches!(params, FrecencyPageRequest { limit: 20, .. } => true))
        .times(1)
        .returning(|params| {
            // Return 20 items to match the limit and avoid fallback
            let iter = (1..=params.limit).map(|v| {
                AggregateFrecency::new_mock(
                    EntityType::Document
                        .with_entity_string(uuid::Uuid::from_u128(v as u128).to_string()),
                    v.into(),
                )
            });
            let res = Ok(FrecencyPageResponse::new_mock(iter));
            Box::pin(async move { res })
        });

    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_unexpanded_soup_by_ids()
        .times(1)
        .returning(|params| {
            let res = Ok(params
                .entities
                .iter()
                .enumerate()
                .map(|(idx, v)| {
                    // Set is_completed on first 3 items to test the field
                    let is_completed = match idx {
                        0 => Some(true),
                        1 => Some(false),
                        2 => None,
                        _ => None,
                    };
                    soup_document_with_is_completed(
                        Uuid::parse_str(&v.entity_id).unwrap(),
                        Default::default(),
                        is_completed,
                    )
                })
                .map(SoupItem::Document)
                .collect());
            Box::pin(async move { res })
        });

    let res = SoupImpl::new(soup_mock, frecency, NoopEmailService, NoopCommsService)
        .get_user_soup(SoupRequest {
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::Inbox,
            ),
            link_id: Some(Uuid::new_v4()),
            soup_type: SoupType::UnExpanded,
            limit: 3,
            cursor: SoupQuery::new_sort_frecency(Frecency, EntityFilters::default()),
            user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        })
        .await
        .unwrap()
        .unwrap_right();

    // Should have 20 items, verify is_completed values are preserved
    assert_eq!(res.items.len(), 20);
    let is_completed_values: Vec<Option<bool>> = res.items.iter().map(get_is_completed).collect();
    // Verify that all three is_completed values (true, false, None) are present
    assert!(
        is_completed_values.contains(&Some(true)),
        "Should contain is_completed=true"
    );
    assert!(
        is_completed_values.contains(&Some(false)),
        "Should contain is_completed=false"
    );
    assert!(
        is_completed_values.contains(&None),
        "Should contain is_completed=None"
    );
}
