use super::*;
use crate::domain::Correlation;
use async_trait::async_trait;
use axum::http::Request;
use macro_auth::macro_api_token::{EncodeMacroApiTokenArgs, encode_macro_api_token};
use std::sync::atomic::{AtomicUsize, Ordering};

const PRIVATE: &str = include_str!(
    "../../../../tooling/xtask/crates/xtask_local/src/local/identity/macro-api-token.local.private.pem"
);
const PUBLIC: &str = include_str!(
    "../../../../tooling/xtask/crates/xtask_local/src/local/identity/macro-api-token.local.public.pem"
);

struct Repository {
    calls: AtomicUsize,
}
#[async_trait]
impl CorrelationRepository for Repository {
    async fn create(
        &self,
        _: Uuid,
        _: Uuid,
        _: Option<crate::scope::SessionScope>,
    ) -> Result<Uuid, CorrelationError> {
        unreachable!()
    }
    async fn find(&self, id: Uuid) -> Result<Option<Correlation>, CorrelationError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        // 1: an unscoped session; 6: a generation session.
        Ok([1, 6].contains(&id.as_u128()).then_some(Correlation {
            session_id: Uuid::from_u128(2),
            agent_id: Uuid::from_u128(3),
            scope: (id == Uuid::from_u128(6)).then_some(crate::scope::SessionScope::Generation),
            revoked: false,
        }))
    }
    async fn revoke(&self, _: Uuid) -> Result<(), CorrelationError> {
        unreachable!()
    }
}
fn token(correlation: Option<Uuid>, agent: Option<Uuid>) -> String {
    mint(correlation, agent, None, None)
}

fn mint(
    correlation: Option<Uuid>,
    agent: Option<Uuid>,
    routine: Option<Uuid>,
    scope: Option<&str>,
) -> String {
    encode_macro_api_token(EncodeMacroApiTokenArgs {
        fusionauth_id: "fixture".into(),
        macro_user_id: "macro|owner@example.com".into(),
        organization_id: None,
        issuer: "fixture".into(),
        private_key: PRIVATE.into(),
        expiry_seconds: 60,
        agent_id: agent,
        agent_via: None,
        agent_correlation_id: correlation,
        agent_session_id: None,
        routine_id: routine,
        agent_scope: scope.map(str::to_owned),
    })
    .unwrap()
}

#[tokio::test]
async fn optional_claim_is_validated_before_a_handler_can_use_it() {
    let repository = Arc::new(Repository {
        calls: AtomicUsize::new(0),
    });
    let state = CorrelationState {
        jwt: JwtValidationArgs::testing_macro_token("fixture", PUBLIC),
        repository: repository.clone(),
    };
    for bearer in [None, Some(token(None, None))] {
        let mut request = Request::builder()
            .uri("/")
            .header("x-agent-correlation-id", Uuid::from_u128(1).to_string())
            .header("x-macro-sdk-verb", "edited");
        if let Some(bearer) = bearer {
            request = request.header("authorization", format!("Bearer {bearer}"));
        }
        let (mut parts, _) = request.body(()).unwrap().into_parts();
        let extracted = AgentCorrelationExtractor::from_request_parts(&mut parts, &state)
            .await
            .unwrap();
        assert_eq!(extracted.0, None);
        assert_eq!(extracted.1, None);
    }
    assert_eq!(repository.calls.load(Ordering::SeqCst), 0);
    for (id, agent, expected) in [
        (1, Some(3), StatusCode::OK),
        (1, Some(4), StatusCode::FORBIDDEN),
        (5, Some(3), StatusCode::NOT_FOUND),
        (1, None, StatusCode::BAD_REQUEST),
    ] {
        let bearer = token(Some(Uuid::from_u128(id)), agent.map(Uuid::from_u128));
        let (mut parts, _) = Request::builder()
            .uri("/")
            .header("authorization", format!("Bearer {bearer}"))
            .header("x-macro-sdk-verb", "edited")
            .body(())
            .unwrap()
            .into_parts();
        let status = match AgentCorrelationExtractor::from_request_parts(&mut parts, &state).await {
            Ok(AgentCorrelationExtractor(found, verb)) => {
                assert_eq!(found, Some(Uuid::from_u128(id)));
                assert_eq!(verb, Some(crate::AgentVerb::Edited));
                StatusCode::OK
            }
            Err(error) => error.into_response().status(),
        };
        assert_eq!(status, expected);
    }

    let bearer = token(Some(Uuid::from_u128(1)), Some(Uuid::from_u128(3)));
    let (mut parts, _) = Request::builder()
        .uri("/")
        .header("authorization", format!("Bearer {bearer}"))
        .header("x-macro-sdk-verb", "unknown")
        .body(())
        .unwrap()
        .into_parts();
    let extracted = AgentCorrelationExtractor::from_request_parts(&mut parts, &state)
        .await
        .unwrap();
    assert_eq!(extracted.0, Some(Uuid::from_u128(1)));
    assert_eq!(extracted.1, None);
}

