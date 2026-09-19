use super::*;
use std::sync::atomic::{AtomicU32, Ordering};

fn transient() -> EmailApiError {
    EmailApiError::Transient {
        message: "blip".to_string(),
    }
}

async fn run_retry(results: Vec<Result<(), EmailApiError>>) -> (Result<(), EmailApiError>, u32) {
    let attempts = AtomicU32::new(0);
    let results = std::sync::Mutex::new(results.into_iter());
    let outcome = retry_teardown(|| {
        attempts.fetch_add(1, Ordering::SeqCst);
        let next = results.lock().unwrap().next().expect("unexpected attempt");
        async move { next }
    })
    .await;
    (outcome, attempts.load(Ordering::SeqCst))
}

#[tokio::test(start_paused = true)]
async fn teardown_retries_transient_failures_then_succeeds() {
    let (outcome, attempts) = run_retry(vec![Err(transient()), Err(transient()), Ok(())]).await;

    assert!(outcome.is_ok());
    assert_eq!(attempts, 3);
}

#[tokio::test(start_paused = true)]
async fn teardown_gives_up_after_three_transient_attempts() {
    let (outcome, attempts) =
        run_retry(vec![Err(transient()), Err(transient()), Err(transient())]).await;

    assert!(matches!(outcome, Err(EmailApiError::Transient { .. })));
    assert_eq!(attempts, 3);
}

#[tokio::test(start_paused = true)]
async fn teardown_does_not_retry_permanent_failures() {
    for error in [
        EmailApiError::Forbidden,
        EmailApiError::AuthRequired,
        EmailApiError::Permanent {
            message: "gone".to_string(),
        },
    ] {
        let (outcome, attempts) = run_retry(vec![Err(error)]).await;

        assert!(outcome.is_err());
        assert_eq!(attempts, 1, "permanent errors must not retry");
    }
}

#[test]
fn settle_reauth_returns_successful_token() {
    let result = settle_reauth_result(Ok(AccessToken::new("token")), false).unwrap();

    assert_eq!(result.unwrap().expose_secret(), "token");
}

#[test]
fn settle_reauth_is_terminal_after_health_is_persisted() {
    let result = settle_reauth_result(Err(EmailApiError::AuthRequired), true).unwrap();

    assert!(result.is_none());
}

#[test]
fn settle_reauth_retries_when_health_was_not_persisted() {
    let error = settle_reauth_result(Err(EmailApiError::AuthRequired), false).unwrap_err();

    assert!(matches!(
        error.downcast_ref::<EmailApiError>(),
        Some(EmailApiError::AuthRequired)
    ));
}

#[test]
fn settle_reauth_retries_transient_probe_failures() {
    let error = settle_reauth_result(
        Err(EmailApiError::Transient {
            message: "temporary failure".to_string(),
        }),
        true,
    )
    .unwrap_err();

    assert!(matches!(
        error.downcast_ref::<EmailApiError>(),
        Some(EmailApiError::Transient { .. })
    ));
}
