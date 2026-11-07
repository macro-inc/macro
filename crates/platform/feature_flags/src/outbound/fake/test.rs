use super::*;
use crate::FlagValue;

#[tokio::test]
async fn user_results_are_isolated_and_snapshots_remain_stable() {
    let alice = MacroUserIdStr::parse_from_str("macro|alice@example.com").unwrap();
    let bob = MacroUserIdStr::parse_from_str("macro|bob@example.com").unwrap();
    let mut flags = FakeFeatureFlags::default();
    flags.set(
        alice.clone(),
        Ok(FlagSnapshot::new([
            ("code".into(), FlagValue::Boolean(true)),
            ("layout".into(), FlagValue::Variant("compact".into())),
        ])),
    );
    flags.set(
        bob.clone(),
        Ok(FlagSnapshot::new([(
            "code".into(),
            FlagValue::Boolean(false),
        )])),
    );

    let snapshot = flags.load(&alice).await.unwrap();
    let bob_snapshot = flags.load(&bob).await.unwrap();
    assert!(snapshot.is_enabled("code"));
    assert!(snapshot.is_enabled("layout"));
    assert_eq!(snapshot.variant("layout"), Some("compact"));
    assert!(!bob_snapshot.is_enabled("code"));
    assert_eq!(bob_snapshot.get("code"), Some(&FlagValue::Boolean(false)));
    assert_eq!(bob_snapshot.variant("code"), None);
    assert!(!bob_snapshot.is_enabled("missing"));
    assert_eq!(bob_snapshot.get("missing"), None);

    flags.set(alice.clone(), Ok(FlagSnapshot::default()));
    assert!(snapshot.is_enabled("code"));
    assert!(!flags.load(&alice).await.unwrap().is_enabled("code"));
}

#[tokio::test]
async fn load_errors_are_not_successful_empty_snapshots() {
    let user = MacroUserIdStr::parse_from_str("macro|alice@example.com").unwrap();
    let mut flags = FakeFeatureFlags::default();
    assert!(flags.load(&user).await.is_err());
    flags.set(user.clone(), Err("provider unavailable".into()));
    assert!(flags.load(&user).await.is_err());
    flags.set(user.clone(), Ok(FlagSnapshot::default()));
    assert_eq!(flags.load(&user).await.unwrap(), FlagSnapshot::default());
}
