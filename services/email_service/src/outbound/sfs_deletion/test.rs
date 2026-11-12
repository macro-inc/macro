use super::*;

#[test]
fn request_status_is_extracted_without_changing_the_original_error() {
    for status in [404, 403, 500] {
        let response = reqwest::Response::from(
            axum::http::Response::builder()
                .status(status)
                .body("")
                .unwrap(),
        );
        let source = anyhow::Error::new(response.error_for_status().unwrap_err())
            .context("original context");
        let original = format!("{source:?}");
        let mapped = deletion_error(source);
        assert_eq!(mapped.response_status, Some(status));
        assert_eq!(format!("{:?}", mapped.source), original);
        assert_eq!(
            mapped
                .source
                .downcast_ref::<reqwest::Error>()
                .unwrap()
                .status()
                .unwrap()
                .as_u16(),
            status
        );
    }
}

#[test]
fn request_error_without_status_stays_without_status() {
    let source = reqwest::Client::new()
        .get("http://[invalid")
        .build()
        .unwrap_err();
    assert!(source.status().is_none());
    let mapped = deletion_error(anyhow::Error::new(source).context("original context"));
    assert_eq!(mapped.response_status, None);
    assert!(mapped.source.downcast_ref::<reqwest::Error>().is_some());
    assert_eq!(mapped.source.to_string(), "original context");
}

#[test]
fn non_request_error_cannot_acquire_a_response_status() {
    let source = anyhow::anyhow!("404").context("original context");
    let original = format!("{source:?}");
    let mapped = deletion_error(source);
    assert_eq!(mapped.response_status, None);
    assert_eq!(format!("{:?}", mapped.source), original);
}
