use super::*;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use std::sync::atomic::{AtomicUsize, Ordering};

// Deliberately implements only the per-user port: no service identity is needed.
struct UserFlags {
    result: Result<FlagSnapshot, String>,
    loads: AtomicUsize,
}
impl FeatureFlags for UserFlags {
    async fn load(&self, user: &MacroUserIdStr<'_>) -> Result<FlagSnapshot, rootcause::Report> {
        assert_eq!(user.as_ref(), "macro|human@example.test");
        self.loads.fetch_add(1, Ordering::SeqCst);
        self.result
            .clone()
            .map_err(|_| rootcause::report!("synthetic flag load failure"))
    }
}

#[tokio::test]
async fn per_user_rollout_fails_closed_without_service_evaluation() {
    for configured in [false, true] {
        for result in [
            Ok(FlagSnapshot::new([(
                PASSWORDS_FLAG.into(),
                FlagValue::Boolean(false),
            )])),
            Ok(FlagSnapshot::default()),
            Ok(FlagSnapshot::new([(
                "enable-passwords".into(),
                FlagValue::Boolean(true),
            )])),
            Err("remote evaluation failed".to_owned()),
            Ok(FlagSnapshot::new([(
                PASSWORDS_FLAG.into(),
                FlagValue::Boolean(true),
            )])),
        ] {
            let failed = result.is_err();
            let enabled = result
                .as_ref()
                .is_ok_and(|flags| flags.is_enabled(PASSWORDS_FLAG));
            let availability = PasswordAvailability {
                flags: UserFlags {
                    result,
                    loads: AtomicUsize::new(0),
                },
                provider_configured: configured,
            };
            let actor = Actor {
                user_id: MacroUserIdStr::parse_from_str("macro|human@example.test")
                    .unwrap()
                    .into_owned(),
            };
            let admission = availability.require_enabled(&actor).await;
            if failed || (enabled && !configured) {
                assert!(matches!(admission, Err(Error::Unavailable)));
            } else if !enabled {
                assert!(matches!(admission, Err(Error::NotFound)));
            } else {
                assert!(admission.is_ok());
            }
            assert_eq!(availability.flags.loads.load(Ordering::SeqCst), 1);
        }
    }
}

#[test]
fn provider_readiness_never_loads_rollout_flags() {
    for configured in [false, true] {
        let availability = PasswordAvailability {
            flags: UserFlags {
                result: Err("must not be consulted".into()),
                loads: AtomicUsize::new(0),
            },
            provider_configured: configured,
        };
        assert_eq!(availability.require_provider().is_ok(), configured);
        assert_eq!(availability.flags.loads.load(Ordering::SeqCst), 0);
    }
}
