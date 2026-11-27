use super::*;

const ME: &str = "macro|me@example.com";
const OTHER: &str = "macro|other@example.com";

fn loaded(users: &[&str], at: Instant) -> McpLiveSubscribers {
    let subscribers = McpLiveSubscribers::default();
    *subscribers.state.write().expect("lock") = State::Loaded {
        users: Arc::new(users.iter().map(|user| (*user).to_owned()).collect()),
        at,
    };
    subscribers
}

fn audience() -> Vec<String> {
    vec![ME.to_owned(), OTHER.to_owned()]
}

#[test]
fn an_unloaded_set_is_unknown() {
    assert_eq!(McpLiveSubscribers::default().narrow(&audience()), None);
}

#[test]
fn a_loaded_set_keeps_only_its_users() {
    let now = Instant::now();
    assert_eq!(
        loaded(&[ME], now).narrow_at(&audience(), now),
        Some(vec![ME.to_owned()])
    );
    assert_eq!(
        loaded(&[], now).narrow_at(&audience(), now),
        Some(Vec::new())
    );
}

#[test]
fn an_old_set_is_unknown() {
    let at = Instant::now();
    let subscribers = loaded(&[ME], at);
    assert!(
        subscribers
            .narrow_at(&audience(), at + LIVE_SUBSCRIBERS_MAX_AGE)
            .is_some()
    );
    assert_eq!(
        subscribers.narrow_at(
            &audience(),
            at + LIVE_SUBSCRIBERS_MAX_AGE + Duration::from_millis(1)
        ),
        None
    );
}

#[test]
fn a_set_too_large_to_load_is_unknown() {
    let subscribers = McpLiveSubscribers::default();
    *subscribers.state.write().expect("lock") = State::TooMany;
    assert_eq!(subscribers.narrow(&audience()), None);
}
