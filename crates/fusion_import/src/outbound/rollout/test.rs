use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};
use macro_user_id::cowlike::CowLike;

use super::*;

fn person() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|designer@example.com")
        .unwrap()
        .into_owned()
}

fn flags_for(result: Result<FlagSnapshot, String>) -> FlaggedFusionImport<FakeFeatureFlags> {
    let mut flags = FakeFeatureFlags::default();
    flags.set(person(), result);
    FlaggedFusionImport(flags)
}

#[tokio::test]
async fn the_flag_turns_the_import_on_for_that_person() {
    let rollout = flags_for(Ok(FlagSnapshot::new([(
        FUSION_IMPORT_FLAG.to_string(),
        FlagValue::Boolean(true),
    )])));

    assert!(rollout.enabled_for(&person()).await);
}

#[tokio::test]
async fn a_flag_that_is_off_or_missing_keeps_the_import_off() {
    let off = flags_for(Ok(FlagSnapshot::new([(
        FUSION_IMPORT_FLAG.to_string(),
        FlagValue::Boolean(false),
    )])));
    let missing = flags_for(Ok(FlagSnapshot::default()));

    assert!(!off.enabled_for(&person()).await);
    assert!(!missing.enabled_for(&person()).await);
}

#[tokio::test]
async fn a_flag_load_that_fails_keeps_the_import_off() {
    let rollout = flags_for(Err("flag service unavailable".to_string()));

    assert!(!rollout.enabled_for(&person()).await);
}