fn routine_token(routine: Uuid, correlation: Option<Uuid>, agent: Option<Uuid>) -> String {
    mint(correlation, agent, Some(routine), None)
}

#[tokio::test]
async fn propagate_scopes_the_signed_routine_beside_the_correlation() {
    use tower::ServiceExt;

    let repository = Arc::new(Repository {
        calls: AtomicUsize::new(0),
    });
    let state = CorrelationState {
        jwt: JwtValidationArgs::testing_macro_token("fixture", PUBLIC),
        repository: repository.clone(),
    };
    let app = axum::Router::new()
        .route(
            "/",
            axum::routing::post(|| async {
                Json(serde_json::json!({
                    "correlation": crate::context::current(),
                    "routine": crate::context::current_routine(),
                }))
            }),
        )
        .layer(axum::middleware::from_fn_with_state(state, propagate));
    let routine = Uuid::from_u128(0x7001);
    // A routine payload spliced onto another token's signature is not verified.
    let plain = token(None, None);
    let signed = routine_token(routine, None, None);
    let [header, _, signature]: [&str; 3] =
        plain.split('.').collect::<Vec<_>>().try_into().unwrap();
    let forged = format!("{header}.{}.{signature}", signed.split('.').nth(1).unwrap());
    for (bearer, correlation, routine_id) in [
        (Some(signed), None, Some(routine)),
        (
            Some(routine_token(
                routine,
                Some(Uuid::from_u128(1)),
                Some(Uuid::from_u128(3)),
            )),
            Some(Uuid::from_u128(1)),
            Some(routine),
        ),
        (Some(token(None, None)), None, None),
        (Some(forged), None, None),
        (None, None, None),
    ] {
        let mut request = Request::builder().method("POST").uri("/");
        if let Some(bearer) = bearer {
            request = request.header("authorization", format!("Bearer {bearer}"));
        }
        let response = app
            .clone()
            .oneshot(request.body(axum::body::Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
            serde_json::json!({ "correlation": correlation, "routine": routine_id }),
        );
    }
    // Only the correlation is looked up; the routine's signature is its authority.
    assert_eq!(repository.calls.load(Ordering::SeqCst), 1);
    assert_eq!(crate::context::current_routine(), None);
}

/// A scoped session's request outside its scope is refused before any
/// handler runs; inside it, and any unscoped session's, goes through.
#[tokio::test]
async fn a_scoped_session_is_refused_outside_its_scope() {
    use tower::ServiceExt;

    let state = CorrelationState {
        jwt: JwtValidationArgs::testing_macro_token("fixture", PUBLIC),
        repository: Arc::new(Repository {
            calls: AtomicUsize::new(0),
        }),
    };
    let ran = Arc::new(AtomicUsize::new(0));
    let handler = {
        let ran = Arc::clone(&ran);
        move || {
            let ran = Arc::clone(&ran);
            async move {
                ran.fetch_add(1, Ordering::SeqCst);
                StatusCode::OK
            }
        }
    };
    let app = axum::Router::new()
        .route("/email/messages", axum::routing::post(handler.clone()))
        .route(
            "/scheduled-action/suggestions",
            axum::routing::post(handler.clone()),
        )
        .route("/email/threads", axum::routing::get(handler))
        .layer(axum::middleware::from_fn_with_state(state, propagate));
    for (correlation, method, path, expected) in [
        (6, "POST", "/email/messages", StatusCode::FORBIDDEN),
        (6, "POST", "/scheduled-action/suggestions", StatusCode::OK),
        (6, "GET", "/email/threads", StatusCode::OK),
        (1, "POST", "/email/messages", StatusCode::OK),
    ] {
        let bearer = token(Some(Uuid::from_u128(correlation)), Some(Uuid::from_u128(3)));
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .header("authorization", format!("Bearer {bearer}"))
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), expected, "{correlation} {method} {path}");
    }
    assert_eq!(ran.load(Ordering::SeqCst), 3);
    // The extractor refuses the same way.
    let bearer = token(Some(Uuid::from_u128(6)), Some(Uuid::from_u128(3)));
    let (mut parts, _) = Request::builder()
        .method("POST")
        .uri("/email/messages")
        .header("authorization", format!("Bearer {bearer}"))
        .body(())
        .unwrap()
        .into_parts();
    let state = CorrelationState {
        jwt: JwtValidationArgs::testing_macro_token("fixture", PUBLIC),
        repository: Arc::new(Repository {
            calls: AtomicUsize::new(0),
        }),
    };
    let refused = AgentCorrelationExtractor::from_request_parts(&mut parts, &state).await;
    assert_eq!(
        refused.err().unwrap().into_response().status(),
        StatusCode::FORBIDDEN
    );
}

