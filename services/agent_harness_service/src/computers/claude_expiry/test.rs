use chrono::{TimeZone, Utc};
use harness_id::HarnessId;
use hosted_runtimes::domain::claude_sign_in::ClaudeSignInNotice;
use hosted_runtimes::domain::ids::ComputerId;

use super::*;

#[test]
fn every_delivery_of_a_notice_has_one_notification_id_and_each_stage_its_own() {
    let soon = SignInExpiry {
        computer_id: ComputerId::new_from_uuid(Uuid::from_u128(1)),
        harness_id: HarnessId::new_from_uuid(Uuid::from_u128(
            0x0000_0000_0000_7000_8000_0000_0000_0c0c,
        )),
        computer_name: "Build box".to_owned(),
        notice: ClaudeSignInNotice {
            signed_in_at: Utc.with_ymd_and_hms(2026, 11, 1, 12, 0, 0).unwrap(),
            stage: ClaudeSignInStage::ExpiresSoon,
            expires_at: Some(Utc.with_ymd_and_hms(2026, 11, 20, 12, 0, 0).unwrap()),
        },
    };
    let renamed = SignInExpiry {
        computer_name: "Renamed box".to_owned(),
        ..soon.clone()
    };
    let today = SignInExpiry {
        notice: ClaudeSignInNotice {
            stage: ClaudeSignInStage::ExpiresToday,
            ..soon.notice
        },
        ..soon.clone()
    };

    assert_eq!(notification_id(&soon), notification_id(&renamed));
    assert_ne!(notification_id(&soon), notification_id(&today));
}
