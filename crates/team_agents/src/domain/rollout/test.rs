use std::sync::Mutex;

use feature_flags::{FlagSnapshot, FlagValue};

use super::*;

struct RecordingFlags {
    calls: Mutex<Vec<MacroUserIdStr<'static>>>,
    snapshot: Result<FlagSnapshot, &'static str>,
}

impl FeatureFlags for RecordingFlags {
    async fn load(&self, caller: &MacroUserIdStr<'_>) -> Result<FlagSnapshot, rootcause::Report> {
        use macro_user_id::cowlike::CowLike;
        self.calls
            .lock()
            .expect("lock")
            .push(caller.clone().into_owned());
        self.snapshot
            .clone()
            .map_err(|message| rootcause::report!("{message}"))
    }
}

#[tokio::test]
async fn each_operation_loads_one_snapshot_for_the_exact_user_and_fails_closed() {
    let caller = MacroUserIdStr::parse_from_str("macro|admin@example.com").expect("user id");
    for (snapshot, expected) in [
        (
            Ok(FlagSnapshot::new([(
                TEAM_AGENTS_FLAG.to_owned(),
                FlagValue::Boolean(true),
            )])),
            true,
        ),
        (
            Ok(FlagSnapshot::new([(
                TEAM_AGENTS_FLAG.to_owned(),
                FlagValue::Boolean(false),
            )])),
            false,
        ),
        (Ok(FlagSnapshot::default()), false),
        (Err("provider unavailable"), false),
    ] {
        let rollout = TeamAgentRollout::new(Some(RecordingFlags {
            calls: Mutex::new(vec![]),
            snapshot,
        }));
        assert_eq!(rollout.enabled(&caller).await, expected);
        assert_eq!(
            *rollout
                .flags
                .as_ref()
                .expect("provider")
                .calls
                .lock()
                .expect("lock"),
            vec![caller.clone()]
        );
    }
    let absent = TeamAgentRollout::<RecordingFlags>::new(None);
    assert!(!absent.enabled(&caller).await);
}
