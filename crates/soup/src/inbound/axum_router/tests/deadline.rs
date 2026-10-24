use super::*;
use models_pagination::DueDateSort;

#[tokio::test]
async fn due_date_sort_markers_select_the_due_date_query() {
    for sort_method in ["due_date_earliest", "due_date_latest"] {
        let soup = MockSoup::succeeding();
        let calls = soup.called.clone();
        let router = mock_router_with(
            soup,
            MockEmailLinkResult {
                get_link_result: Arc::new(|| Ok(None)),
            },
        );
        let request = authenticated_request()
            .uri("/soup/ast")
            .method(Method::POST)
            .header("content-type", "application/json")
            .body(axum::body::Body::from(
                serde_json::to_vec(&json!({ "sort_method": sort_method })).unwrap(),
            ))
            .unwrap();

        let (status, _) = send_json(router, request).await;
        assert_eq!(status, StatusCode::OK);
        let calls = calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert!(matches!(calls[0].cursor_kind, MockCursorKind::DueDateSort));
    }
}

#[tokio::test]
async fn null_due_date_cursor_does_not_fall_back_to_an_initial_timestamp_query() {
    for sort_type in [DueDateSort::Earliest, DueDateSort::Latest] {
        let soup = MockSoup::succeeding();
        let calls = soup.called.clone();
        let router = mock_router_with(
            soup,
            MockEmailLinkResult {
                get_link_result: Arc::new(|| Ok(None)),
            },
        );
        let cursor = models_pagination::Base64Str::encode_json(models_pagination::Cursor {
            id: Uuid::from_u128(1),
            limit: 20,
            val: CursorVal {
                sort_type,
                last_val: None,
            },
            filter: EntityFilters::default(),
        })
        .type_erase()
        .replace('+', "%2B")
        .replace('/', "%2F")
        .replace('=', "%3D");
        let request = authenticated_request()
            .uri(format!("/soup?cursor={cursor}"))
            .method(Method::POST)
            .header("content-type", "application/json")
            .body(axum::body::Body::from("{}"))
            .unwrap();

        let (status, _) = send_json(router, request).await;
        assert_eq!(status, StatusCode::OK);
        let calls = calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert!(matches!(
            calls[0].cursor_kind,
            MockCursorKind::DueDateCursor
        ));
    }
}

#[tokio::test]
async fn deadline_grouping_preserves_timestamp_sort_and_requested_limit() {
    let soup = MockSoup::succeeding();
    let calls = soup.grouped_calls.clone();
    let router = mock_router_with(
        soup,
        MockEmailLinkResult {
            get_link_result: Arc::new(|| Ok(None)),
        },
    );
    let request = authenticated_request()
        .uri("/soup/ast/grouped")
        .method(Method::POST)
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::to_vec(&json!({
                "mode": "initial",
                "group_by": { "deadline": {
                    "today": "2026-03-08T05:00:00Z",
                    "tomorrow": "2026-03-09T04:00:00Z",
                    "day_two": "2026-03-10T04:00:00Z",
                    "day_eight": "2026-03-16T04:00:00Z"
                }},
                "sort_method": "updated_at",
                "per_group_limit": 25
            }))
            .unwrap(),
        ))
        .unwrap();
    let (status, _) = send_json(router, request).await;
    assert_eq!(status, StatusCode::OK);
    let calls = calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0.per_group_limit, Some(25));
    assert!(matches!(
        calls[0].0.field,
        models_grouping::GroupByField::Deadline { .. }
    ));
    assert!(matches!(
        calls[0].1,
        crate::domain::models::GroupedSortMethod::Timestamp(SimpleSortMethod::UpdatedAt)
    ));
}

#[tokio::test]
async fn due_date_group_sort_dispatches_to_the_task_service() {
    let soup = MockSoup::succeeding();
    let calls = soup.grouped_calls.clone();
    let router = mock_router_with(
        soup,
        MockEmailLinkResult {
            get_link_result: Arc::new(|| Ok(None)),
        },
    );
    let request = authenticated_request()
        .uri("/soup/ast/grouped")
        .method(Method::POST)
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::to_vec(&json!({
                "mode": "initial",
                "group_by": "entity_type",
                "sort_method": "due_date_latest",
                "per_group_limit": 25
            }))
            .unwrap(),
        ))
        .unwrap();
    let (status, _) = send_json(router, request).await;
    assert_eq!(status, StatusCode::OK);
    let calls = calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert!(matches!(
        calls[0].1,
        crate::domain::models::GroupedSortMethod::DueDate(DueDateSort::Latest)
    ));
}

#[tokio::test]
async fn changed_deadline_boundaries_cannot_restart_a_group_continuation() {
    use crate::domain::models::due_date::GroupedDueDateContext;
    let boundaries = models_grouping::DeadlineBoundaries {
        today: "2026-03-08T05:00:00Z".parse().unwrap(),
        tomorrow: "2026-03-09T04:00:00Z".parse().unwrap(),
        day_two: "2026-03-10T04:00:00Z".parse().unwrap(),
        day_eight: "2026-03-16T04:00:00Z".parse().unwrap(),
    };
    let cursor = models_pagination::Base64Str::encode_json(CursorWithValAndFilter {
        id: Uuid::from_u128(1),
        limit: 25,
        val: CursorVal {
            sort_type: SimpleSortMethod::UpdatedAt,
            last_val: "2026-03-08T12:00:00Z".parse().unwrap(),
        },
        filter: GroupedDueDateContext {
            filters: EntityFilterAst::default(),
            grouping: models_grouping::GroupingConfig {
                field: models_grouping::GroupByField::Deadline { boundaries },
                group_key: Some("today".to_owned()),
                per_group_limit: Some(25),
            },
        },
    })
    .type_erase()
    .replace('+', "%2B")
    .replace('/', "%2F")
    .replace('=', "%3D");
    let soup = MockSoup::succeeding();
    let calls = soup.grouped_calls.clone();
    let router = mock_router_with(
        soup,
        MockEmailLinkResult {
            get_link_result: Arc::new(|| Ok(None)),
        },
    );
    let request = authenticated_request()
        .uri(format!("/soup/ast/grouped?cursor={cursor}"))
        .method(Method::POST)
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::to_vec(&json!({
                "mode": "group_page",
                "group_key": "today",
                "group_by": { "deadline": {
                    "today": "2026-03-09T04:00:00Z",
                    "tomorrow": "2026-03-10T04:00:00Z",
                    "day_two": "2026-03-11T04:00:00Z",
                    "day_eight": "2026-03-17T04:00:00Z"
                }}
            }))
            .unwrap(),
        ))
        .unwrap();
    let (status, _) = send_json(router, request).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(calls.lock().unwrap().is_empty());
}
