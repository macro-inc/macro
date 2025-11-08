use axum::{body::to_bytes, extract::FromRequestParts, http::Request};
use cool_asserts::assert_matches;
use serde_utils::Container;

use super::*;

#[tokio::test]
async fn it_should_deserialize_query_params() {
    let sso_state = SsoState {
        original_url: Some("https://example.com".parse().unwrap()),
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

    assert_matches!(data, OAuthCbParams { code, state: Some(container) } => {
        assert_eq!(code, "test123");
        assert_matches!(container.decode().unwrap(), SsoState { original_url: Some(url), is_mobile: true } => {
            assert_eq!(url.as_str(), "https://example.com/");
        })
    });
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
    let res = get_redirect_url(
        OAuthCbParams {
            code: "code".into(),
            state: None,
        },
        async |x| dummy.cb(x).await,
    )
    .await;
    assert_eq!(dummy.called, 0);
    assert_eq!(res.unwrap(), default_redirect_url());
}

#[tokio::test]
async fn it_writes_session_code_to_db() {
    let mut dummy = DummyCb::default();
    let res = get_redirect_url(
        OAuthCbParams {
            code: "code".into(),
            state: Some(
                Container::new(&SsoState {
                    original_url: Some("https://example.com".parse().unwrap()),
                    is_mobile: true,
                })
                .unwrap(),
            ),
        },
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
            .find(|e| e.0 == "session_code" && !e.1.is_empty())
            .is_some()
    );
}

#[test]
fn html_redirect_works() {
    let res = html_redirect_inner(&"https://example.com".parse().unwrap()).into_string();
    dbg!(&res);
    assert!(res.contains(r#"<meta http-equiv="refresh" content="0;url=https://example.com/">"#));
}
