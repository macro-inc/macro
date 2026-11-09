use super::*;
use crate::inbound::axum_router::{SqlRouterState, sql_router};
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use macro_authorization::{
    InternalAuthConfig, JwtValidator, MacroAuthorizationError, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, NoBotAuthorizer, NoUserApiKeyAuthorizer, ValidatedIdentity,
};
use serde_json::{Value, json};
use tower::ServiceExt;

#[derive(Clone, Copy)]
struct Token;

impl JwtValidator for Token {
    fn validate_credential(
        &self,
        jwt: &str,
    ) -> Result<macro_authorization::ValidatedCredential, rootcause::Report<MacroAuthorizationError>>
    {
        let user_id = match jwt {
            "owner" => OWNER,
            "viewer" => VIEWER,
            _ => {
                return Err(rootcause::Report::new(
                    MacroAuthorizationError::InvalidCredentials,
                ));
            }
        };
        Ok(macro_authorization::ValidatedCredential {
            origin: macro_authorization::CredentialOrigin::Session,
            identity: ValidatedIdentity {
                agent_id: None,
                agent_via: None,
                user_id: user_id.into(),
                fusion_user_id: "fusion-sql-test".into(),
                organization_id: None,
                permissions: None,
            },
        })
    }
}

fn app(world: &Shared) -> Router {
    let authorization = MacroAuthorizationState::new(Arc::new(MacroAuthorizationServiceImpl::new(
        Token,
        InternalAuthConfig {
            api_key: "test-internal-key".into(),
            default_user_id: None,
        },
        NoBotAuthorizer,
        NoUserApiKeyAuthorizer,
    )));
    Router::new().nest(
        "/databases",
        sql_router(SqlRouterState::new(sql(world), authorization)),
    )
}