/// A credential's signed scope is enforced before its correlation is looked
/// up, even when the stored correlation is unscoped, and a name this build
/// doesn't know allows only reads.
#[tokio::test]
async fn a_signed_scope_is_refused_outside_it_without_a_lookup() {
    use tower::ServiceExt;

    let repository = Arc::new(Repository {
        calls: AtomicUsize::new(0),
    });
    let state = CorrelationState {
        jwt: JwtValidationArgs::testing_macro_token("fixture", PUBLIC),
        repository: repository.clone(),
    };
    let app = axum::Router::new()
        .route(
            "/email/messages",
            axum::routing::post(|| async { StatusCode::OK }),
        )
        .route(
            "/email/threads",
            axum::routing::get(|| async { StatusCode::OK }),
        )
        .layer(axum::middleware::from_fn_with_state(state, propagate));
    let unscoped = Some(Uuid::from_u128(1));
    let agent = Some(Uuid::from_u128(3));
    for (scope, method, path, expected) in [
        (
            "generation",
            "POST",
            "/email/messages",
            StatusCode::FORBIDDEN,
        ),
        ("no_send", "POST", "/email/messages", StatusCode::FORBIDDEN),
        ("dry_run", "POST", "/email/messages", StatusCode::FORBIDDEN),
        ("dry_run", "GET", "/email/threads", StatusCode::OK),
        ("newer", "POST", "/email/messages", StatusCode::FORBIDDEN),
        ("newer", "GET", "/email/threads", StatusCode::OK),
    ] {
        let bearer = mint(unscoped, agent, None, Some(scope));
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .header("authorization", format!("Bearer {bearer}"))
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), expected, "{scope} {method} {path}");
    }
    // Only the two requests inside their signed scope reached the lookup.
    assert_eq!(repository.calls.load(Ordering::SeqCst), 2);
}

/// A handler sees the scope stored with the correlation, else the one the
/// credential signs, so a route's own scope rule holds either way.
#[tokio::test]
async fn a_handler_reads_the_signed_scope_when_none_is_stored() {
    use tower::ServiceExt;

    let state = CorrelationState {
        jwt: JwtValidationArgs::testing_macro_token("fixture", PUBLIC),
        repository: Arc::new(Repository {
            calls: AtomicUsize::new(0),
        }),
    };
    let app = axum::Router::new()
        .route(
            "/scope",
            axum::routing::get(|| async {
                crate::context::current_scope().map_or("none", crate::scope::SessionScope::as_str)
            }),
        )
        .layer(axum::middleware::from_fn_with_state(state, propagate));
    let agent = Some(Uuid::from_u128(3));
    let unscoped = Some(Uuid::from_u128(1));
    let generation = Some(Uuid::from_u128(6));
    for (bearer, expected) in [
        (mint(unscoped, agent, None, None), "none"),
        (mint(unscoped, agent, None, Some("no_send")), "no_send"),
        (mint(None, None, None, Some("no_send")), "no_send"),
        (
            mint(generation, agent, None, Some("generation")),
            "generation",
        ),
        (mint(unscoped, agent, None, Some("newer")), "none"),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/scope")
                    .header("authorization", format!("Bearer {bearer}"))
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(body, expected);
    }
}

