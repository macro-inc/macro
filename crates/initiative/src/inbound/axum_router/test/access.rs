use super::*;

#[tokio::test]
async fn unassign_rejects_task_without_edit_access() {
    let service = FakeInitiativeService::default();
    let response = send(
        build_router(
            service.clone(),
            FakeEntityAccessService::denying_document(TASK_DENIED, || AccessError::Unauthorized),
        ),
        authed(axum::http::Request::delete(format!(
            "/{}/tasks/{TASK_DENIED}",
            existing_id()
        )))
        .body(axum::body::Body::empty())
        .expect("request"),
    )
    .await;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(service.calls().is_empty());
}

#[tokio::test]
async fn assign_rejects_oversized_batch_before_access_lookup() {
    let task_ids: Vec<String> = (0..=crate::domain::models::MAX_TASKS_PER_ASSIGN)
        .map(|i| format!("task-{i}"))
        .collect();
    let service = FakeInitiativeService::default();
    let response = send(
        build_router(
            service.clone(),
            FakeEntityAccessService::denying_document("task-0", || {
                AccessError::internal("access must not run")
            }),
        ),
        authed(axum::http::Request::put(format!(
            "/{}/tasks",
            existing_id()
        )))
        .header(header::CONTENT_TYPE, "application/json")
        .body(json_body(serde_json::json!({"taskIds": task_ids})))
        .expect("request"),
    )
    .await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(service.calls().is_empty());
}

#[tokio::test]
async fn assign_deduplicates_before_sending_capabilities_to_the_service() {
    let response = send(
        build_router(FakeInitiativeService::default(), FakeEntityAccessService::default()),
        authed(axum::http::Request::put(format!("/{}/tasks", existing_id())))
            .header(header::CONTENT_TYPE, "application/json")
            .body(json_body(serde_json::json!({"taskIds": vec![TASK_OK; crate::domain::models::MAX_TASKS_PER_ASSIGN + 1]}))).expect("request"),
    ).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        read_json(response).await,
        serde_json::json!({"results": [{"taskId": TASK_OK, "status": "assigned"}]})
    );
}
