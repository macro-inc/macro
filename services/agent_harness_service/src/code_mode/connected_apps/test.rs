use super::*;

#[test]
fn an_upstream_failure_is_an_unreachable_connected_app() {
    let error = egress_error(EgressError::Upstream(rootcause::report!(
        "Transport channel closed"
    )));

    assert!(matches!(error, CodeModeError::ConnectedAppUnreachable));
}

#[test]
fn an_upstream_rate_limit_is_a_rate_limited_connected_app() {
    let error = egress_error(EgressError::RateLimited {
        retry_after: Some(std::time::Duration::from_secs(1)),
    });

    assert!(matches!(
        error,
        CodeModeError::ConnectedAppRateLimited {
            retry_after: Some(_)
        }
    ));
}
