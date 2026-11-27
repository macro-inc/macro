use super::*;
use serde_json::json;

fn normalized(answer: Value) -> Value {
    Normalizer::new("", Path::new("/nowhere"), SourceHashes::Raw).answer(answer)
}

/// An enqueue or commit answer as the native host sends it since it reports its lock
/// timings, with the given wait and hold.
fn queued_answer(wait: f64, hold: f64) -> Value {
    json!({
        "affectedOps": [],
        "changed": ["GraphqlSoupDocument:3f1c9a52-6a8b-4c7e-9d2e-0b7a51f0c3d4"],
        "engine": { "lockWaitMs": wait, "lockHoldMs": hold },
        "reset": false,
    })
}

#[test]
fn two_runs_of_one_write_compare_equal_whatever_its_lock_timings() {
    assert_eq!(
        normalized(queued_answer(0.0003, 8.21)),
        normalized(queued_answer(0.0004, 5.86)),
    );
}

#[test]
fn a_host_that_reports_lock_timings_compares_equal_to_one_that_does_not() {
    let mut without = queued_answer(0.0, 0.0);
    without.as_object_mut().unwrap().remove("engine");
    assert_eq!(normalized(queued_answer(0.0003, 8.21)), normalized(without));
}

#[test]
fn an_engine_field_that_is_not_lock_timings_is_compared() {
    let answer = |engine: Value| normalized(json!({ "engine": engine }));
    assert_ne!(answer(json!("turso")), answer(json!("sqlite")));
    assert_ne!(
        answer(json!({ "lockWaitMs": 1.0, "generation": 1 })),
        answer(json!({ "lockWaitMs": 1.0, "generation": 2 })),
    );
}

#[test]
fn response_data_shaped_like_lock_timings_is_compared() {
    // A query may alias a field to `engine` and its fields to the timing names.
    let read = |total: u64| {
        normalized(json!({
            "data": { "engine": { "lockWaitMs": 0, "lockHoldMs": total } },
        }))
    };
    assert_ne!(read(17), read(23));
}
