use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::FromRef;
use axum::http::{Request, StatusCode, header::AUTHORIZATION, header::CONTENT_TYPE};
use chrono::{TimeZone, Utc};
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use macro_auth::middleware::decode_jwt::{JwtValidationArgs, MacroAccessToken};
use macro_authorization::{
    InternalAuthConfig, MacroAuthJwtValidator, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, NoBotAuthorizer, NoUserApiKeyAuthorizer,
};
use saved_views::View;
use saved_views::domain::{Cursor, Error, Page, SavedViewApi, ShareChange, Update};
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;

use super::{SavedViewDefinitionsState, router};
use crate::api::context::AuthorizationService;

const VIEWER: &str = "macro|member@example.com";
const VIEW: Uuid = Uuid::from_u128(0x51);
const TEAM: Uuid = Uuid::from_u128(0x7EA);

/// What the routes asked the domain service to do.
#[derive(Debug, PartialEq)]
enum Call {
    Get(Uuid),
    List {
        kind: Option<String>,
        after: Option<(Option<i32>, Uuid)>,
        limit: u32,
    },
    Create {
        id: Uuid,
        name: String,
        team: Option<Uuid>,
    },
    Update {
        id: Uuid,
        revision: i64,
        name: Option<String>,
        share: String,
    },
    Delete {
        id: Uuid,
        revision: i64,
    },
    Reorder {
        kind: String,
        ids: Vec<Uuid>,
    },
}

/// Records calls from the viewer and answers with one view, or fails as told.
#[derive(Default)]
struct FakeSavedViews {
    calls: Mutex<Vec<Call>>,
    failure: Mutex<Option<fn() -> Error>>,
    next: Mutex<Option<Cursor>>,
}

impl FakeSavedViews {
    fn record(&self, viewer: &str, call: Call) -> Result<(), Error> {
        assert_eq!(viewer, VIEWER, "routes act as the signed-in user");
        self.calls.lock().unwrap().push(call);
        match *self.failure.lock().unwrap() {
            Some(failure) => Err(failure()),
            None => Ok(()),
        }
    }

    fn calls(&self) -> Vec<Call> {
        std::mem::take(&mut *self.calls.lock().unwrap())
    }
}

fn view(id: Uuid) -> View {
    let at = Utc.with_ymd_and_hms(2026, 11, 4, 12, 0, 0).unwrap();
    View {
        id,
        user_id: VIEWER.to_owned(),
        name: "Invoices".to_owned(),
        config: json!({ "kind": "email", "version": 1, "filters": {} }),
        created_at: at,
        updated_at: at,
        revision: 3,
        shared_team_id: Some(TEAM),
    }
}

#[async_trait::async_trait]
impl SavedViewApi for FakeSavedViews {
    async fn get(&self, viewer: &str, id: Uuid) -> Result<View, Error> {
        self.record(viewer, Call::Get(id))?;
        Ok(view(id))
    }

    async fn list(
        &self,
        viewer: &str,
        kind: Option<&str>,
        after: Option<Cursor>,
        limit: u32,
    ) -> Result<Page, Error> {
        self.record(
            viewer,
            Call::List {
                kind: kind.map(str::to_owned),
                after: after.map(|cursor| (cursor.position, cursor.id)),
                limit,
            },
        )?;
        Ok(Page {
            views: vec![view(VIEW)],
            next: self.next.lock().unwrap().take(),
        })
    }

    async fn create(
        &self,
        viewer: &str,
        id: Uuid,
        name: String,
        _config: Value,
        team: Option<Uuid>,
    ) -> Result<View, Error> {
        self.record(viewer, Call::Create { id, name, team })?;
        Ok(view(id))
    }

    async fn update(
        &self,
        viewer: &str,
        id: Uuid,
        revision: i64,
        change: Update,
    ) -> Result<View, Error> {
        let share = match change.share {
            ShareChange::Unchanged => "unchanged".to_owned(),
            ShareChange::Private => "private".to_owned(),
            ShareChange::Team(team) => format!("team {team}"),
        };
        self.record(
            viewer,
            Call::Update {
                id,
                revision,
                name: change.name,
                share,
            },
        )?;
        Ok(view(id))
    }

    async fn delete(&self, viewer: &str, id: Uuid, revision: i64) -> Result<Uuid, Error> {
        self.record(viewer, Call::Delete { id, revision })?;
        Ok(id)
    }

