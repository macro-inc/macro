use super::*;

#[test]
fn tested_inventory_matches_every_registered_public_method_including_head() {
    use std::collections::BTreeSet;
    let source = include_str!("../../router.rs")
        .split("/// Internal lifecycle routes")
        .next()
        .unwrap();
    let mut registered = BTreeSet::new();
    for route in source.split(".route(").skip(1) {
        let path = route
            .split('"')
            .nth(1)
            .unwrap()
            .replace("{team}", &Uuid::from_u128(1).to_string())
            .replace("{item}", &Uuid::from_u128(2).to_string())
            .replace("{folder}", &Uuid::from_u128(3).to_string())
            .replace("{import_id}", &Uuid::from_u128(4).to_string());
        for (method, syntax) in [
            ("GET", "get("),
            ("POST", "post("),
            ("PUT", "put("),
            ("PATCH", "patch("),
            ("DELETE", "delete("),
        ] {
            if route.contains(syntax) {
                registered.insert((method.to_owned(), path.clone()));
                if method == "GET" {
                    registered.insert(("HEAD".to_owned(), path.clone()));
                }
            }
        }
    }
    let tested: BTreeSet<_> = routes()
        .into_iter()
        .map(|(method, path, _)| (method.to_owned(), path))
        .collect();
    assert_eq!(registered, tested);
    assert_eq!(tested.len(), 32);
}

#[tokio::test]
async fn real_rollout_denies_every_method_before_any_vault_work() {
    use crate::outbound::availability::PASSWORDS_FLAG;
    use feature_flags::{FlagSnapshot, FlagValue};
    use std::sync::atomic::Ordering;
    for (result, configured, expected) in [
        (
            Ok(FlagSnapshot::new([(
                PASSWORDS_FLAG.into(),
                FlagValue::Boolean(false),
            )])),
            true,
            StatusCode::NOT_FOUND,
        ),
        (Ok(FlagSnapshot::default()), true, StatusCode::NOT_FOUND),
        (
            Err("remote unavailable".to_owned()),
            true,
            StatusCode::SERVICE_UNAVAILABLE,
        ),
        (
            Ok(FlagSnapshot::new([(
                PASSWORDS_FLAG.into(),
                FlagValue::Boolean(true),
            )])),
            false,
            StatusCode::SERVICE_UNAVAILABLE,
        ),
    ] {
        let (app, repository, provider) = flagged_app(result, configured);
        for (method, path, body) in routes() {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri(&path)
                        .header("authorization", "Bearer session")
                        .header("x-macro-passwords", "1")
                        .header("content-type", "application/json")
                        .body(Body::from(body.to_string()))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), expected, "{method} {path}");
            assert_eq!(response.headers()[CACHE_CONTROL], "private, no-store");
        }
        assert_eq!(repository.calls.load(Ordering::SeqCst), 0);
        assert_eq!(provider.calls.load(Ordering::SeqCst), 0);
    }
}

