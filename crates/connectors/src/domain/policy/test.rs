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
                MACRO_CONNECT_FLAG.to_owned(),
                FlagValue::Boolean(*on),
            )])),
            Err(message) => Err(rootcause::report!("{message}")),
        }
    }
}

fn loads(flag: &MacroConnectFlag<CountingFlags>) -> usize {
    flag.flags.as_ref().unwrap().loads.load(Ordering::SeqCst)
}

#[tokio::test]
async fn reads_the_flag_once_per_user_within_the_cache_window() {
    let flag = MacroConnectFlag::new(Some(CountingFlags::new(Ok(true))));

    assert!(flag.read(&user()).await.unwrap());
    assert!(flag.read(&user()).await.unwrap());
    assert_eq!(loads(&flag), 1);
}

#[tokio::test]
async fn a_failed_read_is_an_error_and_is_not_cached() {
    let flag = MacroConnectFlag::new(Some(CountingFlags::new(Err("down".to_owned()))));

    assert!(flag.read(&user()).await.is_err());
    assert!(flag.read(&user()).await.is_err());
    assert_eq!(loads(&flag), 2);
}

#[tokio::test]
async fn a_flag_off_reads_off() {
    let flag = MacroConnectFlag::new(Some(CountingFlags::new(Ok(false))));

    assert!(!flag.read(&user()).await.unwrap());
}

#[tokio::test]
async fn without_a_flag_provider_nobody_is_flagged() {
    let flag = MacroConnectFlag::<CountingFlags>::new(None);

    assert!(!flag.read(&user()).await.unwrap());
}
