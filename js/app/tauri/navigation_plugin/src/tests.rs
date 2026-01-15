use super::*;

#[test]
fn transform_external_url_adds_is_mobile_when_query_exists() {
    let url = Url::parse("https://example.com/path?foo=bar").unwrap();
    let result = transform_external_url(url);
    assert_eq!(
        result.query_pairs().find(|(k, _)| k == "is_mobile"),
        Some((Cow::Borrowed("is_mobile"), Cow::Borrowed("true")))
    );
}

#[test]
fn transform_external_url_no_query_does_not_add_is_mobile() {
    let url = Url::parse("https://example.com/path").unwrap();
    let result = transform_external_url(url);
    assert_eq!(result.query_pairs().find(|(k, _)| k == "is_mobile"), None);
}

#[test]
fn transform_external_url_preserves_existing_is_mobile_true() {
    let url = Url::parse("https://example.com/path?is_mobile=true").unwrap();
    let result = transform_external_url(url);
    let is_mobile_count = result
        .query_pairs()
        .filter(|(k, _)| k == "is_mobile")
        .count();
    assert_eq!(is_mobile_count, 1);
    assert_eq!(
        result.query_pairs().find(|(k, _)| k == "is_mobile"),
        Some((Cow::Borrowed("is_mobile"), Cow::Borrowed("true")))
    );
}

#[test]
fn transform_external_url_preserves_existing_is_mobile_false() {
    let url = Url::parse("https://example.com/path?is_mobile=false").unwrap();
    let result = transform_external_url(url);
    let is_mobile_count = result
        .query_pairs()
        .filter(|(k, _)| k == "is_mobile")
        .count();
    assert_eq!(is_mobile_count, 1);
    assert_eq!(
        result.query_pairs().find(|(k, _)| k == "is_mobile"),
        Some((Cow::Borrowed("is_mobile"), Cow::Borrowed("false")))
    );
}

#[test]
fn transform_external_url_preserves_other_query_params() {
    let url = Url::parse("https://example.com/path?foo=bar&baz=qux").unwrap();
    let result = transform_external_url(url);
    assert_eq!(
        result.query_pairs().find(|(k, _)| k == "foo"),
        Some((Cow::Borrowed("foo"), Cow::Borrowed("bar")))
    );
    assert_eq!(
        result.query_pairs().find(|(k, _)| k == "baz"),
        Some((Cow::Borrowed("baz"), Cow::Borrowed("qux")))
    );
    assert_eq!(
        result.query_pairs().find(|(k, _)| k == "is_mobile"),
        Some((Cow::Borrowed("is_mobile"), Cow::Borrowed("true")))
    );
}

