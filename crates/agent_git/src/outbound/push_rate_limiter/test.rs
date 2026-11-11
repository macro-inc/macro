use std::time::Duration;

use macro_user_id::user_id::MacroUserIdStr;

use super::*;

#[tokio::test(start_paused = true)]
async fn the_bucket_empties_then_refills_per_repo() {
    let limiter = InMemoryPushRateLimiter::new(2);
    let agent = MacroUserIdStr::try_from("macro|agent@example.com".to_owned()).unwrap();
    let other = MacroUserIdStr::try_from("macro|other@example.com".to_owned()).unwrap();

    assert!(limiter.try_acquire_push(&agent));
    assert!(limiter.try_acquire_push(&agent));
    assert!(!limiter.try_acquire_push(&agent));
    assert!(limiter.try_acquire_push(&other));

    tokio::time::advance(Duration::from_secs(30)).await;
    assert!(limiter.try_acquire_push(&agent));
    assert!(!limiter.try_acquire_push(&agent));
}
