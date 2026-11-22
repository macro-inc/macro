//! Legacy mention claims can only narrow an independently verified scope.
use super::*;

fn mention_bearer(scope: Option<&str>, channel: Option<Uuid>) -> String {
    encode_macro_api_token(EncodeMacroApiTokenArgs {
        channel_mention_channel_id: channel,
        fusionauth_id: "fixture".into(),
        macro_user_id: "macro|owner@example.com".into(),
        organization_id: None,
        issuer: "fixture".into(),
        private_key: PRIVATE.into(),
        expiry_seconds: 60,
        agent_id: Some(Uuid::from_u128(3)),
        agent_via: None,
        agent_correlation_id: None,
        agent_session_id: None,
        routine_id: None,
        channel_mention_id: Some(Uuid::from_u128(908)),
        agent_scope: scope.map(str::to_owned),
    })
    .unwrap()
}

fn verified_mention(scope: Option<&str>) -> MacroApiToken {
    let bearer = mention_bearer(scope, None);
    match macro_auth::middleware::decode_jwt::handler(
        &JwtValidationArgs::testing_macro_token("fixture", PUBLIC),
        &bearer,
    )
    .unwrap()
    {
        JwtToken::MacroApiToken(token) => token,
        _ => panic!("expected verified Macro API credential"),
    }
}

#[test]
fn legacy_mentions_keep_the_new_restriction_on_allowed_reads() {
    for scope in [None, Some("no_send"), Some("future_scope")] {
        let token = verified_mention(scope);
        let (parts, _) = Request::builder()
            .uri("/documents/00000000-0000-0000-0000-000000000001/markdown")
            .body(())
            .unwrap()
            .into_parts();
        let accepted = checked_signed_scope(Some(&token), &parts, Some(&["storage"])).unwrap();
        assert_eq!(
            accepted.known().map(SessionScope::as_str),
            Some("channel_mention"),
            "original scope {scope:?}"
        );
    }
}

#[test]
fn a_mention_claim_cannot_widen_an_unknown_signed_scopes_get_only_fallback() {
    assert!(SessionScope::ChannelMention.allows_on(
        Some(&["storage"]),
        "POST",
        "/documents/preview"
    ));
    let token = verified_mention(Some("future_scope"));
    let (parts, _) = Request::builder()
        .method("POST")
        .uri("/documents/preview")
        .body(())
        .unwrap()
        .into_parts();
    assert!(checked_signed_scope(Some(&token), &parts, Some(&["storage"])).is_err());
}

async fn mention_request(bearer: &str, cookie: Option<&str>, path: &str) -> (StatusCode, usize) {
    mention_request_method(bearer, cookie, "GET", path).await
}

async fn mention_request_method(
    bearer: &str,
    cookie: Option<&str>,
    method: &str,
    path: &str,
) -> (StatusCode, usize) {
    mention_request_on(
        bearer,
        cookie,
        method,
        path,
        &["storage", "email", "cognition", "search"],
    )
    .await
}

async fn mention_request_on(
    bearer: &str,
    cookie: Option<&str>,
    method: &str,
    path: &str,
    specs: &'static [&'static str],
) -> (StatusCode, usize) {
    use tower::ServiceExt;
    let calls = Arc::new(AtomicUsize::new(0));
    let observed = calls.clone();
    let app = axum::Router::new()
        .fallback(move || {
            observed.fetch_add(1, Ordering::SeqCst);
            async { StatusCode::OK }
        })
        .layer(axum::middleware::from_fn_with_state(
            CorrelationState {
                jwt: JwtValidationArgs::testing_macro_token("fixture", PUBLIC),
                repository: Arc::new(Repository {
                    calls: AtomicUsize::new(0),
                }),
                specs: Some(specs),
            },
            propagate,
        ));
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("authorization", format!("Bearer {bearer}"));
    if let Some(cookie) = cookie {
        request = request.header("cookie", format!("macro-access-token={cookie}"));
    }
    let response = app
        .oneshot(request.body(axum::body::Body::empty()).unwrap())
        .await
        .unwrap();
    (response.status(), calls.load(Ordering::SeqCst))
}

#[tokio::test]
async fn signed_mentions_read_only_their_origin_channel_and_its_threads() {
    let channel = Uuid::from_u128(910);
    let own = mention_bearer(Some("channel_mention"), Some(channel));
    for path in [
        format!("/channels/{channel}"),
        format!("/channels/{channel}/participants"),
        format!("/channels/{channel}/bots"),
        format!("/channels/{channel}/attachments"),
        format!("/messages/channel/{channel}"),
        format!("/messages/channel/{channel}/timeline"),
        format!("/messages/channel/{channel}/items/{}", Uuid::from_u128(913)),
        format!(
            "/messages/channel/{channel}/threads/{}",
            Uuid::from_u128(913)
        ),
        format!(
            "/dss/v1/messages/channel/{channel}/threads/{}",
            Uuid::from_u128(913)
        ),
    ] {
        assert_eq!(
            mention_request(&own, None, &path).await,
            (StatusCode::OK, 1),
            "{path}"
        );
    }
    for (kind, foreign) in [
        ("another channel", Uuid::from_u128(911)),
        ("another DM", Uuid::from_u128(912)),
    ] {
        for path in [
            format!("/channels/{foreign}"),
            format!("/messages/channel/{foreign}"),
            format!(
                "/messages/channel/{foreign}/threads/{}",
                Uuid::from_u128(913)
            ),
            format!("/dss/v1/messages/channel/{foreign}/timeline"),
            format!("/messages/channel/{foreign}?parent_id={channel}"),
        ] {
            assert_eq!(
                mention_request(&own, None, &path).await,
                (StatusCode::FORBIDDEN, 0),
                "{kind}: {path}"
            );
        }
    }
    let other_parent = format!("/messages/document/{channel}");
    assert_eq!(
        mention_request(&own, None, &other_parent).await,
        (StatusCode::FORBIDDEN, 0)
    );
}

