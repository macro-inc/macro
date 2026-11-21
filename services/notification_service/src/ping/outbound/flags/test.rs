use feature_flags::FeatureFlags;
use macro_env::Environment;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;

use super::NotificationFlags;
use crate::ping::AGENT_NOTIFICATIONS_FLAG;

async fn enabled(flags: &NotificationFlags) -> bool {
    let user = MacroUserIdStr::parse_from_str("macro|sender@macro.com")
        .unwrap()
        .into_owned();
    flags
        .load(&user)
        .await
        .unwrap()
        .is_enabled(AGENT_NOTIFICATIONS_FLAG)
}

#[tokio::test]
async fn a_local_stack_is_on_for_everyone_without_a_key() {
    let flags = NotificationFlags::new(Environment::Local, None, None).unwrap();

    assert!(enabled(&flags).await);
}

#[tokio::test]
async fn a_deployment_without_a_key_is_off_for_everyone() {
    for environment in [Environment::Develop, Environment::Production] {
        let flags = NotificationFlags::new(environment, None, None).unwrap();

        assert!(!enabled(&flags).await);
    }
}

#[tokio::test]
async fn a_deployment_with_a_key_asks_posthog() {
    let flags = NotificationFlags::new(Environment::Production, Some("project-key"), None).unwrap();

    assert!(matches!(flags, NotificationFlags::Remote(_)));
}

#[test]
fn refuses_a_blank_key_instead_of_running_silently_off() {
    assert!(NotificationFlags::new(Environment::Production, Some(" "), None).is_err());
}
