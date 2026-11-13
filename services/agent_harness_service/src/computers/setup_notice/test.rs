use chrono::{TimeZone, Utc};
use harness_id::HarnessId;
use hosted_runtimes::domain::ids::ComputerId;
use hosted_runtimes::domain::lifecycle::Failure;
use macro_user_id::user_id::MacroUserIdStr;

use super::*;

fn ready() -> SetupNotice {
    SetupNotice {
        computer_id: ComputerId::new_from_uuid(Uuid::from_u128(1)),
        team_id: Uuid::from_u128(2),
        harness_id: Some(HarnessId::new_from_uuid(Uuid::from_u128(
            0x0000_0000_0000_7000_8000_0000_0000_0c0c,
        ))),
        computer_name: "Build box".to_owned(),
        buyer: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
        outcome: SetupOutcome::Ready,
    }
}

fn failed_at(hour: u32) -> SetupNotice {
    SetupNotice {
        harness_id: None,
        outcome: SetupOutcome::Failed {
            failure: Failure::Create,
            failed_at: Utc.with_ymd_and_hms(2026, 11, 13, hour, 0, 0).unwrap(),
        },
        ..ready()
    }
}

#[test]
fn every_delivery_of_an_outcome_has_one_notification_id_and_each_attempt_its_own() {
    let renamed = SetupNotice {
        computer_name: "Renamed box".to_owned(),
        ..ready()
    };
    let other_computer = SetupNotice {
        computer_id: ComputerId::new_from_uuid(Uuid::from_u128(3)),
        ..ready()
    };

    assert_eq!(notification_id(&ready()), notification_id(&renamed));
    assert_ne!(notification_id(&ready()), notification_id(&other_computer));
    assert_eq!(
        notification_id(&failed_at(12)),
        notification_id(&failed_at(12))
    );
    assert_ne!(
        notification_id(&failed_at(12)),
        notification_id(&failed_at(13))
    );
    assert_ne!(notification_id(&ready()), notification_id(&failed_at(12)));
}
