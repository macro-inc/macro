//! How long this process's threads ran on a CPU and waited for one, from
//! Linux scheduler statistics.

#[cfg(test)]
mod test;

use std::{collections::HashMap, time::Duration};

/// One thread's cumulative CPU time.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct ThreadCpuTimes {
    /// Time the thread ran on a CPU.
    pub(crate) run: Duration,
    /// Time the thread was runnable but waiting for a CPU: a host busy with
    /// other work, or a cgroup CPU quota spent for the current period.
    pub(crate) wait: Duration,
}

/// What this process's threads did between two samples.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct IntervalCpu {
    /// CPU time all threads ran.
    pub(crate) run: Duration,
    /// The longest any one thread waited for a CPU.
    pub(crate) longest_wait: Duration,
}

/// Every live thread's cumulative CPU time, keyed by thread id.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ThreadCpuSample {
    threads: HashMap<u32, ThreadCpuTimes>,
}

impl ThreadCpuSample {
    /// Reads `/proc/self/task/*/schedstat`. `None` where the kernel does not
    /// expose it (not Linux, or a kernel without scheduler statistics).
    pub(crate) fn take() -> Option<Self> {
        #[cfg(target_os = "linux")]
        {
            sample_linux()
        }
        #[cfg(not(target_os = "linux"))]
        {
            None
        }
    }

    /// What the threads did since `earlier`. A thread that started since then
    /// counts in full; one that exited takes its last stretch with it.
    pub(crate) fn since(&self, earlier: &Self) -> IntervalCpu {
        let mut interval = IntervalCpu::default();
        for (thread, now) in &self.threads {
            let before = earlier.threads.get(thread).copied().unwrap_or_default();
            interval.run += now.run.saturating_sub(before.run);
            interval.longest_wait = interval
                .longest_wait
                .max(now.wait.saturating_sub(before.wait));
        }
        interval
    }
}

impl FromIterator<(u32, ThreadCpuTimes)> for ThreadCpuSample {
    fn from_iter<I: IntoIterator<Item = (u32, ThreadCpuTimes)>>(threads: I) -> Self {
        Self {
            threads: threads.into_iter().collect(),
        }
    }
}

#[cfg(target_os = "linux")]
fn sample_linux() -> Option<ThreadCpuSample> {
    use std::io::Read;

    let mut threads = HashMap::new();
    let mut buffer = Vec::with_capacity(64);
    for entry in std::fs::read_dir("/proc/self/task").ok()?.flatten() {
        let Some(thread) = entry
            .file_name()
            .to_str()
            .and_then(|name| name.parse::<u32>().ok())
        else {
            continue;
        };
        buffer.clear();
        let Ok(mut file) = std::fs::File::open(entry.path().join("schedstat")) else {
            continue;
        };
        if file.read_to_end(&mut buffer).is_err() {
            continue;
        }
        if let Some(times) = parse_schedstat(&buffer) {
            threads.insert(thread, times);
        }
    }
    (!threads.is_empty()).then_some(ThreadCpuSample { threads })
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
