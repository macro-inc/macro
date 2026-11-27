use super::*;
use feature_flags::outbound::fake::FakeFeatureFlags;
use feature_flags::{FlagSnapshot, FlagValue};
use macro_user_id::cowlike::CowLike;

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|owner@example.com")
        .unwrap()
        .into_owned()
}

#[tokio::test]
async fn backfill_is_off_unless_the_flag_opts_the_user_in() {
    assert!(
        !FlaggedBackfill::<FakeFeatureFlags>(None)
            .enabled(&user())
            .await
            .unwrap()
    );

    let mut absent = FakeFeatureFlags::default();
    absent.set(user(), Ok(FlagSnapshot::default()));
    assert!(
        !FlaggedBackfill(Some(absent))
            .enabled(&user())
            .await
            .unwrap()
    );

    let mut opted_in = FakeFeatureFlags::default();
    opted_in.set(
        user(),
        Ok(FlagSnapshot::new([(
            BACKFILL_FLAG.into(),
            FlagValue::Boolean(true),
        )])),
    );
    assert!(
        FlaggedBackfill(Some(opted_in))
            .enabled(&user())
            .await
            .unwrap()
    );
}
