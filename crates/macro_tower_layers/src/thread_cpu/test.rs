use super::*;

fn times(run_ms: u64, wait_ms: u64) -> ThreadCpuTimes {
    ThreadCpuTimes {
        run: Duration::from_millis(run_ms),
        wait: Duration::from_millis(wait_ms),
    }
}

#[test]
fn parses_run_and_wait_nanoseconds() {
    assert_eq!(
        parse_schedstat(b"1500000000 25000000 812\n"),
        Some(times(1500, 25))
    );
}

#[test]
fn rejects_malformed_schedstat() {
    assert_eq!(parse_schedstat(b""), None);
    assert_eq!(parse_schedstat(b"not numbers"), None);
    assert_eq!(parse_schedstat(b"42"), None);
}

#[test]
fn sums_run_and_keeps_the_longest_single_wait() {
    let earlier: ThreadCpuSample = [(1, times(100, 10)), (2, times(200, 20))]
        .into_iter()
        .collect();
    let later: ThreadCpuSample = [(1, times(130, 15)), (2, times(210, 60))]
        .into_iter()
        .collect();
    assert_eq!(
        later.since(&earlier),
        IntervalCpu {
            run: Duration::from_millis(40),
            longest_wait: Duration::from_millis(40),
        }
    );
}

/// Blocking-pool threads exit after sitting idle; one that leaves mid
/// interval must not cancel out what the other threads did.
#[test]
fn an_exited_thread_does_not_cancel_the_others() {
    let earlier: ThreadCpuSample = [(1, times(100, 0)), (2, times(400, 0))]
        .into_iter()
        .collect();
    let later: ThreadCpuSample = [(1, times(250, 30)), (3, times(5, 1))]
        .into_iter()
        .collect();
    assert_eq!(
        later.since(&earlier),
        IntervalCpu {
            run: Duration::from_millis(155),
            longest_wait: Duration::from_millis(30),
        }
    );
}

#[cfg(target_os = "linux")]
#[test]
fn samples_this_process_on_linux() {
    let before = ThreadCpuSample::take().expect("Linux exposes schedstat");
    let started = std::time::Instant::now();
    let mut spin = 0u64;
    while started.elapsed() < Duration::from_millis(20) {
        spin = std::hint::black_box(spin.wrapping_add(1));
    }
    let after = ThreadCpuSample::take().expect("Linux exposes schedstat");
    assert!(after.since(&before).run > Duration::ZERO);
}
