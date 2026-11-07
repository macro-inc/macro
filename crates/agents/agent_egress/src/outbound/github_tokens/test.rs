use super::*;

fn cached(expires_in_minutes: i64) -> CachedToken {
    CachedToken {
        token: "ghs-token".to_owned(),
        expires_at: Utc::now() + ChronoDuration::minutes(expires_in_minutes),
    }
}

/// A clone can take minutes, so a token that is about to expire is worse than
/// no token: it fails halfway through a packfile instead of at the start.
#[test]
fn a_nearly_expired_cached_token_is_not_reused() {
    assert!(usable(None).is_none());
    assert!(usable(Some(cached(-1))).is_none());
    assert!(usable(Some(cached(EXPIRY_MARGIN_MINUTES - 1))).is_none());
    assert!(usable(Some(cached(EXPIRY_MARGIN_MINUTES + 1))).is_some());
}
