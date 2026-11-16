use super::*;

#[test]
fn an_upstream_failure_is_an_unreachable_connected_app() {
    let error = egress_error(EgressError::Upstream(rootcause::report!(
        "Transport channel closed"
    )));

    assert!(matches!(error, CodeModeError::ConnectedAppUnreachable));
}
