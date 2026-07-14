use axum::{extract::FromRequestParts, http::Request};
use cool_asserts::assert_matches;

use super::*;

#[tokio::test]
async fn it_should_deserialize_query_params() {
    let sso_state = SsoState {
        original_url: Some("https://example.com".parse().unwrap()),
        referral_code: Some("test".to_string()),
        is_mobile: true,
    };

    let json = serde_json::to_string(&sso_state).unwrap();

    let mut url: Url = "https://test.com".parse().unwrap();
    url.query_pairs_mut()
        .append_pair("code", "test123")
        .append_pair("state", &json);

    let (mut parts, ()) = Request::builder()
        .uri(url.as_str())
        .body(())
        .unwrap()
        .into_parts();

    let extract::Query(data) = extract::Query::<OAuthCbParams>::from_request_parts(&mut parts, &())
        .await
        .unwrap();

    assert_matches!(data, OAuthCbParams { code: Some(code), state: Some(container), .. } => {
        assert_eq!(code, "test123");
        assert_matches!(container.decode().unwrap(), SsoState { original_url: Some(url), is_mobile: true, referral_code: Some(code) } => {
            assert_eq!(url.as_str(), "https://example.com/");
            assert_eq!(code.as_str(), "test");
        })
    });
}

#[tokio::test]
async fn it_should_deserialize_error_redirect_without_code() {
    let mut url: Url = "https://test.com".parse().unwrap();
    url.query_pairs_mut()
        .append_pair("error", "invalid_request")
        .append_pair("error_reason", "invalid_origin")
        .append_pair(
            "error_description",
            "Invalid origin uri https://accounts.google.com",
        );

    let (mut parts, ()) = Request::builder()
        .uri(url.as_str())
        .body(())
        .unwrap()
        .into_parts();

    let extract::Query(data) = extract::Query::<OAuthCbParams>::from_request_parts(&mut parts, &())
        .await
        .unwrap();

    assert_matches!(
        data,
        OAuthCbParams {
            code: None,
            state: None,
            error: Some(err),
            error_reason: Some(reason),
            error_description: Some(desc),
        } => {
            assert_eq!(err, "invalid_request");
            assert_eq!(reason, "invalid_origin");
            assert_eq!(desc, "Invalid origin uri https://accounts.google.com");
        }
    );
}

#[derive(Debug, Default)]
struct DummyCb {
    called: usize,
    err: Option<InnerErr>,
}

impl DummyCb {
    async fn cb(&mut self, _code: &SessionCode) -> Result<(), InnerErr> {
        self.called += 1;

        match self.err.take() {
            Some(err) => Err(err),
            None => Ok(()),
        }
    }
}

#[tokio::test]
async fn no_state_is_default_url() {
    let mut dummy = DummyCb::default();
    let res = get_redirect_url(&None, async |x| dummy.cb(x).await).await;
    assert_eq!(dummy.called, 0);
    assert_eq!(res.unwrap(), default_redirect_url());
}

#[tokio::test]
async fn it_writes_session_code_to_db() {
    let mut dummy = DummyCb::default();
    let res = get_redirect_url(
        &Some(SsoState {
            original_url: Some("https://example.com".parse().unwrap()),
            is_mobile: true,
            referral_code: None,
        }),
        async |x| dummy.cb(x).await,
    )
    .await
    .unwrap();
    assert_eq!(dummy.called, 1);
    assert_eq!(res.domain(), Some("example.com"));
    assert_eq!(res.scheme(), "https");
    let query = res.query_pairs();
    let p = query.collect::<Vec<_>>();
    assert!(
        p.iter()
            .find(|e| e.0 == "token" && !e.1.is_empty())
            .is_some()
    );
}

#[tokio::test]
async fn update_url_replaces_existing_token_and_preserves_other_params() {
    let url: Url = "https://example.com?token=old_token&other=param"
        .parse()
        .unwrap();
    let code = SessionCode("new_code".to_string());
    let mut dummy = DummyCb::default();

    let result = update_url_with_session_code(url, Some(&code), async |x| dummy.cb(x).await)
        .await
        .unwrap();

    let pairs: Vec<(String, String)> = result
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();

    let token_pairs: Vec<_> = pairs.iter().filter(|(k, _)| k == "token").collect();
    assert_eq!(token_pairs.len(), 1, "should have exactly one token param");
    assert_eq!(token_pairs[0].1, "new_code");
    assert!(pairs.iter().any(|(k, v)| k == "other" && v == "param"));
    assert_eq!(dummy.called, 1);
}

#[test]
fn html_redirect_works() {
    let res = html_redirect_inner(&"https://example.com".parse().unwrap()).into_string();
    dbg!(&res);
    assert!(res.contains(r#"<meta http-equiv="refresh" content="0;url=https://example.com/">"#));
}
