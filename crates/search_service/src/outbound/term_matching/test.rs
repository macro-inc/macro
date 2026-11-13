use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use feature_flags::{FlagSnapshot, FlagValue};

use super::*;

/// A provider that counts its loads and takes `delay` to answer.
#[derive(Clone)]
struct CountingFlags {
    loads: Arc<AtomicUsize>,
    answer: Result<bool, ()>,
    delay: Duration,
}

impl CountingFlags {
    fn new(answer: Result<bool, ()>) -> Self {
        Self {
            loads: Arc::new(AtomicUsize::new(0)),
            answer,
            delay: Duration::from_millis(250),
        }
    }
}

impl FeatureFlags for CountingFlags {
    async fn load(&self, _: &MacroUserIdStr<'_>) -> Result<FlagSnapshot, rootcause::Report> {
        self.loads.fetch_add(1, Ordering::SeqCst);
        tokio::time::sleep(self.delay).await;
        match self.answer {
            Ok(enabled) => Ok(FlagSnapshot::new([(
                ENABLE_DYNAMIC_SEARCH_TERM_MATCHING.into(),
                FlagValue::Boolean(enabled),
            )])),
            Err(()) => Err(rootcause::report!("flag provider unreachable")),
        }
    }
}

fn caller(id: &str) -> MacroUserIdStr<'_> {
    MacroUserIdStr::parse_from_str(id).unwrap()
}

const PERSON: &str = "macro|person@example.com";
const COLLEAGUE: &str = "macro|colleague@example.com";

#[tokio::test(start_paused = true)]
async fn many_searches_by_one_caller_load_flags_once() {
    let flags = CountingFlags::new(Ok(true));
    let rollout = FlaggedTermMatching::new(flags.clone());

    let started = Instant::now();
    assert!(rollout.dynamic_enabled_for(caller(PERSON)).await);
    let first_search = started.elapsed();

    let started = Instant::now();
    for _ in 0..50 {
        assert!(rollout.dynamic_enabled_for(caller(PERSON)).await);
    }
    let next_fifty_searches = started.elapsed();

    assert_eq!(flags.loads.load(Ordering::SeqCst), 1);
    assert_eq!(first_search, Duration::from_millis(250));
    assert_eq!(next_fifty_searches, Duration::ZERO);
}

#[tokio::test(start_paused = true)]
async fn each_caller_gets_their_own_answer() {
    let flags = CountingFlags::new(Ok(false));
    let rollout = FlaggedTermMatching::new(flags.clone());

    assert!(!rollout.dynamic_enabled_for(caller(PERSON)).await);
    assert!(!rollout.dynamic_enabled_for(caller(COLLEAGUE)).await);
    assert!(!rollout.dynamic_enabled_for(caller(PERSON)).await);

    assert_eq!(flags.loads.load(Ordering::SeqCst), 2);
}

#[tokio::test(start_paused = true)]
async fn an_unreachable_provider_is_not_retried_on_every_search() {
    let flags = CountingFlags::new(Err(()));
    let rollout = FlaggedTermMatching::new(flags.clone());

    for _ in 0..10 {
        assert!(!rollout.dynamic_enabled_for(caller(PERSON)).await);
    }

    assert_eq!(flags.loads.load(Ordering::SeqCst), 1);
}

#[tokio::test(start_paused = true)]
async fn the_answer_is_read_again_after_its_lifetime() {
    let flags = CountingFlags::new(Ok(true));
    let rollout = FlaggedTermMatching::new(flags.clone());

    rollout.dynamic_enabled_for(caller(PERSON)).await;
    tokio::time::advance(DECISION_LIFETIME).await;
    rollout.dynamic_enabled_for(caller(PERSON)).await;

    assert_eq!(flags.loads.load(Ordering::SeqCst), 2);
}