/// A service with no database refuses requests outside a credential's signed
/// scope, and lets unscoped credentials and other callers through.
#[tokio::test]
async fn a_service_without_a_database_enforces_the_signed_scope() {
    use tower::ServiceExt;

    let app = axum::Router::new()
        .route(
            "/api/file/{id}",
            axum::routing::delete(|| async { StatusCode::OK }).get(|| async { StatusCode::OK }),
        )
        .layer(axum::middleware::from_fn_with_state(
            JwtValidationArgs::testing_macro_token("fixture", PUBLIC),
            enforce_signed_scope,
        ));
    let scoped = |scope| {
        mint(
            Some(Uuid::from_u128(1)),
            Some(Uuid::from_u128(3)),
            None,
            scope,
        )
    };
    for (bearer, method, query, expected) in [
        (
            Some(scoped(Some("generation"))),
            "DELETE",
            false,
            StatusCode::FORBIDDEN,
        ),
        (
            Some(scoped(Some("generation"))),
            "DELETE",
            true,
            StatusCode::FORBIDDEN,
        ),
        (
            Some(scoped(Some("generation"))),
            "GET",
            false,
            StatusCode::OK,
        ),
        (
            Some(scoped(Some("newer"))),
            "DELETE",
            false,
            StatusCode::FORBIDDEN,
        ),
        (
            Some(scoped(Some("no_send"))),
            "DELETE",
            false,
            StatusCode::OK,
        ),
        // A background job's credential makes only its listed requests,
        // here too: it reads its files and deletes none.
        (
            Some(scoped(Some("job"))),
            "DELETE",
            false,
            StatusCode::FORBIDDEN,
        ),
        (Some(scoped(Some("job"))), "GET", false, StatusCode::OK),
        (Some(scoped(None)), "DELETE", false, StatusCode::OK),
        (
            Some("not a token".to_owned()),
            "DELETE",
            false,
            StatusCode::OK,
        ),
        (None, "DELETE", false, StatusCode::OK),
    ] {
        let mut request = Request::builder().method(method);
        request = match (&bearer, query) {
            (Some(bearer), true) => request.uri(format!("/api/file/01a1?macro-api-token={bearer}")),
            (Some(bearer), false) => request
                .uri("/api/file/01a1")
                .header("authorization", format!("Bearer {bearer}")),
            (None, _) => request.uri("/api/file/01a1"),
        };
        let response = app
            .clone()
            .oneshot(request.body(axum::body::Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), expected, "{method} {query} {bearer:?}");
    }
}

