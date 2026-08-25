use super::{EmailApiError, RateLimitOrigin};

#[test]
fn email_api_error_identifies_transient_failures() {
    assert!(
        EmailApiError::Transient {
            message: "provider unavailable".to_string(),
        }
        .is_transient()
    );
    assert!(
        EmailApiError::RateLimited {
            retry_after: None,
            origin: RateLimitOrigin::Local,
        }
        .is_transient()
    );
    assert!(
        !EmailApiError::Permanent {
            message: "invalid message".to_string(),
        }
        .is_transient()
    );
    assert!(!EmailApiError::OutdatedCursor.is_transient());
}