#[tokio::test]
async fn legacy_mentions_without_a_signed_channel_fail_closed_for_channel_reads() {
    let channel = Uuid::from_u128(910);
    for scope in [
        None,
        Some("no_send"),
        Some("channel_mention"),
        Some("future_scope"),
    ] {
        let legacy = mention_bearer(scope, None);
        assert_eq!(
            mention_request(&legacy, None, &format!("/channels/{channel}")).await,
            (StatusCode::FORBIDDEN, 0),
            "{scope:?}"
        );
        assert_eq!(
            mention_request(
                &legacy,
                None,
                "/documents/0192f1a0-0000-7000-8000-000000000001/markdown"
            )
            .await,
            (StatusCode::OK, 1)
        );
    }
}

#[tokio::test]
async fn secondary_mention_credentials_keep_their_own_channel_restriction() {
    let channel = Uuid::from_u128(910);
    let own = mention_bearer(Some("channel_mention"), Some(channel));
    let other = mention_bearer(Some("channel_mention"), Some(Uuid::from_u128(911)));
    let ordinary = mint(None, None, None, None);
    let path = format!("/channels/{channel}");
    assert_eq!(
        mention_request(&ordinary, Some(&own), &path).await,
        (StatusCode::OK, 1)
    );
    assert_eq!(
        mention_request(
            &ordinary,
            Some(&own),
            &format!("/channels/{}", Uuid::from_u128(911))
        )
        .await,
        (StatusCode::FORBIDDEN, 0)
    );
    assert_eq!(
        mention_request(&own, Some(&other), &path).await,
        (StatusCode::FORBIDDEN, 0)
    );
}

#[tokio::test]
async fn mentions_refuse_email_chats_unified_search_and_unbound_channel_lookups() {
    let channel = Uuid::from_u128(910);
    let bearer = mention_bearer(Some("channel_mention"), Some(channel));
    for (method, path) in [
        (
            "GET",
            "/email/attachments/00000000-0000-0000-0000-000000000001",
        ),
        (
            "GET",
            "/email/messages/00000000-0000-0000-0000-000000000001",
        ),
        ("GET", "/chats/00000000-0000-0000-0000-000000000001"),
        ("POST", "/search"),
        ("POST", "/dss/v1/search/simple"),
        ("POST", "/channels/preview"),
        (
            "GET",
            "/channels/attachments/document/00000000-0000-0000-0000-000000000001/references",
        ),
    ] {
        assert_eq!(
            mention_request_method(&bearer, None, method, path).await,
            (StatusCode::FORBIDDEN, 0),
            "{method} {path}"
        );
    }
}

#[tokio::test]
async fn mentions_refuse_personal_enumeration_but_keep_authenticated_by_id_reads() {
    let channel = Uuid::from_u128(910);
    let bearer = mention_bearer(Some("channel_mention"), Some(channel));
    let ordinary = mint(None, None, None, None);
    let cases: &[(&'static [&'static str], &str)] = &[
        (&["contacts"], "/contacts"),
        (&["contacts"], "/contacts/search"),
        (&["calendar"], "/availability-calendars"),
        (&["calendar"], "/calendars"),
        (
            &["calendar"],
            "/events/0192f1a0-0000-7000-8000-000000000001/provider-url",
        ),
        (&["storage"], "/calendar-events"),
        (
            &["storage"],
            "/calendar-events/0192f1a0-0000-7000-8000-000000000001/ics",
        ),
        (
            &["scheduled-action"],
            "/scheduled-actions/0192f1a0-0000-7000-8000-000000000001/history",
        ),
        (&["storage"], "/documents"),
        (&["storage"], "/documents/list"),
    ];
    let mut observed = Vec::new();
    for (specs, path) in cases {
        assert_eq!(
            mention_request_on(&ordinary, None, "GET", path, specs).await,
            (StatusCode::OK, 1),
            "ordinary control {path}"
        );
        observed.push((
            *path,
            mention_request_on(&bearer, None, "GET", path, specs).await,
        ));
    }
    let expected: Vec<_> = cases
        .iter()
        .map(|(_, path)| (*path, (StatusCode::FORBIDDEN, 0)))
        .collect();
    assert_eq!(
        mention_request(
            &bearer,
            None,
            "/documents/0192f1a0-0000-7000-8000-000000000001/markdown"
        )
        .await,
        (StatusCode::OK, 1)
    );
    assert_eq!(
        mention_request(
            &bearer,
            None,
            &format!(
                "/messages/channel/{channel}/threads/{}",
                Uuid::from_u128(913)
            )
        )
        .await,
        (StatusCode::OK, 1)
    );
    assert_eq!(observed, expected);
}

#[tokio::test]
async fn non_channel_mentions_use_host_context_instead_of_message_history() {
    let mention = mention_bearer(Some("channel_mention"), None);
    let ordinary = mint(None, None, None, None);
    let parent = Uuid::from_u128(914);
    for kind in [
        "document",
        "initiative",
        "crm_company",
        "crm_contact",
        "call",
    ] {
        let path = format!("/messages/{kind}/{parent}/threads/{}", Uuid::from_u128(915));
        assert_eq!(
            mention_request(&ordinary, None, &path).await,
            (StatusCode::OK, 1)
        );
        assert_eq!(
            mention_request(&mention, None, &path).await,
            (StatusCode::FORBIDDEN, 0),
            "{kind}"
        );
    }
    assert_eq!(
        mention_request(&mention, None, &format!("/documents/{parent}/markdown")).await,
        (StatusCode::OK, 1)
    );
}