/// The scope check reads the request's credentials as authentication does,
/// through `macro_auth::credential`, and holds the request to every scope
/// any verified token in it signs: a scoped token in the ambient cookie
/// scopes the request whatever else it carries, however the query spells
/// its key. Tokens of different users are refused.
#[tokio::test]
async fn a_scoped_token_in_the_cookie_scopes_the_request_whatever_else_it_carries() {
    use tower::ServiceExt;

    let app = axum::Router::new()
        .route(
            "/api/file/{id}",
            axum::routing::delete(|| async { StatusCode::OK }),
        )
        .layer(axum::middleware::from_fn_with_state(
            JwtValidationArgs::testing_macro_token("fixture", PUBLIC),
            enforce_signed_scope,
        ));
    let scoped = mint(
        Some(Uuid::from_u128(1)),
        Some(Uuid::from_u128(3)),
        None,
        Some("generation"),
    );
    let unscoped = mint(
        Some(Uuid::from_u128(1)),
        Some(Uuid::from_u128(3)),
        None,
        None,
    );
    let someone_else = encode_macro_api_token(EncodeMacroApiTokenArgs {
        fusionauth_id: "fixture".into(),
        macro_user_id: "macro|someone@example.com".into(),
        organization_id: None,
        issuer: "fixture".into(),
        private_key: PRIVATE.into(),
        expiry_seconds: 60,
        agent_id: None,
        agent_via: None,
        agent_correlation_id: None,
        agent_session_id: None,
        routine_id: None,
        agent_scope: None,
    })
    .unwrap();
    let cookie_name = macro_auth::credential::access_token_cookie_name();
    let scoped_cookie = format!("{cookie_name}={scoped}");
    let cases: Vec<(String, Option<String>, Option<String>, StatusCode)> = vec![
        (
            String::new(),
            None,
            Some(scoped_cookie.clone()),
            StatusCode::FORBIDDEN,
        ),
        // The bypass: an encoded key with a value that isn't a token.
        (
            "?macro%2Dapi%2Dtoken=junk".into(),
            None,
            Some(scoped_cookie.clone()),
            StatusCode::FORBIDDEN,
        ),
        (
            "?Macro-Api-Token=junk".into(),
            None,
            Some(scoped_cookie.clone()),
            StatusCode::FORBIDDEN,
        ),
        (
            format!("?macro-api-token={unscoped}&macro-api-token={unscoped}"),
            None,
            Some(scoped_cookie.clone()),
            StatusCode::FORBIDDEN,
        ),
        (
            format!("?macro-api-token={unscoped}"),
            None,
            Some(scoped_cookie.clone()),
            StatusCode::FORBIDDEN,
        ),
        (
            String::new(),
            Some(format!("Bearer {unscoped}")),
            Some(scoped_cookie.clone()),
            StatusCode::FORBIDDEN,
        ),
        (
            format!("?macro-api-token={unscoped}"),
            Some(format!("Bearer {scoped}")),
            None,
            StatusCode::FORBIDDEN,
        ),
        // An encoded cookie name and value are the cookie, as cookie jars read it.
        (
            String::new(),
            None,
            Some(format!(
                "{}={}",
                cookie_name.replace('-', "%2D"),
                scoped.replace('.', "%2E")
            )),
            StatusCode::FORBIDDEN,
        ),
        // Unscoped, however many places carry it, and with an unverifiable bearer.
        (
            String::new(),
            Some(format!("Bearer {unscoped}")),
            Some(format!("{cookie_name}={unscoped}")),
            StatusCode::OK,
        ),
        (
            String::new(),
            Some("Bearer booking-capability".into()),
            Some(format!("{cookie_name}={unscoped}")),
            StatusCode::OK,
        ),
        // Tokens of different users.
        (
            String::new(),
            Some(format!("Bearer {someone_else}")),
            Some(format!("{cookie_name}={unscoped}")),
            StatusCode::BAD_REQUEST,
        ),
    ];
    for (query, authorization, cookie, expected) in cases {
        let mut request = Request::builder()
            .method("DELETE")
            .uri(format!("/api/file/01a1{query}"));
        if let Some(authorization) = &authorization {
            request = request.header("authorization", authorization);
        }
        if let Some(cookie) = &cookie {
            request = request.header("cookie", cookie);
        }
        let response = app
            .clone()
            .oneshot(request.body(axum::body::Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            expected,
            "{query} {authorization:?} {cookie:?}"
        );
    }
}

/// `propagate` alone, on a route that reads no `MacroAuthorization`, refuses
/// tokens of different users before the handler runs, in any pairing of
/// bearer, query parameter and cookie; one user's tokens pass.
#[tokio::test]
async fn propagate_refuses_tokens_of_different_users() {
    use tower::ServiceExt;

    let state = CorrelationState {
        jwt: JwtValidationArgs::testing_macro_token("fixture", PUBLIC),
        repository: Arc::new(Repository {
            calls: AtomicUsize::new(0),
        }),
    };
    let handled = Arc::new(AtomicUsize::new(0));
    let app = axum::Router::new()
        .route(
            "/items",
            axum::routing::get({
                let handled = handled.clone();
                move || async move {
                    handled.fetch_add(1, Ordering::SeqCst);
                    StatusCode::OK
                }
            }),
        )
        .layer(axum::middleware::from_fn_with_state(state, propagate));
    let owner = token(None, None);
    let someone_else = encode_macro_api_token(EncodeMacroApiTokenArgs {
        fusionauth_id: "fixture".into(),
        macro_user_id: "macro|someone@example.com".into(),
        organization_id: None,
        issuer: "fixture".into(),
        private_key: PRIVATE.into(),
        expiry_seconds: 60,
        agent_id: None,
        agent_via: None,
        agent_correlation_id: None,
        agent_session_id: None,
        routine_id: None,
        agent_scope: None,
    })
    .unwrap();
    let cookie = |token: &str| {
        format!(
            "{}={token}",
            macro_auth::credential::access_token_cookie_name()
        )
    };
    type Case<'a> = (String, Vec<(&'a str, String)>, StatusCode);
    let cases: Vec<Case> = vec![
        (
            "/items".into(),
            vec![
                ("authorization", format!("Bearer {owner}")),
                ("cookie", cookie(&someone_else)),
            ],
            StatusCode::BAD_REQUEST,
        ),
        (
            format!("/items?macro-api-token={someone_else}"),
            vec![("cookie", cookie(&owner))],
            StatusCode::BAD_REQUEST,
        ),
        (
            format!("/items?macro-api-token={owner}"),
            vec![("authorization", format!("Bearer {someone_else}"))],
            StatusCode::BAD_REQUEST,
        ),
        (
            "/items".into(),
            vec![
                ("authorization", format!("Bearer {owner}")),
                ("cookie", cookie(&owner)),
            ],
            StatusCode::OK,
        ),
    ];
    for (uri, headers, expected) in cases {
        let mut request = Request::builder().uri(&uri);
        for (name, value) in &headers {
            request = request.header(*name, value);
        }
        let response = app
            .clone()
            .oneshot(request.body(axum::body::Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), expected, "{uri}");
    }
    assert_eq!(handled.load(Ordering::SeqCst), 1);
}

