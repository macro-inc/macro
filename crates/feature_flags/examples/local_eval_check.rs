//! Scratch proof (not committed): evaluate flags locally against live PostHog.
//! Env: POSTHOG_HOST (optional), POSTHOG_API_KEY, POSTHOG_FEATURE_FLAGS_SECURE_API_KEY,
//! CHECK_ENVIRONMENT (prod|dev|local). Args: flag key, then emails.
use std::time::Duration;

use feature_flags::{domain::FeatureFlags, outbound::posthog_local::PostHogLocalFeatureFlags};
use macro_env::Environment;
use macro_user_id::user_id::MacroUserIdStr;

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let var = |k: &str| std::env::var(k).unwrap_or_default();
    let host = std::env::var("POSTHOG_HOST").unwrap_or_else(|_| "https://us.i.posthog.com".into());
    let env = match var("CHECK_ENVIRONMENT").as_str() {
        "prod" => Environment::Production,
        "dev" => Environment::Develop,
        _ => Environment::Local,
    };
    let mut args = std::env::args().skip(1);
    let flag = args.next().expect("flag key");
    let flags = PostHogLocalFeatureFlags::new(
        &host,
        &var("POSTHOG_API_KEY"),
        var("POSTHOG_FEATURE_FLAGS_SECURE_API_KEY"),
        &[flag.as_str()],
        Duration::from_secs(10),
        env,
    )
    .expect("config");
    for (i, email) in args.enumerate() {
        let id = MacroUserIdStr::try_from_email(&email).expect("email");
        let domain = email.rsplit('@').next().unwrap_or_default();
        match flags.load(&id).await {
            Ok(snapshot) => println!(
                "user {i} (@{domain}) environment={env:?}: {flag} enrolled={}",
                snapshot.is_enabled(&flag)
            ),
            Err(error) => println!("user {i} (@{domain}): load failed: {error}"),
        }
    }
}
