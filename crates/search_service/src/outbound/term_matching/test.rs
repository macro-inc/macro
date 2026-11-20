use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use feature_flags::{FlagSnapshot, FlagValue};

use super::*;

const PROVIDER_DELAY: Duration = Duration::from_millis(250);

/// A provider that counts its loads and takes [`PROVIDER_DELAY`] to answer.
#[derive(Clone)]
struct SlowFlags {
    loads: Arc<AtomicUsize>,
    enabled: Arc<AtomicBool>,
    reachable: bool,
}

impl SlowFlags {
    fn answering(enabled: bool) -> Self {
        Self {
            loads: Arc::new(AtomicUsize::new(0)),
            enabled: Arc::new(AtomicBool::new(enabled)),
            reachable: true,
        }
    }

    fn unreachable() -> Self {
        Self {
            reachable: false,
            ..Self::answering(false)
        }
    }

    fn loads(&self) -> usize {
        self.loads.load(Ordering::SeqCst)
    }
}

impl FeatureFlags for SlowFlags {
    async fn load(&self, _: &MacroUserIdStr<'_>) -> Result<FlagSnapshot, rootcause::Report> {
        self.loads.fetch_add(1, Ordering::SeqCst);
        tokio::time::sleep(PROVIDER_DELAY).await;
        if !self.reachable {
            return Err(rootcause::report!("flag provider unreachable"));
        }
        Ok(FlagSnapshot::new([(
            ENABLE_DYNAMIC_SEARCH_TERM_MATCHING.into(),
            FlagValue::Boolean(self.enabled.load(Ordering::SeqCst)),
        )]))
    }
}

fn caller(id: &str) -> MacroUserIdStr<'_> {
    MacroUserIdStr::parse_from_str(id).unwrap()
}

/// Lets a started refresh finish: the paused clock runs the provider's
/// earlier timer, and with it the rest of the refresh, before this one.
async fn refresh_finishes() {
    tokio::time::sleep(PROVIDER_DELAY + Duration::from_millis(1)).await;
}

const PERSON: &str = "macro|person@example.com";
const COLLEAGUE: &str = "macro|colleague@example.com";

#[tokio::test(start_paused = true)]
async fn a_search_never_waits_on_a_slow_provider() {
    let flags = SlowFlags::answering(true);
    let rollout = FlaggedTermMatching::new(flags.clone());

    let started = Instant::now();
    let first_answer = rollout.dynamic_enabled_for(caller(PERSON)).await;
    assert_eq!(started.elapsed(), Duration::ZERO);
    assert!(!first_answer, "nothing remembered yet reads as off");

    refresh_finishes().await;
    tokio::time::advance(DECISION_LIFETIME).await;
    let started = Instant::now();
    let lapsed_answer = rollout.dynamic_enabled_for(caller(PERSON)).await;
    assert_eq!(started.elapsed(), Duration::ZERO);
    assert!(lapsed_answer, "a lapsed answer is still the answer");
}

#[tokio::test(start_paused = true)]
async fn the_answer_flips_once_the_refresh_lands() {
    let flags = SlowFlags::answering(true);
    let rollout = FlaggedTermMatching::new(flags.clone());

    assert!(!rollout.dynamic_enabled_for(caller(PERSON)).await);
    refresh_finishes().await;
    assert!(rollout.dynamic_enabled_for(caller(PERSON)).await);

    // The flag turns off for the caller: the next search after the lifetime
    // still answers on, and the one after its refresh answers off.
    flags.enabled.store(false, Ordering::SeqCst);
    tokio::time::advance(DECISION_LIFETIME).await;
    assert!(rollout.dynamic_enabled_for(caller(PERSON)).await);
    refresh_finishes().await;
    assert!(!rollout.dynamic_enabled_for(caller(PERSON)).await);
}

#[tokio::test(start_paused = true)]
async fn searches_during_a_refresh_share_it() {
    let flags = SlowFlags::answering(true);
    let rollout = FlaggedTermMatching::new(flags.clone());

    for _ in 0..50 {
        rollout.dynamic_enabled_for(caller(PERSON)).await;
    }
    refresh_finishes().await;
    for _ in 0..50 {
        assert!(rollout.dynamic_enabled_for(caller(PERSON)).await);
    }
    refresh_finishes().await;

    assert_eq!(flags.loads(), 1);
}

#[tokio::test(start_paused = true)]
async fn each_caller_gets_their_own_refresh() {
    let flags = SlowFlags::answering(true);
    let rollout = FlaggedTermMatching::new(flags.clone());

    rollout.dynamic_enabled_for(caller(PERSON)).await;
    refresh_finishes().await;

    assert!(!rollout.dynamic_enabled_for(caller(COLLEAGUE)).await);
    refresh_finishes().await;
    assert!(rollout.dynamic_enabled_for(caller(COLLEAGUE)).await);
    assert_eq!(flags.loads(), 2);
}

#[tokio::test(start_paused = true)]
async fn an_unreachable_provider_is_remembered_as_off() {
    let flags = SlowFlags::unreachable();
    let rollout = FlaggedTermMatching::new(flags.clone());

    for _ in 0..10 {
        assert!(!rollout.dynamic_enabled_for(caller(PERSON)).await);
        refresh_finishes().await;
    }

    assert_eq!(flags.loads(), 1);
}

#[tokio::test(start_paused = true)]
async fn long_lapsed_answers_are_dropped() {
    let rollout = FlaggedTermMatching::new(SlowFlags::answering(true));

    rollout.dynamic_enabled_for(caller(PERSON)).await;
    refresh_finishes().await;
    tokio::time::advance(DECISION_LIFETIME + LAPSED_DECISION_RETENTION).await;
    rollout.dynamic_enabled_for(caller(COLLEAGUE)).await;
    refresh_finishes().await;

    let decisions = rollout.shared.decisions();
    let callers: Vec<&str> = decisions.by_caller.keys().map(String::as_str).collect();
    assert_eq!(callers, [COLLEAGUE]);
}
