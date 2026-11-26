use super::*;
use feature_flags::{FlagSnapshot, FlagValue};
use std::sync::atomic::{AtomicUsize, Ordering};

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|user@example.com").unwrap()
}

/// Answers every load with `answer`, counting the loads.
struct CountingFlags {
    answer: Result<bool, String>,
    loads: AtomicUsize,
}

impl CountingFlags {
    fn new(answer: Result<bool, String>) -> Self {
        Self {
            answer,
            loads: AtomicUsize::new(0),
        }
    }
}

impl FeatureFlags for CountingFlags {
    async fn load(&self, _user: &MacroUserIdStr<'_>) -> Result<FlagSnapshot, rootcause::Report> {
        self.loads.fetch_add(1, Ordering::SeqCst);
        match &self.answer {
            Ok(on) => Ok(FlagSnapshot::new([(
                MACRO_CONNECT_ENABLED_FLAG_KEY.to_owned(),
                FlagValue::Boolean(*on),
            )])),
            Err(message) => Err(rootcause::report!("{message}")),
        }
    }
}

fn loads(macro_connect_enabled: &CachedMacroConnectEnabledFlag<CountingFlags>) -> usize {
    macro_connect_enabled
        .flags
        .as_ref()
        .unwrap()
        .loads
        .load(Ordering::SeqCst)
}

#[tokio::test]
async fn reads_the_flag_once_per_user_within_the_cache_window() {
    let macro_connect_enabled =
        CachedMacroConnectEnabledFlag::new(Some(CountingFlags::new(Ok(true))));

    assert!(macro_connect_enabled.read(&user()).await.unwrap());
    assert!(macro_connect_enabled.read(&user()).await.unwrap());
    assert_eq!(loads(&macro_connect_enabled), 1);
}

#[tokio::test]
async fn a_failed_read_is_an_error_and_is_not_cached() {
    let macro_connect_enabled =
        CachedMacroConnectEnabledFlag::new(Some(CountingFlags::new(Err("down".to_owned()))));

    assert!(macro_connect_enabled.read(&user()).await.is_err());
    assert!(macro_connect_enabled.read(&user()).await.is_err());
    assert_eq!(loads(&macro_connect_enabled), 2);
}

#[tokio::test]
async fn a_macro_connect_off_reads_off() {
    let macro_connect_enabled =
        CachedMacroConnectEnabledFlag::new(Some(CountingFlags::new(Ok(false))));

    assert!(!macro_connect_enabled.read(&user()).await.unwrap());
}

#[tokio::test]
async fn without_a_flag_provider_nobody_is_flagged() {
    let macro_connect_enabled = CachedMacroConnectEnabledFlag::<CountingFlags>::new(None);

    assert!(!macro_connect_enabled.read(&user()).await.unwrap());
}