async fn query(router: Router, token: Option<&str>, body: Value) -> (StatusCode, Value) {
    let mut request = Request::post("/databases/query").header("content-type", "application/json");
    if let Some(token) = token {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    let response = router
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let body = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (status, serde_json::from_slice(&body).unwrap())
}

#[tokio::test]
async fn sql_http_requires_authentication_before_running_a_statement() {
    let world = world();
    for token in [None, Some("invalid")] {
        let (status, _) = query(app(&world), token, json!({"sql":"SELECT * FROM Guests"})).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }
    assert!(world.lock().unwrap().soup_reads.is_empty());
    assert!(world.lock().unwrap().applied.is_empty());
}

#[tokio::test]
async fn sql_http_returns_typed_cells_scope_and_versions_for_the_viewer() {
    let world = world();
    let (status, response) = query(
        app(&world),
        Some("viewer"),
        json!({"sql":"SELECT \"Name\" FROM \"Guests\"", "databaseId":OFFSITE}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{response}");
    assert_eq!(response["result"]["rows"][0][0]["type"], "text");
    assert_eq!(response["result"]["sourceTable"], json!(GUESTS));
    assert_eq!(
        response["tableDatabases"][GUESTS.to_string()],
        json!(OFFSITE)
    );
    assert_eq!(response["readVersions"][GUESTS.to_string()], 1);
    assert_eq!(response["statement"]["kind"], "select");
    assert!(world.lock().unwrap().applied.is_empty());
}

#[tokio::test]
async fn sql_http_refuses_invisible_scope_viewer_writes_and_stale_versions() {
    let world = world();
    let (status, _) = query(
        app(&world),
        Some("owner"),
        json!({"sql":"SELECT * FROM Plans", "databaseId":SECRET}),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let update = "UPDATE \"Offsite\".\"Guests\" SET \"Status\" = 'Going' WHERE \"Name\" = 'Sam'";
    let (status, _) = query(app(&world), Some("viewer"), json!({"sql":update})).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = query(
        app(&world),
        Some("owner"),
        json!({"sql":update,"baseVersions":{GUESTS.to_string():0}}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(world.lock().unwrap().applied.is_empty());
}

#[tokio::test]
async fn sql_http_applies_an_authorized_write_once() {
    let world = world();
    world
        .lock()
        .unwrap()
        .op_answers
        .push_back(Ok(vec![OpResult::Rows {
            table: GUESTS,
            table_version: TableVersion(2),
            change: RowsResult::Updated { affected: 1 },
        }]));
    let (status, response) = query(app(&world), Some("owner"), json!({"sql":"UPDATE \"Offsite\".\"Guests\" SET \"Status\" = 'Going' WHERE \"Name\" = 'Sam'", "baseVersions":{GUESTS.to_string():1}})).await;
    assert_eq!(status, StatusCode::OK, "{response}");
    assert_eq!(response["changesApplied"], 1);
    assert_eq!(response["statement"]["tableId"], json!(GUESTS));
    assert!(response["statement"].get("table_id").is_none());
    assert_eq!(world.lock().unwrap().applied.len(), 1);
}

#[test]
fn sql_openapi_statement_fields_match_the_actual_camel_case_response() {
    // A schema mismatch here generates clients that read undefined write targets.
    let schema =
        serde_json::to_value(<crate::SqlStatement as utoipa::PartialSchema>::schema()).unwrap();
    let schema = schema.to_string();
    for field in [
        "databaseId",
        "tableId",
        "tableName",
        "columnId",
        "columnName",
    ] {
        assert!(
            schema.contains(&format!("\"{field}\"")),
            "{field}: {schema}"
        );
    }
    for field in [
        "database_id",
        "table_id",
        "table_name",
        "column_id",
        "column_name",
    ] {
        assert!(
            !schema.contains(&format!("\"{field}\"")),
            "{field}: {schema}"
        );
    }
}

async fn save(router: Router, token: Option<&str>, body: Value) -> (StatusCode, Value) {
    let mut request =
        Request::post("/databases/queries").header("content-type", "application/json");
    if let Some(token) = token {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    let response = router
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let body = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (status, serde_json::from_slice(&body).unwrap())
}

#[tokio::test]
async fn saving_a_question_over_http_requires_authentication() {
    let world = world();
    let (status, _) = save(
        app(&world),
        None,
        json!({"definition":{"version":1,"query":"SELECT COUNT(*) FROM \"Guests\""}}),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(world.lock().unwrap().saved.is_empty());
}

#[tokio::test]
async fn saving_a_question_over_http_stores_a_select_whose_chart_columns_it_returns() {
    let world = world();
    let (status, response) = save(
        app(&world),
        Some("viewer"),
        json!({
            "definition":{"version":1,"query":"SELECT \"Status\", COUNT(*) AS guests FROM \"Guests\" GROUP BY \"Status\""},
            "databaseId":OFFSITE,
            "chart":{"x":"Status","y":["guests"]},
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{response}");
    assert_eq!(response["databaseId"], json!(OFFSITE));
    assert_eq!(
        response["definition"]["query"],
        "SELECT \"Status\", COUNT(*) AS guests FROM \"Guests\" GROUP BY \"Status\""
    );
    assert_eq!(world.lock().unwrap().saved.len(), 1);
}

#[tokio::test]
async fn saving_a_question_over_http_refuses_writes_broken_sql_and_unreturned_chart_columns() {
    let world = world();
    for (body, expected) in [
        (
            json!({"definition":{"version":1,"query":"DELETE FROM \"Guests\" WHERE \"Name\" = 'Sam'"},"databaseId":OFFSITE}),
            "a saved query must be a SELECT; it cannot change data",
        ),
        (
            json!({"definition":{"version":1,"query":"SELECT statuz FROM \"Guests\""},"databaseId":OFFSITE}),
            "statuz",
        ),
        (
            json!({
                "definition":{"version":1,"query":"SELECT \"Status\", COUNT(*) AS guests FROM \"Guests\" GROUP BY \"Status\""},
                "databaseId":OFFSITE,
                "chart":{"x":"Status","y":["invites"]},
            }),
            "the chart names \"invites\"",
        ),
        (
            json!({
                "definition":{"version":1,"query":"SELECT \"Name\", \"Status\" FROM \"Guests\""},
                "databaseId":OFFSITE,
                "chart":{"x":"Name","y":["Status"]},
            }),
            "the chart plots \"Status\", which is not a number",
        ),
    ] {
        let (status, response) = save(app(&world), Some("owner"), body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{response}");
        let message = response["message"].as_str().unwrap();
        assert!(message.contains(expected), "{message}");
    }

    let (status, _) = save(
        app(&world),
        Some("owner"),
        json!({"definition":{"version":1,"query":"SELECT COUNT(*) FROM \"Plans\""},"databaseId":SECRET}),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(world.lock().unwrap().saved.is_empty());
}
