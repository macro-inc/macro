use chrono::Days;
use cool_asserts::assert_matches;
use frecency::domain::models::FrecencyPageResponse;
use frecency::domain::ports::MockFrecencyQueryService;
use frecency::domain::services::FrecencyQueryServiceImpl;
use frecency::{domain::models::AggregateFrecency, outbound::mock::MockFrecencyStorage};
use model_entity::EntityType;
use models_pagination::{
    Base64Str, Cursor, CursorVal, CursorWithVal, FrecencyValue, SimpleSortMethod,
};
use models_soup::document::SoupDocument;
use ordered_float::OrderedFloat;
use sqlx::types::chrono::{DateTime, Utc};

use crate::domain::ports::MockSoupRepo;

use super::*;

fn soup_document(id: String) -> SoupDocument {
    soup_document_with_updated(id, Default::default())
}

fn soup_document_with_updated(id: String, updated_at: DateTime<Utc>) -> SoupDocument {
    SoupDocument {
        id,
        document_version_id: 1,
        owner_id: "macro|test@example.com".to_string(),
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
                        cursor: models_pagination::Query::Sort(SimpleSortMethod::ViewedUpdated),
                        exclude
                    } => {
                        assert_matches!(exclude, []);
                        assert_eq!(user_id.as_ref(), "macro|test@example.com");
                        true
                    }
                )
        })
        .times(1)
        .returning(|_params| {
            Box::pin(async move {
                Ok(Some(soup_document("my-document".to_string()))
                    .into_iter()
                    .cycle()
                    .take(10)
                    .map(SoupItem::Document)
                    .collect())
            })
        });

    let res = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
    )
    .get_user_soup(SoupRequest {
        soup_type: SoupType::UnExpanded,
        limit: 0,
        cursor: SoupQuery::Simple(Query::Sort(SimpleSortMethod::ViewedUpdated)),
        user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
    })
    .await
    .unwrap();

    dbg!(&res);

    assert_eq!(res.items.len(), 10)
}

