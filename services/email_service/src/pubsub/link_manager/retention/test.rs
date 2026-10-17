use super::*;

fn probe(result: Result<(), EmailApiError>) -> Option<Result<(), EmailApiError>> {
    Some(result)
}

#[test]
fn valid_cursor_catches_up_incrementally() {
    assert_eq!(
        choose_catch_up(probe(Ok(()))).unwrap(),
        CatchUp::Incremental
    );
}

#[test]
fn expired_history_falls_back_to_partial_resync() {
    assert_eq!(
        choose_catch_up(probe(Err(EmailApiError::OutdatedCursor))).unwrap(),
        CatchUp::PartialResync
    );
}

#[test]
fn missing_cursor_falls_back_to_partial_resync() {
    assert_eq!(choose_catch_up::<()>(None).unwrap(), CatchUp::PartialResync);
}

#[test]
fn permanent_cursor_rejection_falls_back_to_partial_resync() {
    for error in [
        EmailApiError::NotFound,
        EmailApiError::Permanent {
            message: "bad cursor".to_string(),
        },
    ] {
        assert_eq!(
            choose_catch_up(probe(Err(error))).unwrap(),
            CatchUp::PartialResync
        );
    }
}

#[test]
fn retryable_and_reauth_errors_are_returned() {
    for error in [
        EmailApiError::Transient {
            message: "blip".to_string(),
        },
        EmailApiError::AuthRequired,
    ] {
        assert!(choose_catch_up(probe(Err(error))).is_err());
    }
}
