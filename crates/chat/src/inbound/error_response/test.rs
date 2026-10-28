use super::*;

#[test]
fn maps_domain_errors_to_status_codes() {
    let cases = [
        (ChatErr::NotFound, StatusCode::NOT_FOUND),
        (
            ChatErr::BadRequest("bad".to_string()),
            StatusCode::BAD_REQUEST,
        ),
        (ChatErr::Conflict("stale".to_string()), StatusCode::CONFLICT),
        (
            ChatErr::Access(AccessError::Unauthorized),
            StatusCode::FORBIDDEN,
        ),
        (
            ChatErr::Unknown(anyhow::anyhow!("boom")),
            StatusCode::INTERNAL_SERVER_ERROR,
        ),
    ];

    for (error, status) in cases {
        assert_eq!(error.into_response().status(), status);
    }
}
