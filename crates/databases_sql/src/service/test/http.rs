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
    fn validate(
        &self,
        jwt: &str,
    ) -> Result<ValidatedIdentity, rootcause::Report<MacroAuthorizationError>> {
        let user_id = match jwt {
            "owner" => OWNER,
            "viewer" => VIEWER,
            _ => {
                return Err(rootcause::Report::new(
                    MacroAuthorizationError::InvalidCredentials,
                ));
            }
        };
        Ok(ValidatedIdentity {
            agent_id: None,
            user_id: user_id.into(),
            fusion_user_id: "fusion-sql-test".into(),
            organization_id: None,
            permissions: None,
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
