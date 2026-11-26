use feature_flags::outbound::fake::FakeFeatureFlags;
use strum::IntoEnumIterator;

use super::*;
use crate::domain::ports::ImportsOff;

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap()
}

#[tokio::test]
async fn an_import_without_a_rollout_flag_is_on_even_when_flags_cannot_load() {
    let mut failing = FakeFeatureFlags::default();
    failing.set(user(), Err("PostHog is down".to_owned()));
    let flagged = FlaggedImports(failing);

    for source in ImportSource::iter().filter(|source| source.rollout_flag().is_none()) {
        assert!(flagged.enabled_for(&user(), source).await, "{source:?}");
        assert!(ImportsOff.enabled_for(&user(), source).await, "{source:?}");
    }
}
