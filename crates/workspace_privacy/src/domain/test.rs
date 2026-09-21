use super::*;

fn status() -> PrivacyStatus {
    PrivacyStatus {
        team_id: Some(Uuid::nil()),
        is_admin: true,
        paid: true,
        hipaa_ready: true,
        ..Default::default()
    }
}

#[test]
fn only_paid_ready_admins_can_enable() {
    let request = SetPrivacyRequest {
        enabled: true,
        expected_revision: 0,
    };
    assert!(authorize_change(&status(), &request).is_ok());
    assert!(matches!(
        authorize_change(
            &PrivacyStatus {
                is_admin: false,
                ..status()
            },
            &request
        ),
        Err(PrivacyError::Forbidden)
    ));
    assert!(matches!(
        authorize_change(
            &PrivacyStatus {
                paid: false,
                ..status()
            },
            &request
        ),
        Err(PrivacyError::PaymentRequired)
    ));
    assert!(matches!(
        authorize_change(
            &PrivacyStatus {
                hipaa_ready: false,
                ..status()
            },
            &request
        ),
        Err(PrivacyError::NotReady)
    ));
}

#[test]
fn downgrade_does_not_disable_existing_protection_or_prevent_admin_disabling() {
    let current = PrivacyStatus {
        hipaa_enabled: true,
        paid: false,
        hipaa_ready: false,
        ..status()
    };
    for enabled in [false, true] {
        assert!(
            authorize_change(
                &current,
                &SetPrivacyRequest {
                    enabled,
                    expected_revision: 0
                }
            )
            .is_ok()
        );
    }
    assert!(current.hipaa_enabled);
}

#[test]
fn stale_tabs_cannot_overwrite_a_newer_decision() {
    assert!(matches!(
        authorize_change(
            &status(),
            &SetPrivacyRequest {
                enabled: false,
                expected_revision: 1
            }
        ),
        Err(PrivacyError::Conflict)
    ));
}