    async fn reorder(&self, viewer: &str, kind: &str, ids: Vec<Uuid>) -> Result<Vec<View>, Error> {
        self.record(
            viewer,
            Call::Reorder {
                kind: kind.to_owned(),
                ids: ids.clone(),
            },
        )?;
        Ok(ids.into_iter().map(view).collect())
    }
}

#[derive(Clone, FromRef)]
struct TestState {
    definitions: SavedViewDefinitionsState,
    authorization: MacroAuthorizationState<AuthorizationService>,
}

fn app(service: Arc<FakeSavedViews>) -> Router {
    let state = TestState {
        definitions: SavedViewDefinitionsState(service),
        authorization: MacroAuthorizationState::new(Arc::new(MacroAuthorizationServiceImpl::new(
            MacroAuthJwtValidator::new(JwtValidationArgs::new_testing()),
            InternalAuthConfig {
                api_key: "test-internal-key".into(),
                default_user_id: None,
            },
            NoBotAuthorizer,
            NoUserApiKeyAuthorizer,
        ))),
    };
    Router::new()
        .nest("/saved_views/definitions", router())
        .with_state(state)
}

fn user_access_token() -> String {
    let expires_in_an_hour = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as usize
        + 3_600;
    let claims = MacroAccessToken {
        aud: String::new(),
        exp: expires_in_an_hour,
        tid: "test-tenant".into(),
        iss: String::new(),
        email: "member@example.com".into(),
        fusion_user_id: "test-fusion-user".into(),
        macro_user_id: VIEWER.into(),
        macro_organization_id: None,
        root_macro_id: None,
    };
    let mut header = Header::new(Algorithm::HS256);
    header.kid = Some("test-access-token".into());
    jsonwebtoken::encode(&header, &claims, &EncodingKey::from_secret(b"")).unwrap()
}

fn request(method: &str, uri: &str, body: Option<Value>) -> Request<Body> {
    let builder = Request::builder()
        .method(method)
        .uri(uri)
        .header(AUTHORIZATION, format!("Bearer {}", user_access_token()));
    match body {
        Some(body) => builder
            .header(CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap(),
        None => builder.body(Body::empty()).unwrap(),
    }
}

async fn send(service: &Arc<FakeSavedViews>, request: Request<Body>) -> (StatusCode, Value) {
    let response = app(service.clone()).oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    // Extractor rejections (a missing query parameter) answer in plain text.
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned()))
    };
    (status, body)
}

