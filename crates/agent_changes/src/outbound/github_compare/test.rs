use super::*;

#[test]
fn refs_keep_their_slashes_and_encode_the_rest() {
    assert_eq!(encode_ref("main"), "main");
    assert_eq!(encode_ref("agent/unread dots"), "agent/unread%20dots");
    assert_eq!(encode_ref("release/2026.09"), "release/2026.09");
    assert_eq!(encode_ref("a#b"), "a%23b");
}

#[test]
fn statuses_map_to_the_domain_errors_the_extractor_reads() {
    assert!(matches!(
        status_error(StatusCode::NOT_FOUND, ""),
        CompareError::NotFound
    ));
    assert!(matches!(
        status_error(StatusCode::NOT_ACCEPTABLE, ""),
        CompareError::TooLarge
    ));
    assert!(matches!(
        status_error(StatusCode::FORBIDDEN, ""),
        CompareError::Unavailable
    ));
    assert!(matches!(
        status_error(StatusCode::INTERNAL_SERVER_ERROR, "oops"),
        CompareError::Other(_)
    ));
}
