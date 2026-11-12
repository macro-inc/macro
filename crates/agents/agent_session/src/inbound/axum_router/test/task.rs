use super::*;
use crate::domain::session_task::{LinkedTask, SessionTaskError, SessionTasks, TaskPullRequests};

type BoxFuture<'a, T> = std::pin::Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Links a task only for `OWNER`, recording every call.
#[derive(Default)]
struct OwnerOnlyTasks {
    calls: Mutex<Vec<(AgentSessionId, String, String)>>,
}

impl SessionTasks for OwnerOnlyTasks {
    fn link_task<'a>(
        &'a self,
        session: AgentSessionId,
        owner: &'a MacroUserIdStr<'static>,
        task: &'a str,
    ) -> BoxFuture<'a, Result<LinkedTask, SessionTaskError>> {
        self.calls
            .lock()
            .unwrap()
            .push((session, owner.as_ref().to_owned(), task.to_owned()));
        Box::pin(async move {
            if owner.as_ref() != OWNER {
                return Err(AgentSessionError::Forbidden.into());
            }
            if task == "0197d5c4-0000-7000-8000-000000000404" {
                return Err(SessionTaskError::TaskNotFound);
            }
            Ok(LinkedTask {
                task_id: task.to_owned(),
                title: "Fix the thing".into(),
                url: format!("https://macro.com/app/task/{task}"),
                reference: "MACRO-abc".into(),
                mention: "<m-document-mention></m-document-mention>".into(),
                pull_request: Some("https://github.com/acme/web/pull/7".into()),
            })
        })
    }

    fn task_pull_requests<'a>(
        &'a self,
        _: &'a MacroUserIdStr<'static>,
        _: &'a str,
    ) -> BoxFuture<'a, Result<TaskPullRequests, SessionTaskError>> {
        Box::pin(async { unreachable!("not routed") })
    }

    fn link_session_pull_request<'a>(
        &'a self,
        _: AgentSessionId,
        _: &'a MacroUserIdStr<'static>,
    ) -> BoxFuture<'a, Result<(), SessionTaskError>> {
        Box::pin(async { unreachable!("not routed") })
    }
}

fn task_router(tasks: Arc<OwnerOnlyTasks>) -> Router {
    let auth = MacroAuthorizationServiceImpl::new(
        FakeJwtValidator,
        InternalAuthConfig {
            api_key: "test-internal-key".into(),
            default_user_id: None,
        },
        SelfBotAuthorizer,
        NoUserApiKeyAuthorizer,
    );
    crate::inbound::axum_router::task::agent_session_task_router(AgentSessionRouterState::new(
        tasks as Arc<dyn SessionTasks>,
        Arc::new(entity_access::domain::ports::NoOpEntityAccessService),
        MacroAuthorizationState::new(Arc::new(auth)),
    ))
}

async fn link(router: &Router, caller: &str, session: &str, body: &str) -> Response {
    router
        .clone()
        .oneshot(
            Request::put(format!("/{session}/task"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::AUTHORIZATION, format!("Bearer {caller}"))
                .body(Body::from(body.to_owned()))
                .unwrap(),
        )
        .await
        .unwrap()
}

#[tokio::test]
async fn owner_links_a_session_to_a_task_and_gets_its_pull_request_reference() {
    let tasks = Arc::new(OwnerOnlyTasks::default());
    let router = task_router(tasks.clone());

    let response = link(
        &router,
        OWNER,
        "0197d5c4-0000-7000-8000-000000000001",
        r#"{"taskId":"0197d5c4-0000-7000-8000-0000000000aa"}"#,
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), 8192)
        .await
        .unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
        serde_json::json!({
            "taskId": "0197d5c4-0000-7000-8000-0000000000aa",
            "reference": "MACRO-abc",
            "pullRequestUrl": "https://github.com/acme/web/pull/7",
        })
    );
    assert_eq!(
        *tasks.calls.lock().unwrap(),
        vec![(
            AgentSessionId::new_from_uuid(
                Uuid::parse_str("0197d5c4-0000-7000-8000-000000000001").unwrap()
            ),
            OWNER.to_owned(),
            "0197d5c4-0000-7000-8000-0000000000aa".to_owned(),
        )]
    );
}

#[tokio::test]
async fn linking_answers_forbidden_not_found_and_bad_request() {
    let router = task_router(Arc::new(OwnerOnlyTasks::default()));

    let stranger = link(
        &router,
        STRANGER,
        "0197d5c4-0000-7000-8000-000000000001",
        r#"{"taskId":"0197d5c4-0000-7000-8000-0000000000aa"}"#,
    )
    .await;
    assert_eq!(stranger.status(), StatusCode::FORBIDDEN);

    let missing = link(
        &router,
        OWNER,
        "0197d5c4-0000-7000-8000-000000000001",
        r#"{"taskId":"0197d5c4-0000-7000-8000-000000000404"}"#,
    )
    .await;
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);

    let not_an_id = link(
        &router,
        OWNER,
        "0197d5c4-0000-7000-8000-000000000001",
        r#"{"taskId":"MACRO-abc"}"#,
    )
    .await;
    assert_eq!(not_an_id.status(), StatusCode::UNPROCESSABLE_ENTITY);
}