#[tokio::test]
async fn it_should_query_frecency() {
    let mut frecency_mock = MockFrecencyStorage::new();
    frecency_mock
        .expect_get_top_entities()
        .times(1)
        .withf(|user_id, limit| {
            assert_eq!(user_id.as_ref(), "macro|test@example.com");
            assert_eq!(*limit, 500);
            true
        })
        .returning(|_user_id, limit| {
            Box::pin(async move {
                Ok((1..=limit)
                    .map(|i| {
                        AggregateFrecency::new_mock(
                            EntityType::Document.with_entity_string(format!("my-document-{i}")),
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
                .map(|v| soup_document(v.entity_id.to_string()))
                .map(SoupItem::Document)
                .collect());
            Box::pin(async move { res })
        });

    let res = SoupImpl::new(soup_mock, FrecencyQueryServiceImpl::new(frecency_mock))
        .get_user_soup(SoupRequest {
            soup_type: SoupType::UnExpanded,
            limit: u16::MAX,
            cursor: SoupQuery::Frecency(Query::Sort(Frecency)),
            user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        })
        .await
        .unwrap();

    dbg!(&res);

    assert_eq!(res.items.len(), 500)
}

#[tokio::test]
async fn it_should_sort_frecency_descending() {
    let mut frecency_mock = MockFrecencyStorage::new();
    frecency_mock
        .expect_get_top_entities()
        .times(1)
        .withf(|user_id, limit| {
            assert_eq!(user_id.as_ref(), "macro|test@example.com");
            assert_eq!(*limit, 500);
            true
        })
        .returning(|_user_id, limit| {
            Box::pin(async move {
                Ok((1..=limit)
                    .map(|v| {
                        AggregateFrecency::new_mock(
                            EntityType::Document.with_entity_string(format!("my-document-{v}")),
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
                .map(|v| soup_document(v.entity_id.to_string()))
                .map(SoupItem::Document)
                .collect());

            Box::pin(async move { res })
        });

    let res = SoupImpl::new(soup_mock, FrecencyQueryServiceImpl::new(frecency_mock))
        .get_user_soup(SoupRequest {
            soup_type: SoupType::UnExpanded,
            limit: u16::MAX,
            cursor: SoupQuery::Frecency(Query::Sort(Frecency)),
            user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        })
        .await
        .unwrap();

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
                    EntityType::Document.with_entity_string(format!("doc-{v}")),
                    v.into(),
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
                .map(|id| soup_document(id.entity_id.to_string()))
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
                    cursor: Query::Sort(SimpleSortMethod::UpdatedAt),
                    exclude,
                    ..
                } => {
                    assert_matches!(exclude, [SoupExclude::Frecency]);
                    true
                }
            )
        })
        .times(1)
        .returning(|_| {
            let iter = (26..=200)
                .map(|v| {
                    soup_document_with_updated(
                        format!("doc-{v}"),
                        DateTime::default() + Days::new(v),
                    )
                })
                .map(SoupItem::Document)
                .collect();
            let res = Ok(iter);
            Box::pin(async move { res })
        });

    let res = SoupImpl::new(soup, frecency)
        .get_user_soup(SoupRequest {
            soup_type: SoupType::UnExpanded,
            limit: 100,
            cursor: SoupQuery::Frecency(Query::Sort(Frecency)),
            user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        })
        .await
        .unwrap();

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
    let typed_cursor =
        <Base64Str<CursorWithVal<String, Frecency>>>::new_from_string(res.next_cursor.unwrap())
            .decode_json()
            .unwrap();
    assert_matches!(
        typed_cursor,
        Cursor { id, limit: 100, val: CursorVal { sort_type: Frecency, last_val: FrecencyValue::UpdatedAt(updated) }} => {
        assert_eq!(id, "doc-100");
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
                    EntityType::Document.with_entity_string(format!("doc-{v}")),
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
                .map(|id| soup_document(id.entity_id.to_string()))
                .map(SoupItem::Document)
                .collect();
            Box::pin(async move { Ok(vec) })
        });

    let res = SoupImpl::new(soup, frecency)
        .get_user_soup(SoupRequest {
            soup_type: SoupType::UnExpanded,
            limit: 100,
            cursor: SoupQuery::Frecency(Query::Sort(Frecency)),
            user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        })
        .await
        .unwrap();

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
    let typed_cursor =
        <Base64Str<CursorWithVal<String, Frecency>>>::new_from_string(res.next_cursor.unwrap())
            .decode_json()
            .unwrap();
    assert_matches!(
        typed_cursor,
        Cursor { id, limit: 100, val: CursorVal { sort_type: Frecency, last_val: FrecencyValue::FrecencyScore(score) }} => {
        assert_eq!(id, "doc-1");
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
                    EntityType::Document.with_entity_string(format!("doc-next-{v}")),
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
                .map(|id| soup_document(id.entity_id.to_string()))
                .map(SoupItem::Document)
                .collect();
            Box::pin(async move { Ok(vec) })
        });

    let res = SoupImpl::new(soup, frecency)
        .get_user_soup(SoupRequest {
            soup_type: SoupType::UnExpanded,
            limit: 100,
            cursor: SoupQuery::Frecency(Query::Cursor(Cursor {
                id: "doc-5".to_string(),
                limit: 100,
                val: CursorVal {
                    sort_type: Frecency,
                    last_val: FrecencyValue::FrecencyScore(5.0),
                },
            })),
            user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        })
        .await
        .unwrap();

    // first all items should be frecency
    assert!(
        res.items
            .get(0..100)
            .unwrap()
            .iter()
            .all(|v| v.frecency_score.is_some())
    );

    // cursor should encode correct info
    let typed_cursor =
        <Base64Str<CursorWithVal<String, Frecency>>>::new_from_string(res.next_cursor.unwrap())
            .decode_json()
            .unwrap();
    assert_matches!(
        typed_cursor,
        Cursor { id, limit: 100, val: CursorVal { sort_type: Frecency, last_val: FrecencyValue::FrecencyScore(score) }} => {
        assert_eq!(id, "doc-next-100");
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
            assert_matches!(params, SimpleSortRequest { limit: 100, cursor: Query::Cursor(Cursor { id, limit: 100, val: CursorVal { sort_type: SimpleSortMethod::UpdatedAt, last_val } }), exclude, .. } => {
                assert_matches!(exclude, [SoupExclude::Frecency]);
                let expected_time = <DateTime<Utc>>::default() + Days::new(5);
                assert_eq!(last_val, &expected_time);
                assert_eq!(id, "doc-100");
                true
            })
        })
        .times(1)
        .returning(|params| {
            let iter = (1..=params.limit * 2)
                .map(|v| {
                    soup_document_with_updated(
                        format!("doc-next-{v}"),
                        DateTime::default() + Days::new(v.into()),
                    )
                })
                .map(SoupItem::Document)
                .collect();
            let res = Ok(iter);
            Box::pin(async move { res })
        });

    let res = SoupImpl::new(soup, frecency)
        .get_user_soup(SoupRequest {
            soup_type: SoupType::UnExpanded,
            limit: 100,
            cursor: SoupQuery::Frecency(Query::Cursor(Cursor {
                id: "doc-100".to_string(),
                limit: 100,
                val: CursorVal {
                    sort_type: Frecency,
                    last_val: FrecencyValue::UpdatedAt(DateTime::default() + Days::new(5)),
                },
            })),
            user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        })
        .await
        .unwrap();

    assert!(res.items.iter().all(|v| v.frecency_score.is_none()));
    let cursor =
        <Base64Str<CursorWithVal<String, Frecency>>>::new_from_string(res.next_cursor.unwrap())
            .decode_json()
            .unwrap();
    assert_matches!(cursor, Cursor { id, limit: 100, val: CursorVal { sort_type: Frecency, last_val: FrecencyValue::UpdatedAt(updated) } } => {
        assert_eq!(id, "doc-next-100");
        let expected_date = <DateTime<Utc>>::default() + Days::new(100);
        assert_eq!(updated, expected_date);
    })
}