/// A refused sharing change is answered 403 on every route, whatever error
/// the code between the refusal and the route made of it; a request that
/// refused a change and still succeeded keeps its answer.
#[tokio::test]
async fn a_refused_sharing_change_is_answered_as_a_refusal() {
    use axum::http::StatusCode;
    use tower::ServiceExt;

    let state = CorrelationState {
        jwt: JwtValidationArgs::testing_macro_token("fixture", PUBLIC),
        repository: Arc::new(Repository {
            calls: AtomicUsize::new(0),
        }),
    };
    let app = axum::Router::new()
        .route(
            "/share",
            axum::routing::post(|| async {
                match crate::context::refuse_sharing(true) {
                    Ok(()) => StatusCode::OK,
                    Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
                }
            }),
        )
        .route(
            "/share-if-allowed",
            axum::routing::post(|| async {
                let _ = crate::context::refuse_sharing(true);
                StatusCode::OK
            }),
        )
        .layer(axum::middleware::from_fn_with_state(state, propagate));
    let no_send = mint(None, None, None, Some("no_send"));
    let unscoped = mint(None, None, None, None);
    for (path, bearer, expected, message) in [
        (
            "/share",
            &no_send,
            StatusCode::FORBIDDEN,
            Some(SharingRefused::MESSAGE),
        ),
        ("/share", &unscoped, StatusCode::OK, None),
        ("/share-if-allowed", &no_send, StatusCode::OK, None),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(path)
                    .header("authorization", format!("Bearer {bearer}"))
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), expected, "{path}");
        if let Some(message) = message {
            let body = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(body["message"], message);
        }
    }
}

/// Normal member-authorized agent sessions retain direct contribution writes;
/// only credentials carrying a restricted scope are refused at the route gate.
#[tokio::test]
async fn ordinary_agents_reach_policy_put_while_restricted_agents_do_not() {
    use tower::ServiceExt;

    let state = CorrelationState {
        jwt: JwtValidationArgs::testing_macro_token("fixture", PUBLIC),
        repository: Arc::new(Repository {
            calls: AtomicUsize::new(0),
        }),
    };
    let app = axum::Router::new()
        .route(
            "/dss/v1/crm/email-privacy/policy",
            axum::routing::put(|| async { StatusCode::OK }),
        )
        .layer(axum::middleware::from_fn_with_state(state, propagate));
    for scope in [None, Some("no_send"), Some("dry_run"), Some("generation")] {
        let bearer = mint(
            Some(Uuid::from_u128(1)),
            Some(Uuid::from_u128(3)),
            None,
            scope,
        );
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/dss/v1/crm/email-privacy/policy")
                    .header("authorization", format!("Bearer {bearer}"))
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            if scope.is_none() {
                StatusCode::OK
            } else {
                StatusCode::FORBIDDEN
            },
            "{scope:?}",
        );
    }
}
