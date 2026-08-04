use super::*;

#[test]
fn detects_coordinator_failure_without_replaying_unclaimed_transition() {
    let permanent = anyhow::Error::new(GoogleCalendarBackfillRunError::Permanent(
        "invalid event".into(),
    ));
    assert_eq!(coordinator_reauth_edge(&permanent), Some(false));
}

#[test]
fn preserves_coordinator_reauth_notification_edge_through_context() {
    let reauth = anyhow::Error::new(GoogleCalendarBackfillRunError::ReauthRequired {
        message: "insufficient permissions".into(),
        link_reauth_transitioned: true,
    })
    .context("calendar worker failed");
    assert_eq!(coordinator_reauth_edge(&reauth), Some(true));
}

#[test]
fn prelease_failure_has_no_coordinator_marker() {
    assert_eq!(
        coordinator_reauth_edge(&anyhow::anyhow!("token refresh failed")),
        None
    );
}
