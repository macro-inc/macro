use super::*;

#[test]
fn parses_run_and_wait_nanoseconds() {
    assert_eq!(
        parse_schedstat(b"1500000000 25000000 812\n"),
        Some(ThreadCpuTimes {
            run: Duration::from_millis(1500),
            wait: Duration::from_millis(25),
        })
    );
}

#[test]
fn rejects_malformed_schedstat() {
    assert_eq!(parse_schedstat(b""), None);
    assert_eq!(parse_schedstat(b"not numbers"), None);
    assert_eq!(parse_schedstat(b"42"), None);
}

#[test]
fn difference_saturates_when_a_thread_exits() {
    let earlier = ThreadCpuTimes {
        run: Duration::from_millis(80),
        wait: Duration::from_millis(30),
    };
    let later = ThreadCpuTimes {
        run: Duration::from_millis(50),
        wait: Duration::from_millis(45),
    };
    assert_eq!(
        later.since(earlier),
        ThreadCpuTimes {
            run: Duration::ZERO,
            wait: Duration::from_millis(15),
        }
    );
}

#[cfg(target_os = "linux")]
#[test]
fn samples_this_process_on_linux() {
    assert!(ThreadCpuTimes::sample().is_some());

    let own = || {
        parse_schedstat(&std::fs::read("/proc/thread-self/schedstat").unwrap())
            .expect("Linux exposes schedstat")
    };
    let before = own();
    let started = std::time::Instant::now();
    let mut spin = 0u64;
    while started.elapsed() < Duration::from_millis(20) {
        spin = std::hint::black_box(spin.wrapping_add(1));
    }
    assert!(own().since(before).run > Duration::ZERO);
}
