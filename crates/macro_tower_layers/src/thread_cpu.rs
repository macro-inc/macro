//! How long this process's threads ran on a CPU and waited for one, summed
//! across threads, from Linux scheduler statistics.

#[cfg(test)]
mod test;

use std::time::Duration;

/// Cumulative CPU time of every live thread in this process.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct ThreadCpuTimes {
    /// Time the threads ran on a CPU.
    pub(crate) run: Duration,
    /// Time the threads were runnable but waiting for a CPU: a host busy with
    /// other work, or a cgroup CPU quota spent for the current period.
    pub(crate) wait: Duration,
}

impl ThreadCpuTimes {
    /// Sums `/proc/self/task/*/schedstat`. `None` where the kernel does not
    /// expose it (not Linux, or a kernel without scheduler statistics).
    pub(crate) fn sample() -> Option<Self> {
        #[cfg(target_os = "linux")]
        {
            sample_linux()
        }
        #[cfg(not(target_os = "linux"))]
        {
            None
        }
    }

    /// The time accumulated since `earlier`. A thread that exited in between
    /// takes its totals with it, so the difference can undercount.
    pub(crate) fn since(self, earlier: Self) -> Self {
        Self {
            run: self.run.saturating_sub(earlier.run),
            wait: self.wait.saturating_sub(earlier.wait),
        }
    }
}

#[cfg(target_os = "linux")]
fn sample_linux() -> Option<ThreadCpuTimes> {
    use std::io::Read;

    let mut totals = ThreadCpuTimes::default();
    let mut buffer = Vec::with_capacity(64);
    let mut sampled = false;
    for entry in std::fs::read_dir("/proc/self/task").ok()?.flatten() {
        buffer.clear();
        let Ok(mut file) = std::fs::File::open(entry.path().join("schedstat")) else {
            continue;
        };
        if file.read_to_end(&mut buffer).is_err() {
            continue;
        }
        if let Some(thread) = parse_schedstat(&buffer) {
            totals.run += thread.run;
            totals.wait += thread.wait;
            sampled = true;
        }
    }
    sampled.then_some(totals)
}

/// Parses one thread's `schedstat`: nanoseconds on a CPU, nanoseconds waiting
/// on a run queue, then the number of time slices.
pub(crate) fn parse_schedstat(contents: &[u8]) -> Option<ThreadCpuTimes> {
    use nom::{
        Parser,
        character::complete::{space1, u64},
        sequence::separated_pair,
    };

    let (_, (run, wait)) = separated_pair(u64::<_, ()>, space1, u64)
        .parse(contents)
        .ok()?;
    Some(ThreadCpuTimes {
        run: Duration::from_nanos(run),
        wait: Duration::from_nanos(wait),
    })
}
