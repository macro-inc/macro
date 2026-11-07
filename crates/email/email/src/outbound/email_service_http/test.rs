use super::*;

#[test]
fn success_statuses_are_provisioned() {
    assert_eq!(
        classify_init_status(StatusCode::OK),
        Some(FirstInboxProvisionOutcome::Provisioned)
    );
    assert_eq!(
        classify_init_status(StatusCode::CREATED),
        Some(FirstInboxProvisionOutcome::Provisioned)
    );
}

#[test]
fn bad_request_is_skipped() {
    assert_eq!(
        classify_init_status(StatusCode::BAD_REQUEST),
        Some(FirstInboxProvisionOutcome::Skipped)
    );
}

#[test]
fn other_statuses_are_errors() {
    for status in [
        StatusCode::UNAUTHORIZED,
        StatusCode::CONFLICT,
        StatusCode::TOO_MANY_REQUESTS,
        StatusCode::INTERNAL_SERVER_ERROR,
    ] {
        assert_eq!(classify_init_status(status), None);
    }
}