#[tokio::test]
async fn creates_with_the_callers_id_or_a_new_one() {
    let service = Arc::new(FakeSavedViews::default());

    let (status, body) = send(
        &service,
        request(
            "POST",
            "/saved_views/definitions",
            Some(json!({ "id": VIEW, "name": "Invoices", "config": { "kind": "email" }, "sharedTeamId": TEAM })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["id"], json!(VIEW));
    assert_eq!(body["ownerId"], json!(VIEWER));
    assert_eq!(body["revision"], json!(3));
    assert_eq!(body["sharedTeamId"], json!(TEAM));

    let (status, _) = send(
        &service,
        request(
            "POST",
            "/saved_views/definitions",
            Some(json!({ "name": "Unnamed", "config": { "kind": "email" } })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let calls = service.calls();
    assert_eq!(
        calls[0],
        Call::Create {
            id: VIEW,
            name: "Invoices".into(),
            team: Some(TEAM)
        }
    );
    let Call::Create { id, team, .. } = &calls[1] else {
        panic!("expected a create, got {:?}", calls[1]);
    };
    assert_eq!(id.get_version_num(), 7, "a generated ID is a v7 UUID");
    assert_eq!(*team, None);
}

#[tokio::test]
async fn updates_change_sharing_only_when_asked() {
    let service = Arc::new(FakeSavedViews::default());
    let uri = format!("/saved_views/definitions/{VIEW}");
    for body in [
        json!({ "expectedRevision": 3, "name": "Renamed" }),
        json!({ "expectedRevision": 3, "sharing": { "teamId": null } }),
        json!({ "expectedRevision": 3, "sharing": { "teamId": TEAM } }),
    ] {
        let (status, _) = send(&service, request("PATCH", &uri, Some(body))).await;
        assert_eq!(status, StatusCode::OK);
    }

    let shares: Vec<_> = service
        .calls()
        .into_iter()
        .map(|call| match call {
            Call::Update {
                revision, share, ..
            } => (revision, share),
            other => panic!("expected an update, got {other:?}"),
        })
        .collect();
    assert_eq!(
        shares,
        vec![
            (3, "unchanged".to_owned()),
            (3, "private".to_owned()),
            (3, format!("team {TEAM}")),
        ]
    );
}

#[tokio::test]
async fn deletes_only_the_expected_revision() {
    let service = Arc::new(FakeSavedViews::default());

    let (status, _) = send(
        &service,
        request(
            "DELETE",
            &format!("/saved_views/definitions/{VIEW}?expectedRevision=3"),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        service.calls(),
        vec![Call::Delete {
            id: VIEW,
            revision: 3
        }]
    );

    let (status, _) = send(
        &service,
        request("DELETE", &format!("/saved_views/definitions/{VIEW}"), None),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(service.calls().is_empty());
}

#[tokio::test]
async fn lists_a_kind_and_resumes_from_the_next_cursor() {
    let service = Arc::new(FakeSavedViews::default());
    let last = Cursor {
        position: Some(4),
        created_at: Utc.with_ymd_and_hms(2026, 11, 1, 9, 0, 0).unwrap(),
        id: VIEW,
    };
    *service.next.lock().unwrap() = Some(last);

    let (status, page) = send(
        &service,
        request("GET", "/saved_views/definitions?kind=email&first=2", None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(page["views"][0]["name"], json!("Invoices"));
    let cursor = page["nextCursor"].as_str().unwrap().to_owned();

    let after = urlencoding::encode(&cursor);
    let (status, page) = send(
        &service,
        request(
            "GET",
            &format!("/saved_views/definitions?after={after}"),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(page["nextCursor"], Value::Null);

    assert_eq!(
        service.calls(),
        vec![
            Call::List {
                kind: Some("email".into()),
                after: None,
                limit: 2
            },
            Call::List {
                kind: None,
                after: Some((Some(4), VIEW)),
                limit: 25
            },
        ]
    );
}

#[tokio::test]
async fn rejects_page_sizes_and_cursors_it_cannot_serve() {
    let service = Arc::new(FakeSavedViews::default());
    for uri in [
        "/saved_views/definitions?first=0",
        "/saved_views/definitions?first=51",
        "/saved_views/definitions?after=not-a-cursor",
    ] {
        let (status, _) = send(&service, request("GET", uri, None)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}");
    }
    assert!(service.calls().is_empty());
}

#[tokio::test]
async fn maps_domain_failures_to_statuses() {
    let cases: [(fn() -> Error, StatusCode); 5] = [
        (|| Error::NotFound, StatusCode::NOT_FOUND),
        (|| Error::NotOwner, StatusCode::NOT_FOUND),
        (|| Error::Conflict, StatusCode::CONFLICT),
        (|| Error::Invalid, StatusCode::BAD_REQUEST),
        (|| Error::NotMember, StatusCode::FORBIDDEN),
    ];
    for (failure, expected) in cases {
        let service = Arc::new(FakeSavedViews::default());
        *service.failure.lock().unwrap() = Some(failure);

        let (status, body) = send(
            &service,
            request("GET", &format!("/saved_views/definitions/{VIEW}"), None),
        )
        .await;

        assert_eq!(status, expected);
        if expected == StatusCode::NOT_FOUND {
            // Another owner's definition is indistinguishable from a missing one.
            assert_eq!(body["message"], json!("saved view not found"));
        }
    }
}

#[tokio::test]
async fn reorders_a_kind_and_returns_the_new_order() {
    let service = Arc::new(FakeSavedViews::default());
    let second = Uuid::from_u128(0x52);

    let (status, views) = send(
        &service,
        request(
            "PUT",
            "/saved_views/definitions/order",
            Some(json!({ "kind": "email", "ids": [second, VIEW] })),
        ),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(views[0]["id"], json!(second));
    assert_eq!(views[1]["id"], json!(VIEW));
    assert_eq!(
        service.calls(),
        vec![Call::Reorder {
            kind: "email".into(),
            ids: vec![second, VIEW]
        }]
    );
}

#[tokio::test]
async fn requires_a_signed_in_user() {
    let service = Arc::new(FakeSavedViews::default());
    let request = Request::get("/saved_views/definitions")
        .body(Body::empty())
        .unwrap();

    let (status, _) = send(&service, request).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(service.calls().is_empty());
}
