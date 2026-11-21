use axum::{
    Extension, Router,
    body::Body,
    http::{Method, StatusCode},
};
use http_body_util::BodyExt;
use tower::{Layer, ServiceExt};

use super::*;
use crate::{CategorySet, Enforcement};

/// Answers which verdict the handler saw, so a test can tell the handler ran.
async fn handled(decision: Option<Extension<RouteDecision>>) -> &'static str {
    match decision {
        Some(Extension(decision)) => decision.verdict.name(),
        None => "no decision",
    }
}

/// The same routes at the root and under the mounts services really use: a
/// version, a gateway prefix, and both.
fn router() -> Router {
    let api = Router::new()
        .route(
            "/keys",
            post(Category::CredentialMint, handled).merge(get(Category::Read, handled)),
        )
        .route(
            "/channels/{id}/join-link",
            get(Category::ShareOutside, handled),
        );
    Router::new()
        .merge(api.clone())
        .nest("/v1", api.clone())
        .nest("/dss", Router::new().merge(api.clone()).nest("/v2", api))
}

fn resolved(caller: Caller) -> ResolvedCaller {
    ResolvedCaller {
        caller,
        enforced: CategorySet::default(),
    }
}

#[tokio::test]
async fn a_program_is_refused_minting_a_credential_on_every_mount() {
    for path in ["/keys", "/v1/keys", "/dss/keys", "/dss/v2/keys"] {
        let mut request = Request::builder()
            .method(Method::POST)
            .uri(path)
            .body(Body::empty())
            .unwrap();
        request.extensions_mut().insert(ResolvedCaller {
            caller: Caller::Program,
            enforced: CategorySet::default(),
        });

        let response = router().oneshot(request).await.unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN, "{path}");
        let refusal = Refusal {
            code: RefusalCode::PersonOnly,
            category: Category::CredentialMint,
            caller: Caller::Program,
            enforcement: Enforcement::Enforced,
        };
        assert_eq!(
            response.extensions().get::<RouteDecision>(),
            Some(&RouteDecision {
                category: Category::CredentialMint,
                verdict: Verdict::Refused(refusal),
            }),
            "{path}"
        );
        assert_eq!(
            response
                .extensions()
                .get::<ResponseSpanFields>()
                .map(|fields| fields.0.clone()),
            Some(vec![
                ("route_policy.category", "credential_mint"),
                ("route_policy.outcome", "refused"),
                ("route_policy.caller", "program"),
                ("route_policy.code", "person_only"),
            ]),
            "{path}"
        );
        let body = response.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
            serde_json::json!({
                "message": "An agent's program can't create credentials or bearer links. Ask the person to do it themselves in Macro.",
                "code": "person_only",
                "category": "credential_mint",
                "caller": "program",
            }),
            "{path}"
        );
    }
}

#[tokio::test]
async fn a_person_reaches_the_handler_which_sees_the_decision() {
    let mut request = Request::builder()
        .method(Method::POST)
        .uri("/dss/v2/keys")
        .body(Body::empty())
        .unwrap();
    request.extensions_mut().insert(resolved(Caller::Person));

    let response = router().oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(&body[..], b"allowed");
}

#[tokio::test]
async fn each_method_of_a_route_keeps_its_own_category() {
    let mut request = Request::builder()
        .method(Method::GET)
        .uri("/v1/keys")
        .body(Body::empty())
        .unwrap();
    request.extensions_mut().insert(resolved(Caller::Program));

    let response = router().oneshot(request).await.unwrap();

    assert_eq!(
        response.extensions().get::<RouteDecision>(),
        Some(&RouteDecision {
            category: Category::Read,
            verdict: Verdict::Allowed(Caller::Program),
        })
    );
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(&body[..], b"allowed");
}

#[tokio::test]
async fn an_observed_refusal_lets_the_request_go_on() {
    let mut request = Request::builder()
        .method(Method::GET)
        .uri("/dss/channels/7/join-link")
        .body(Body::empty())
        .unwrap();
    request.extensions_mut().insert(resolved(Caller::Program));

    let response = router().oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .extensions()
            .get::<ResponseSpanFields>()
            .map(|fields| fields.0.clone()),
        Some(vec![
            ("route_policy.category", "share_outside"),
            ("route_policy.outcome", "observed"),
            ("route_policy.caller", "program"),
            ("route_policy.code", "person_only"),
        ])
    );
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(&body[..], b"observed");
}

#[tokio::test]
async fn the_rollout_enforces_an_observed_category_it_names() {
    let mut request = Request::builder()
        .method(Method::GET)
        .uri("/dss/channels/7/join-link")
        .body(Body::empty())
        .unwrap();
    request.extensions_mut().insert(ResolvedCaller {
        caller: Caller::Program,
        enforced: CategorySet::default().with(Category::ShareOutside),
    });

    let response = router().oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response.extensions().get::<RouteDecision>(),
        Some(&RouteDecision {
            category: Category::ShareOutside,
            verdict: Verdict::Refused(Refusal {
                code: RefusalCode::PersonOnly,
                category: Category::ShareOutside,
                caller: Caller::Program,
                enforcement: Enforcement::Enforced,
            }),
        })
    );
}

