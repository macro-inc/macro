//! The forms routes over a recording service: who gets through each
//! extractor, what the service is handed, and how refusals read.

use axum::body::{Body, to_bytes};
use axum::http::{Method, Request, StatusCode, header};
use entity_access::domain::models::AccessLevel;
use serde_json::{Value, json};
use tower::ServiceExt;

use super::*;
use crate::domain::models::{FormError, FormQuestionId};

mod fakes;

use fakes::*;

fn request(method: Method, path: &str, token: Option<&str>, body: Option<Value>) -> Request<Body> {
    let mut builder = Request::builder().method(method).uri(path);
    if let Some(token) = token {
        builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    match body {
        Some(body) => builder
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap(),
        None => builder.body(Body::empty()).unwrap(),
    }
}

async fn json_of(response: axum::response::Response) -> Value {
    serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap()
}

fn submission() -> Value {
    json!({"answers": [{
        "question": "00000000-0000-0000-0000-000000000091",
        "value": {"type": "text", "value": "Sam"},
    }]})
}

fn members_form() -> Grants {
    Grants {
        users: [(RESPONDENT.to_string(), AccessLevel::View)].into(),
        public: None,
    }
}

fn public_form() -> Grants {
    Grants {
        users: [(RESPONDENT.to_string(), AccessLevel::View)].into(),
        public: Some(AccessLevel::View),
    }
}

#[tokio::test]
async fn an_anonymous_submission_to_a_members_form_is_401_and_reaches_no_service() {
    let (router, service) = router(members_form());
    let response = router
        .oneshot(request(
            Method::POST,
            "/00000000-0000-0000-0000-0000000000f0/responses",
            None,
            Some(submission()),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        json_of(response).await,
        json!({
            "code": "signInRequired",
            "message": "sign in to respond to this form",
            "question": null,
            "problem": null,
        })
    );
    assert!(service.handed.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_anonymous_submission_to_a_public_form_is_200_with_an_anonymous_receipt() {
    let (router, service) = router(public_form());
    let response = router
        .oneshot(request(
            Method::POST,
            "/00000000-0000-0000-0000-0000000000f0/responses",
            None,
            Some(submission()),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        json_of(response).await,
        json!({
            "outcome": "submitted",
            "response": "00000000-0000-0000-0000-0000000000e1",
            "row": "00000000-0000-0000-0000-000000000040",
        })
    );
    assert_eq!(
        *service.handed.lock().unwrap(),
        vec![Handed {
            call: "submit_response",
            entity_id: FORM.to_string(),
            user: None,
        }]
    );
}

#[tokio::test]
async fn a_signed_in_submission_carries_the_respondent() {
    let (router, service) = router(public_form());
    let response = router
        .oneshot(request(
            Method::POST,
            "/00000000-0000-0000-0000-0000000000f0/responses",
            Some("respondent"),
            Some(submission()),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        service.handed.lock().unwrap()[0].user.as_deref(),
        Some(RESPONDENT)
    );
}

#[tokio::test]
async fn anonymous_callers_can_read_a_public_form_but_never_edit_or_list() {
    let (router, _) = router(public_form());
    let read = router
        .clone()
        .oneshot(request(
            Method::GET,
            "/00000000-0000-0000-0000-0000000000f0",
            None,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(read.status(), StatusCode::OK);
    assert_eq!(json_of(read).await["access"], "view");

    for (method, path, body) in [
        (
            Method::PUT,
            "/00000000-0000-0000-0000-0000000000f0/layout",
            Some(json!({"sections": []})),
        ),
        (
            Method::GET,
            "/00000000-0000-0000-0000-0000000000f0/responses/summary",
            None,
        ),
        (
            Method::GET,
            "/00000000-0000-0000-0000-0000000000f0/permissions",
            None,
        ),
        (Method::GET, "/accessible", None),
        (
            Method::POST,
            "/",
            Some(json!({"name": "x", "source": {"kind": "new"}})),
        ),
    ] {
        let response = router
            .clone()
            .oneshot(request(method.clone(), path, None, body))
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::UNAUTHORIZED,
            "{method} {path}"
        );
        assert_eq!(
            json_of(response).await["code"],
            "signInRequired",
            "{method} {path}"
        );
    }
}

#[tokio::test]
async fn a_viewer_cannot_reach_editor_or_owner_routes() {
    let (router, service) = router(members_form());
    for (method, path, body) in [
        (
            Method::PATCH,
            "/00000000-0000-0000-0000-0000000000f0",
            Some(json!({"description": "x"})),
        ),
        (
            Method::PUT,
            "/00000000-0000-0000-0000-0000000000f0/layout",
            Some(json!({"sections": []})),
        ),
        (
            Method::GET,
            "/00000000-0000-0000-0000-0000000000f0/responses/summary",
            None,
        ),
        (
            Method::PATCH,
            "/00000000-0000-0000-0000-0000000000f0/permissions",
            Some(json!({})),
        ),
    ] {
        let response = router
            .clone()
            .oneshot(request(method.clone(), path, Some("respondent"), body))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN, "{method} {path}");
        assert_eq!(
            json_of(response).await,
            json!({
                "code": "forbidden",
                "message": "you lack the access this form request needs",
                "question": null,
                "problem": null,
            }),
            "{method} {path}"
        );
    }
    assert!(service.handed.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_owner_reaches_every_route_with_their_own_receipt() {
    let (router, service) = router(Grants {
        users: [(OWNER.to_string(), AccessLevel::Owner)].into(),
        public: None,
    });
    for (method, path, body, status) in [
        (
            Method::GET,
            "/00000000-0000-0000-0000-0000000000f0",
            None,
            StatusCode::OK,
        ),
        (
            Method::PATCH,
            "/00000000-0000-0000-0000-0000000000f0",
            Some(json!({"audience": "public", "closesAt": null})),
            StatusCode::OK,
        ),
        (
            Method::PUT,
            "/00000000-0000-0000-0000-0000000000f0/layout",
            Some(json!({"sections": []})),
            StatusCode::OK,
        ),
        (
            Method::PUT,
            "/00000000-0000-0000-0000-0000000000f0/responses/mine",
            Some(submission()),
            StatusCode::OK,
        ),
        (
            Method::GET,
            "/00000000-0000-0000-0000-0000000000f0/responses/summary",
            None,
            StatusCode::OK,
        ),
        (
            Method::GET,
            "/00000000-0000-0000-0000-0000000000f0/tally",
            None,
            StatusCode::OK,
        ),
        (
            Method::GET,
            "/00000000-0000-0000-0000-0000000000f0/permissions",
            None,
            StatusCode::OK,
        ),
        (
            Method::PATCH,
            "/00000000-0000-0000-0000-0000000000f0/permissions",
            Some(json!({"channel_share_permissions": []})),
            StatusCode::OK,
        ),
        (
            Method::GET,
            "/00000000-0000-0000-0000-0000000000f0/responses/mine",
            None,
            StatusCode::NOT_FOUND,
        ),
    ] {
        let response = router
            .clone()
            .oneshot(request(method.clone(), path, Some("owner"), body))
            .await
            .unwrap();
        assert_eq!(response.status(), status, "{method} {path}");
    }
    let handed = service.handed.lock().unwrap();
    assert_eq!(handed.len(), 9);
    assert!(handed.iter().all(
        |handed| handed.user.as_deref() == Some(OWNER) && handed.entity_id == FORM.to_string()
    ));
}

#[tokio::test]
async fn creating_over_a_table_needs_owner_on_its_database() {
    let body = json!({
        "name": "RSVP",
        "source": {
            "kind": "table",
            "databaseId": "00000000-0000-0000-0000-0000000000db",
            "tableId": "00000000-0000-0000-0000-00000000007a",
        },
    });
    // View; Edit granted on the database itself; and Edit the database
    // derives from editing a form over it, which entity_access answers as
    // the database's level just the same. None reaches the service.
    for (case, level) in [
        ("view", AccessLevel::View),
        ("direct database edit", AccessLevel::Edit),
        (
            "edit derived from a form over the database",
            AccessLevel::Edit,
        ),
    ] {
        let (router, service) = router(Grants {
            users: [(RESPONDENT.to_string(), level)].into(),
            public: None,
        });
        let refused = router
            .oneshot(request(
                Method::POST,
                "/",
                Some("respondent"),
                Some(body.clone()),
            ))
            .await
            .unwrap();
        assert_eq!(refused.status(), StatusCode::FORBIDDEN, "{case}");
        assert_eq!(json_of(refused).await["code"], "forbidden", "{case}");
        assert!(service.handed.lock().unwrap().is_empty(), "{case}");
    }

    let (owning, service) = router(Grants {
        users: [(RESPONDENT.to_string(), AccessLevel::Owner)].into(),
        public: None,
    });
    let created = owning
        .oneshot(request(Method::POST, "/", Some("respondent"), Some(body)))
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    assert_eq!(
        *service.handed.lock().unwrap(),
        vec![Handed {
            call: "create_form",
            entity_id: "00000000-0000-0000-0000-0000000000db".into(),
            user: Some(RESPONDENT.into()),
        }]
    );
}

#[tokio::test]
async fn a_new_form_over_a_new_database_needs_only_a_signed_in_caller() {
    let (router, service) = router(Grants::default());
    let created = router
        .oneshot(request(
            Method::POST,
            "/",
            Some("respondent"),
            Some(json!({"name": "RSVP", "source": {"kind": "new"}})),
        ))
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    assert_eq!(service.handed.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn the_catalog_and_a_databases_forms_list_for_signed_in_callers() {
    let (router, service) = router(members_form());
    let catalog = router
        .clone()
        .oneshot(request(
            Method::GET,
            "/accessible",
            Some("respondent"),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(catalog.status(), StatusCode::OK);
    let listed = json_of(catalog).await;
    assert_eq!(listed[0]["access"], "view");
    assert_eq!(listed[0]["form"]["id"], FORM.to_string());

    let scoped = router
        .oneshot(request(
            Method::GET,
            "/?databaseId=00000000-0000-0000-0000-0000000000db",
            Some("respondent"),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(scoped.status(), StatusCode::OK);
    assert_eq!(
        service.handed.lock().unwrap()[1],
        Handed {
            call: "forms_for_database",
            entity_id: "00000000-0000-0000-0000-0000000000db".into(),
            user: Some(RESPONDENT.into()),
        }
    );
}

#[tokio::test]
async fn refusals_read_as_a_code_status_and_the_question_at_fault() {
    let question = FormQuestionId::from_uuid(uuid::Uuid::from_u128(0x91));
    let cases = [
        (FormError::Closed, StatusCode::CONFLICT, "closed"),
        (
            FormError::AlreadyResponded,
            StatusCode::CONFLICT,
            "alreadyResponded",
        ),
        (FormError::TableGone, StatusCode::CONFLICT, "tableGone"),
        (
            FormError::SignInRequired,
            StatusCode::UNAUTHORIZED,
            "signInRequired",
        ),
        (FormError::NotFound, StatusCode::NOT_FOUND, "notFound"),
        (
            FormError::MissingAnswer { question },
            StatusCode::BAD_REQUEST,
            "missingAnswer",
        ),
        (
            FormError::InvalidAnswer {
                question,
                reason: "no".into(),
            },
            StatusCode::BAD_REQUEST,
            "invalidAnswer",
        ),
        (FormError::OwnerOnly, StatusCode::FORBIDDEN, "ownerOnly"),
        (FormError::TallyHidden, StatusCode::FORBIDDEN, "tallyHidden"),
        (
            FormError::Repository(rootcause::report!("down").into_dynamic()),
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal",
        ),
    ];
    for (error, status, code) in cases {
        let (router, service) = router(public_form());
        *service.refusal.lock().unwrap() = Some(error);
        let response = router
            .oneshot(request(
                Method::POST,
                "/00000000-0000-0000-0000-0000000000f0/responses",
                Some("respondent"),
                Some(submission()),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), status, "{code}");
        let body = json_of(response).await;
        assert_eq!(body["code"], code);
        if code == "missingAnswer" || code == "invalidAnswer" {
            assert_eq!(body["question"], question.to_string());
        }
        if code == "internal" {
            assert_eq!(body["message"], "internal server error");
        }
    }
}

#[test]
fn the_openapi_document_names_every_operation_the_sdk_wraps() {
    let document = serde_json::to_value(FormsApi::openapi()).unwrap();
    let mut operations: Vec<String> = document["paths"]
        .as_object()
        .unwrap()
        .values()
        .flat_map(|path| path.as_object().unwrap().values())
        .map(|operation| operation["operationId"].as_str().unwrap().to_string())
        .collect();
    operations.sort();
    assert_eq!(
        operations,
        vec![
            "create_form",
            "edit_my_form_response",
            "get_form",
            "get_form_permissions",
            "get_form_response_summary",
            "get_form_tally",
            "get_my_form_response",
            "list_accessible_forms",
            "list_forms",
            "put_form_layout",
            "submit_form_response",
            "update_form",
            "update_form_permissions",
        ]
    );
    assert!(document["paths"]["/forms/{id}/responses"].is_object());
    assert!(document["components"]["schemas"]["ListedForm"].is_object());
}

#[tokio::test]
async fn a_bad_token_and_a_stranger_get_typed_refusals() {
    let (router, service) = router(members_form());
    let bad_token = router
        .clone()
        .oneshot(request(
            Method::GET,
            "/00000000-0000-0000-0000-0000000000f0",
            Some("forged"),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(bad_token.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(json_of(bad_token).await["code"], "signInRequired");

    let catalog = router
        .clone()
        .oneshot(request(Method::GET, "/accessible", Some("forged"), None))
        .await
        .unwrap();
    assert_eq!(catalog.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(json_of(catalog).await["code"], "signInRequired");

    // The owner holds no grant in this table of grants: a stranger.
    let stranger = router
        .oneshot(request(
            Method::GET,
            "/00000000-0000-0000-0000-0000000000f0",
            Some("owner"),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(stranger.status(), StatusCode::FORBIDDEN);
    assert_eq!(json_of(stranger).await["code"], "forbidden");
    assert!(service.handed.lock().unwrap().is_empty());
}
