use axum::http::{StatusCode, header::LOCATION};
use url::Url;
use uuid::Uuid;

use super::build_callback_redirect;

#[test]
fn callback_redirect_appends_link_identifiers_and_preserves_query_parameters() {
    let link_id = Uuid::parse_str("694d20f7-ff85-46fd-b17d-5f68ff2d3707").unwrap();
    let original_url = urlencoding::encode("https://app.macro.com/inbox?view=shared&sort=newest");

    let response = build_callback_redirect(&original_url, &link_id).unwrap();
    let redirect_url = Url::parse(response.headers()[LOCATION].to_str().unwrap()).unwrap();
    let query_pairs: Vec<_> = redirect_url.query_pairs().collect();

    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(
        query_pairs,
        vec![
            ("view".into(), "shared".into()),
            ("sort".into(), "newest".into()),
            ("link_id".into(), link_id.to_string().into()),
            ("token".into(), link_id.to_string().into()),
        ]
    );
}

#[test]
fn callback_redirect_replaces_stale_link_identifiers() {
    let link_id = Uuid::parse_str("694d20f7-ff85-46fd-b17d-5f68ff2d3707").unwrap();
    let original_url = urlencoding::encode(
        "https://app.macro.com/inbox?link_id=stale-link&view=shared&token=stale-token",
    );

    let response = build_callback_redirect(&original_url, &link_id).unwrap();
    let redirect_url = Url::parse(response.headers()[LOCATION].to_str().unwrap()).unwrap();
    let query_pairs: Vec<_> = redirect_url.query_pairs().collect();

    assert_eq!(
        query_pairs,
        vec![
            ("view".into(), "shared".into()),
            ("link_id".into(), link_id.to_string().into()),
            ("token".into(), link_id.to_string().into()),
        ]
    );
}
