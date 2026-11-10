use super::{PageTurns, SERVED_MEMORY, StreamTurns};
use futures::poll;
use std::{pin::pin, time::Duration};

/// Runs one page of `stream` that takes `seconds`.
async fn page(stream: &StreamTurns<&'static str>, seconds: u64) {
    let turn = stream.next().await;
    tokio::time::advance(Duration::from_secs(seconds)).await;
    drop(turn);
}

#[tokio::test]
async fn pages_run_at_once_up_to_the_slots() {
    let turns = PageTurns::new(2);
    let stream = turns.stream("a");

    let first = stream.next().await;
    let _second = stream.next().await;
    let mut third = pin!(stream.next());
    assert!(poll!(&mut third).is_pending());

    drop(first);
    assert!(poll!(&mut third).is_ready());
}

#[tokio::test(start_paused = true)]
async fn a_freed_slot_goes_to_the_key_whose_pages_took_the_least_time() {
    let turns = PageTurns::new(1);
    let heavy = turns.stream("heavy");
    let light = turns.stream("light");
    // One heavy page took longer than two light ones.
    page(&heavy, 5).await;
    page(&light, 1).await;
    page(&light, 1).await;

    let running = heavy.next().await;
    let mut heavy_wait = pin!(heavy.next());
    let mut light_wait = pin!(light.next());
    assert!(poll!(&mut heavy_wait).is_pending());
    assert!(poll!(&mut light_wait).is_pending());

    drop(running);
    assert!(poll!(&mut heavy_wait).is_pending());
    let light_turn = poll!(&mut light_wait);
    assert!(light_turn.is_ready());

    drop(light_turn);
    assert!(poll!(&mut heavy_wait).is_ready());
}

#[tokio::test]
async fn keys_served_the_same_go_in_arrival_order() {
    let turns = PageTurns::new(1);
    let holder = turns.stream("holder");
    let first = turns.stream("first");
    let second = turns.stream("second");

    let running = holder.next().await;
    let mut first_wait = pin!(first.next());
    let mut second_wait = pin!(second.next());
    assert!(poll!(&mut first_wait).is_pending());
    assert!(poll!(&mut second_wait).is_pending());

    drop(running);
    assert!(poll!(&mut second_wait).is_pending());
    assert!(poll!(&mut first_wait).is_ready());
}

#[tokio::test(start_paused = true)]
async fn a_key_shares_its_page_time_across_streams() {
    let turns = PageTurns::new(1);
    let earlier = turns.stream("long");
    page(&earlier, 3).await;
    drop(earlier);

    let holder = turns.stream("holder");
    let running = holder.next().await;
    let later = turns.stream("long");
    let short = turns.stream("short");
    let mut later_wait = pin!(later.next());
    let mut short_wait = pin!(short.next());
    assert!(poll!(&mut later_wait).is_pending());
    assert!(poll!(&mut short_wait).is_pending());

    drop(running);
    assert!(poll!(&mut later_wait).is_pending());
    assert!(poll!(&mut short_wait).is_ready());
}

#[tokio::test]
async fn a_dropped_wait_leaves_the_line() {
    let turns = PageTurns::new(1);
    let holder = turns.stream("holder");
    let leaving = turns.stream("leaving");
    let staying = turns.stream("staying");

    let running = holder.next().await;
    let mut staying_wait = pin!(staying.next());
    {
        let mut leaving_wait = pin!(leaving.next());
        assert!(poll!(&mut leaving_wait).is_pending());
        assert!(poll!(&mut staying_wait).is_pending());
    }

    drop(running);
    assert!(poll!(&mut staying_wait).is_ready());
}

#[tokio::test]
async fn a_slot_handed_to_a_dropped_wait_is_freed() {
    let turns = PageTurns::new(1);
    let holder = turns.stream("holder");
    let leaving = turns.stream("leaving");

    let running = holder.next().await;
    {
        let mut leaving_wait = pin!(leaving.next());
        assert!(poll!(&mut leaving_wait).is_pending());
        // The slot is handed over, and the wait is dropped before it takes it.
        drop(running);
    }

    let mut next = pin!(holder.next());
    assert!(poll!(&mut next).is_ready());
}

#[tokio::test(start_paused = true)]
async fn a_key_without_a_page_for_the_memory_counts_as_new() {
    let turns = PageTurns::new(1);
    let old = turns.stream("old");
    page(&old, 30).await;

    tokio::time::advance(SERVED_MEMORY).await;
    let recent = turns.stream("recent");
    page(&recent, 1).await;
    let running = recent.next().await;
    let mut recent_wait = pin!(recent.next());
    let mut old_wait = pin!(old.next());
    assert!(poll!(&mut recent_wait).is_pending());
    assert!(poll!(&mut old_wait).is_pending());

    drop(running);
    assert!(poll!(&mut recent_wait).is_pending());
    assert!(poll!(&mut old_wait).is_ready());
}