#[tokio::test]
async fn disabled_query_body_path_and_method_variants_never_perform_work() {
    use std::sync::atomic::Ordering;
    let (app, repository, provider) = flagged_app(Ok(feature_flags::FlagSnapshot::default()), true);
    let team = Uuid::from_u128(1);
    let item = format!("/teams/{team}/items/{}", Uuid::from_u128(2));
    for search in [
        String::new(),
        "?search=".into(),
        "?search=encoded%20term%26%2F".into(),
        format!("?search={}", "a".repeat(201)),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/teams/{team}/items{search}"))
                    .header("authorization", "Bearer session")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
    for version in [
        serde_json::json!({}),
        serde_json::json!({"version":null}),
        serde_json::json!({"version":1}),
        serde_json::json!({"version":0}),
    ] {
        for action in ["reveal", "copy"] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri(format!("{item}/{action}"))
                        .header("authorization", "Bearer session")
                        .header("x-macro-passwords", "1")
                        .header("content-type", "application/json")
                        .body(Body::from(version.to_string()))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::NOT_FOUND);
        }
    }
    for grants in [
        serde_json::json!([]),
        serde_json::json!([{"kind":"team","id":team.to_string(),"permission":"edit"}]),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("{item}/share"))
                    .header("authorization", "Bearer session")
                    .header("x-macro-passwords", "1")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::json!({"grants":grants}).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
    for (method, path, content, body) in [
        (
            "POST",
            format!("{item}/reveal"),
            "application/json",
            "{".to_owned(),
        ),
        (
            "POST",
            format!("{item}/reveal"),
            "application/json",
            String::new(),
        ),
        (
            "POST",
            format!("{item}/reveal"),
            "text/plain",
            "{}".to_owned(),
        ),
        (
            "POST",
            format!("{item}/reveal"),
            "application/json",
            "x".repeat(262145),
        ),
        (
            "POST",
            format!("{item}/reveal?version=oops"),
            "application/json",
            "{\"version\":\"oops\"}".to_owned(),
        ),
        (
            "GET",
            "/teams/not-a-uuid/items".to_owned(),
            "application/json",
            "{}".to_owned(),
        ),
        (
            "PUT",
            format!("{item}/reveal"),
            "application/json",
            "{}".to_owned(),
        ),
        (
            "OPTIONS",
            format!("{item}/reveal"),
            "application/json",
            "{}".to_owned(),
        ),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .header("authorization", "Bearer session")
                    .header("x-macro-passwords", "1")
                    .header("content-type", content)
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert!(response.status().is_client_error());
    }
    assert_eq!(repository.calls.load(Ordering::SeqCst), 0);
    assert_eq!(provider.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn session_shaped_agent_account_is_denied_with_team_and_existing_direct_grants() {
    use crate::outbound::availability::PASSWORDS_FLAG;
    use feature_flags::{FlagSnapshot, FlagValue};
    use std::sync::atomic::Ordering;
    for kind in ["team", "user"] {
        let (app, repository, provider) = flagged_app(
            Ok(FlagSnapshot::new([(
                PASSWORDS_FLAG.into(),
                FlagValue::Boolean(true),
            )])),
            true,
        );
        let team = TeamId(Uuid::from_u128(1));
        let item = ItemId(Uuid::from_u128(2));
        let agent = "macro|agent@example.test";
        repository
            .memberships
            .lock()
            .unwrap()
            .insert(agent.into(), vec![team]);
        repository.agents.lock().unwrap().insert(agent.into());
        let now = chrono::Utc::now();
        let record:Record=serde_json::from_value(serde_json::json!({
            "user_id":"macro|creator@example.com", "grants":[{"kind":kind,"id":if kind=="team" {team.0.to_string()} else {agent.into()},"permission":"edit"}],
            "deleting":false,"revision":1,"totp_key_id":null,
            "metadata":{"id":item,"teamId":team,"name":"Credential","kind":"login","url":null,"folderId":null,"favorite":false,"version":1,"hasTotp":false,"shared":true,"shareCount":1,"createdAt":now,"updatedAt":now,"lastUsedAt":null}
        })).unwrap();
        repository.records.lock().unwrap().insert(item.0, record);
        for (method, path, body) in routes() {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri(&path)
                        .header("authorization", "Bearer agent-session")
                        .header("x-macro-passwords", "1")
                        .header("content-type", "application/json")
                        .body(Body::from(body.to_string()))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(
                response.status(),
                StatusCode::FORBIDDEN,
                "{kind}: {method} {path}"
            );
            assert_eq!(response.headers()[CACHE_CONTROL], "private, no-store");
        }
        assert_eq!(repository.lock_calls.load(Ordering::SeqCst), 0);
        assert_eq!(provider.calls.load(Ordering::SeqCst), 0);
        assert_eq!(repository.records.lock().unwrap().len(), 1);
        assert!(repository.staged.lock().unwrap().is_empty());
        repository
            .memberships
            .lock()
            .unwrap()
            .insert("macro|synthetic@example.test".into(), vec![team]);
        let human = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/teams")
                    .header("authorization", "Bearer session")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            human.status(),
            StatusCode::OK,
            "both flags, provider configuration and a human admit normal access"
        );
    }
}

#[tokio::test]
async fn import_enforces_body_and_batch_limits_without_echoing_payloads() {
    use crate::domain::service::test::fakes::*;
    let repository = Arc::new(FakeRepository::new());
    let team = TeamId(Uuid::from_u128(1));
    repository
        .memberships
        .lock()
        .unwrap()
        .insert("macro|synthetic@example.test".into(), vec![team]);
    let app = router(PasswordRouterState {
        authorization: MacroAuthorizationState::new(Arc::new(Authorization)),
        service: Arc::new(PasswordService {
            repository,
            provider: Arc::new(FakeProvider::new()),
            availability: Arc::new(FakeAvailability),
        }),
    });
    let import = Uuid::now_v7();
    let path = format!("/teams/{}/imports/{import}/items", team.0);
    // A payload above the ordinary route's 256 KiB limit is allowed on this route.
    let value = "x".repeat(65536);
    let item = serde_json::json!({"sourceKey":"one","name":"Synthetic fixture","kind":"login","favorite":false,
        "values":{"username":value,"password":value,"notes":value,"fields":[{"label":"Synthetic","value":value}]}});
    let mut body = serde_json::json!({"format":"bitwarden_json","target":{"kind":"root"},"private":true,"folders":[],"items":[item]});
    let text = body.to_string();
    assert!(text.len() > 256 * 1024);
    for (text, expected) in [
        (text, StatusCode::OK),
        (
            {
                body["items"] = serde_json::json!(
                    (0..26)
                        .map(|_| body["items"][0].clone())
                        .collect::<Vec<_>>()
                );
                body.to_string()
            },
            StatusCode::PAYLOAD_TOO_LARGE,
        ),
        (
            "x".repeat(4 * 1024 * 1024 + 1),
            StatusCode::PAYLOAD_TOO_LARGE,
        ),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(&path)
                    .header("authorization", "Bearer session")
                    .header("x-macro-passwords", "1")
                    .header("content-type", "application/json")
                    .body(Body::from(text))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), expected);
        assert_eq!(response.headers()[CACHE_CONTROL], "private, no-store");
    }
    let invalid = serde_json::json!({"format":"bitwarden_json","target":{"kind":"root"},"private":true,"folders":[],"items":(0..26).map(|i|serde_json::json!({"sourceKey":i.to_string(),"name":"Synthetic","kind":"login","favorite":false,"values":{"username":"","password":"","notes":"","fields":[]}})).collect::<Vec<_>>()});
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(path)
                .header("authorization", "Bearer session")
                .header("x-macro-passwords", "1")
                .header("content-type", "application/json")
                .body(Body::from(invalid.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}
