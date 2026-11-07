use std::time::Duration;

use feature_flags::FeatureFlags;
use feature_flags::outbound::posthog_local::PostHogLocalFeatureFlags;
use macro_env::Environment;
use macro_user_id::user_id::MacroUserIdStr;

use super::{FOCUS_FLAG, FocusStandIns, POSTHOG_PROJECT_KEY, POSTHOG_SECRET_KEY};

/// The worker's reader of the flag, pointed at the stand-in as the stack
/// points the worker.
fn worker_flags(stand_ins: &FocusStandIns) -> PostHogLocalFeatureFlags {
    PostHogLocalFeatureFlags::new(
        &stand_ins.flags_url(),
        POSTHOG_PROJECT_KEY,
        POSTHOG_SECRET_KEY.to_owned(),
        &[FOCUS_FLAG],
        Duration::from_secs(10),
        Environment::Local,
    )
    .unwrap()
}

async fn has_flag(flags: &PostHogLocalFeatureFlags, address: &str) -> bool {
    let id = format!("macro|{address}");
    let owner = MacroUserIdStr::parse_from_str(&id).unwrap();
    flags.load(&owner).await.unwrap().is_enabled(FOCUS_FLAG)
}

/// The worker reads the flag on for every owner but the one the scenario
/// turned it off for, and the flag cannot be turned off once read: the
/// worker would not see it for five minutes.
#[tokio::test]
async fn the_flag_is_on_for_every_owner_but_those_turned_off() {
    let stand_ins = FocusStandIns::start().await.unwrap();
    let classifier = stand_ins.classifier().clone();
    classifier
        .turn_off_focus_flag_for("bob@example.com")
        .unwrap();
    let flags = worker_flags(&stand_ins);

    assert!(has_flag(&flags, "ada@example.com").await);
    assert!(!has_flag(&flags, "bob@example.com").await);
    assert!(
        classifier
            .turn_off_focus_flag_for("ada@example.com")
            .is_err()
    );
    stand_ins.stop().await;
}

/// Without an owner turned off, the definition the worker reads holds no
/// condition it refuses to evaluate.
#[tokio::test]
async fn every_owner_has_the_flag_by_default() {
    let stand_ins = FocusStandIns::start().await.unwrap();
    let flags = worker_flags(&stand_ins);

    assert!(has_flag(&flags, "ada@example.com").await);
    stand_ins.stop().await;
}
