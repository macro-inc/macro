use super::*;

#[test]
fn wait_ready_script_uses_a_wall_clock_deadline() {
    let script = wait_ready_script("http://localhost:9011/api/application/x", "key", 240);
    assert!(script.contains("SECONDS + 240"));
    assert!(script.contains("sleep 0.5"));
    assert!(
        !script.contains("seq 1"),
        "attempt-counted loops overshoot when curl --max-time hangs"
    );
    assert!(script.contains("Authorization: key"));
}
