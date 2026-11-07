use super::*;

/// The happy path is covered by the sync service's tests, which sign with a
/// real test key. What is worth pinning here is that an unusable key fails
/// loudly rather than producing a token GitHub will silently reject.
#[test]
fn an_unusable_key_is_an_error() {
    let error = app_jwt("Iv1.client", "not a pem").expect_err("refused");

    assert!(matches!(error, GithubError::Internal(_)));
}