#[tokio::test]
async fn a_request_with_no_resolved_caller_is_refused_and_the_handler_does_not_run() {
    let request = Request::builder()
        .method(Method::POST)
        .uri("/v1/keys")
        .body(Body::empty())
        .unwrap();

    let response = router().oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response
            .extensions()
            .get::<ResponseSpanFields>()
            .map(|fields| fields.0.clone()),
        Some(vec![
            ("route_policy.category", "credential_mint"),
            ("route_policy.outcome", "unresolved"),
        ])
    );
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
        serde_json::json!({
            "message": "Macro couldn't tell who sent this request. Sign in and try again.",
            "code": "no_caller",
            "category": "credential_mint",
        })
    );
}

#[tokio::test]
async fn a_public_route_takes_no_caller() {
    let router = Router::new().route("/health", get(Category::Public, handled));
    let request = Request::builder()
        .method(Method::GET)
        .uri("/health")
        .body(Body::empty())
        .unwrap();

    let response = router.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(&body[..], b"public");
}

#[tokio::test]
async fn an_unknown_scope_reads_by_method_only() {
    let router = Router::new().route(
        "/search",
        post(Category::Read, handled).merge(get(Category::Read, handled)),
    );
    for (method, status) in [
        (Method::GET, StatusCode::OK),
        (Method::HEAD, StatusCode::OK),
        (Method::POST, StatusCode::FORBIDDEN),
    ] {
        let mut request = Request::builder()
            .method(method.clone())
            .uri("/search")
            .body(Body::empty())
            .unwrap();
        request
            .extensions_mut()
            .insert(resolved(Caller::ScopedUnknown));
        let response = router.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), status, "{method}");
    }

    // A dry run reads by declared category: its POST read goes on.
    let mut request = Request::builder()
        .method(Method::POST)
        .uri("/search")
        .body(Body::empty())
        .unwrap();
    request
        .extensions_mut()
        .insert(resolved(Caller::ScopedDryRun));
    assert_eq!(
        router.oneshot(request).await.unwrap().status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn a_channel_mention_is_refused_what_a_run_that_sends_nothing_is() {
    let router = Router::new()
        .route("/messages", post(Category::Send, handled))
        .route("/notes", post(Category::Write, handled));
    let mut send = Request::builder()
        .method(Method::POST)
        .uri("/messages")
        .body(Body::empty())
        .unwrap();
    send.extensions_mut().insert(ResolvedCaller {
        caller: Caller::ChannelMention,
        enforced: CategorySet::default().with(Category::Send),
    });
    assert_eq!(
        router.clone().oneshot(send).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    let mut write = Request::builder()
        .method(Method::POST)
        .uri("/notes")
        .body(Body::empty())
        .unwrap();
    write
        .extensions_mut()
        .insert(resolved(Caller::ChannelMention));
    assert_eq!(
        router.oneshot(write).await.unwrap().status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn the_route_walker_names_the_routes_that_declare_no_category() {
    let router = Router::new()
        .route("/declared", get(Category::Read, handled))
        .route("/raw", axum::routing::get(|| async { "raw" }))
        .route(
            "/chained",
            get(Category::Read, handled).post(|| async { "no category" }),
        );
    let undeclared = undeclared_routes(
        router,
        &[
            (Method::GET, "/declared"),
            (Method::GET, "/raw"),
            (Method::POST, "/chained"),
            (Method::GET, "/chained"),
        ],
    )
    .await;
    assert_eq!(undeclared, ["GET /raw", "POST /chained"]);
}

#[tokio::test]
async fn a_service_route_is_decided_by_the_layer_around_it() {
    let service =
        RoutePolicyLayer::new(Category::Connect).layer(tower::service_fn(|_: Request| async {
            Ok::<_, Infallible>(Response::new(Body::from("connected")))
        }));
    let router = Router::new().nest("/v1", Router::new().route_service("/connect", service));

    let mut program = Request::builder()
        .method(Method::POST)
        .uri("/v1/connect")
        .body(Body::empty())
        .unwrap();
    program.extensions_mut().insert(resolved(Caller::Program));
    let refused = router.clone().oneshot(program).await.unwrap();
    assert_eq!(refused.status(), StatusCode::FORBIDDEN);

    let mut person = Request::builder()
        .method(Method::POST)
        .uri("/v1/connect")
        .body(Body::empty())
        .unwrap();
    person.extensions_mut().insert(resolved(Caller::Person));
    let allowed = router.oneshot(person).await.unwrap();
    let body = allowed.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(&body[..], b"connected");
}

#[tokio::test]
async fn an_any_route_is_decided_for_every_method() {
    let router = Router::new().route("/proxy", any(Category::Egress, handled));
    for method in [Method::GET, Method::POST, Method::DELETE] {
        let mut request = Request::builder()
            .method(method.clone())
            .uri("/proxy")
            .body(Body::empty())
            .unwrap();
        request.extensions_mut().insert(ResolvedCaller {
            caller: Caller::Program,
            enforced: CategorySet::default().with(Category::Egress),
        });
        let response = router.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN, "{method}");
    }
}
