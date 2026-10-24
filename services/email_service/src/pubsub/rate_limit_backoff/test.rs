use super::*;

#[test]
fn delays_double_per_retry_up_to_five_minutes() {
    let expected = [
        (1, 15, 30),
        (2, 30, 60),
        (3, 60, 120),
        (4, 120, 240),
        (5, 150, 300),
        (100, 150, 300),
    ];
    for (retry, min_secs, max_secs) in expected {
        assert_eq!(
            retry_delay(retry, None, |range| *range.start()),
            Duration::from_secs(min_secs),
            "retry {retry}"
        );
        assert_eq!(
            retry_delay(retry, None, |range| *range.end()),
            Duration::from_secs(max_secs),
            "retry {retry}"
        );
    }
}

#[test]
fn retry_after_is_the_shortest_delay_up_to_the_sqs_limit() {
    assert_eq!(
        retry_delay(1, Some(Duration::from_secs(120)), |range| *range.end()),
        Duration::from_secs(120)
    );
    assert_eq!(
        retry_delay(4, Some(Duration::from_secs(10)), |range| *range.start()),
        Duration::from_secs(120)
    );
    assert_eq!(
        retry_delay(1, Some(Duration::from_secs(3_600)), |range| *range.start()),
        Duration::from_secs(900)
    );
}

#[test]
fn retry_queue_receives_continue_the_primary_queue_attempt() {
    let cases = [(false, 5, 15, 30), (true, 1, 30, 60), (true, 3, 120, 240)];
    for (retry_worker, receive_count, min_secs, max_secs) in cases {
        let delay = next_retry_delay(retry_worker, receive_count, None);
        assert!(
            (Duration::from_secs(min_secs)..=Duration::from_secs(max_secs)).contains(&delay),
            "retry_worker {retry_worker}, receive {receive_count}: {delay:?}"
        );
    }
}
