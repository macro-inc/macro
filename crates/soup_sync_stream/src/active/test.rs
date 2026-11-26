use super::*;

#[test]
fn one_stream_per_key_until_the_guard_drops() {
    let streams = ActiveStreams::default();
    let first = streams.try_acquire("user-a").unwrap();
    assert!(streams.try_acquire("user-a").is_none());
    let other = streams.try_acquire("user-b").unwrap();
    drop(first);
    assert!(streams.try_acquire("user-a").is_some());
    drop(other);
}
