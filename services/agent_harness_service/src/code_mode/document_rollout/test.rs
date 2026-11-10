use super::*;
use feature_flags::{FlagSnapshot, FlagValue};
use rootcause::Report;
use std::sync::atomic::{AtomicUsize, Ordering};

/// Flags whose answers are set per call, counting the loads.
#[derive(Default)]
struct Flags {
    answers: Mutex<Vec<Result<bool, &'static str>>>,
    loads: AtomicUsize,
}

impl FeatureFlags for Flags {
    async fn load(&self, _user: &MacroUserIdStr<'_>) -> Result<FlagSnapshot, Report> {
        self.loads.fetch_add(1, Ordering::SeqCst);
        match self.answers.lock().unwrap().remove(0) {
            Ok(enabled) => Ok(FlagSnapshot::new([(
                DOCUMENT_PROGRAMS_FLAG.into(),
                FlagValue::Boolean(enabled),
            )])),
            Err(message) => Err(rootcause::report!("{message}")),
        }
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|person@example.com").unwrap()
}

#[tokio::test(start_paused = true)]
async fn reuses_an_answer_for_a_minute_then_asks_again() {
    let gate = FlaggedDocumentPrograms::new(
        Some(Flags {
            answers: Mutex::new(vec![Ok(true), Ok(false)]),
            ..Flags::default()
        }),
        false,
    );

    assert!(gate.allows(&user()).await);
    assert!(gate.allows(&user()).await);
    assert_eq!(gate.flags.as_ref().unwrap().loads.load(Ordering::SeqCst), 1);

    tokio::time::advance(ROLLOUT_TTL).await;
    assert!(!gate.allows(&user()).await);
    assert_eq!(gate.flags.as_ref().unwrap().loads.load(Ordering::SeqCst), 2);
}

#[tokio::test(start_paused = true)]
async fn a_failed_read_keeps_the_last_answer_and_refuses_without_one() {
    let gate = FlaggedDocumentPrograms::new(
        Some(Flags {
            answers: Mutex::new(vec![Err("down"), Ok(true), Err("down")]),
            ..Flags::default()
        }),
        false,
    );

    assert!(!gate.allows(&user()).await);
    assert!(gate.allows(&user()).await);

    tokio::time::advance(ROLLOUT_TTL).await;
    assert!(gate.allows(&user()).await);
}
