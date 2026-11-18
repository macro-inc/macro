//! How a Deno child ended and what it used, for its process span.
//!
//! A child that dies without a terminal frame (V8 aborting on its heap limit,
//! the kernel killing it, a crash) otherwise leaves only "Deno exited without
//! a result". Its exit code or signal, CPU time and peak memory tell those
//! apart.

use nom::Parser as _;
use nom::bytes::complete::tag;
use nom::character::complete::{space0, space1, u64 as number};
use std::os::unix::process::ExitStatusExt as _;
use std::path::PathBuf;
use std::process::ExitStatus;
use std::time::Duration;

#[cfg(test)]
mod test;

/// How often a running child's memory is read. Its peak is gone once it
/// exits, so the last reading before it dies is the one that counts.
pub(super) const SAMPLE_INTERVAL: Duration = Duration::from_millis(250);

/// Linux reports procfs times in `USER_HZ`, 100 on every architecture.
const CLOCK_TICKS_PER_SECOND: u64 = 100;

/// What procfs last showed of a running child. Peak memory disappears with
/// the child's memory before its pipes close, so it is sampled while the
/// child runs; CPU time stays readable until the child is reaped.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct ProcessUsage {
    /// User plus system CPU time.
    pub(super) cpu: Option<Duration>,
    /// Peak resident set size (`VmHWM`), in KiB.
    pub(super) peak_rss_kib: Option<u64>,
}

impl ProcessUsage {
    /// Read the child's procfs entries, keeping the last value of each that
    /// is still there.
    pub(super) fn sample(&mut self, pid: u32) {
        // procfs reads are served from memory, so a plain read never waits
        // for long, and the child's pipes keep being polled between samples.
        let directory = proc_dir(pid);
        if let Ok(stat) = std::fs::read_to_string(directory.join("stat"))
            && let Some(ticks) = cpu_ticks(&stat)
        {
            self.cpu = Some(Duration::from_millis(
                ticks.saturating_mul(1000) / CLOCK_TICKS_PER_SECOND,
            ));
        }
        if let Ok(status) = std::fs::read_to_string(directory.join("status"))
            && let Some(kib) = peak_rss_kib(&status)
        {
            self.peak_rss_kib = Some(kib);
        }
    }
}

/// User plus system CPU time, in clock ticks, from `/proc/<pid>/stat`.
///
/// The command name in parentheses is the one field written unescaped, so it
/// may hold spaces and parentheses itself; it ends at the last `") "`, which
/// only a search from the end finds. Every field after it is a number or the
/// one-letter state.
fn cpu_ticks(stat: &str) -> Option<u64> {
    let fields = stat.get(stat.rfind(") ")? + 2..)?;
    // state, ppid, pgrp, session, tty_nr, tpgid, flags, minflt, cminflt,
    // majflt, cmajflt; then utime and stime.
    let skipped = (nom::bytes::complete::is_not(" "), space1);
    let (_, (_, utime, _, stime)) = (
        nom::multi::count(skipped, 11),
        number::<&str, nom::error::Error<&str>>,
        space1,
        number,
    )
        .parse(fields)
        .ok()?;
    utime.checked_add(stime)
}

/// `VmHWM` from `/proc/<pid>/status`, in KiB; gone once the child's memory is.
fn peak_rss_kib(status: &str) -> Option<u64> {
    status.lines().find_map(|line| {
        let (_, (_, _, kib, _, _)) = (
            tag::<&str, &str, nom::error::Error<&str>>("VmHWM:"),
            space0,
            number,
            space1,
            tag("kB"),
        )
            .parse(line)
            .ok()?;
        Some(kib)
    })
}

/// The procfs directory of `pid`.
fn proc_dir(pid: u32) -> PathBuf {
    PathBuf::from(format!("/proc/{pid}"))
}

/// Whole milliseconds as the signed number span fields export.
fn millis(duration: Duration) -> i64 {
    i64::try_from(duration.as_millis()).unwrap_or(i64::MAX)
}

/// How a child ended, once it has.
#[derive(Debug)]
pub(super) struct ProcessExit {
    pub(super) status: ExitStatus,
    /// From spawn to exit.
    pub(super) wall: Duration,
    pub(super) usage: ProcessUsage,
    /// Whether the child wrote a terminal frame before it exited.
    pub(super) answered: bool,
    /// Whether the runner killed it (deadline, cancellation, a protocol
    /// error); its status then says nothing about the program.
    pub(super) killed: bool,
}

impl ProcessExit {
    /// Record the exit on `span` and warn when the child, on its own, did not
    /// end the way a finished program does: exit code 0 after its terminal
    /// frame.
    pub(super) fn record(&self, span: &tracing::Span) {
        let exit_code = self.status.code().map(i64::from);
        let signal = self.status.signal().map(i64::from);
        let wall_ms = millis(self.wall);
        let cpu_ms = self.usage.cpu.map(millis);
        let peak_rss_kib = self
            .usage
            .peak_rss_kib
            .map(|kib| i64::try_from(kib).unwrap_or(i64::MAX));
        span.record("process.exit_code", exit_code);
        span.record("process.signal", signal);
        span.record("process.wall_ms", wall_ms);
        span.record("process.cpu_ms", cpu_ms);
        span.record("process.peak_rss_kib", peak_rss_kib);
        span.record("process.killed", self.killed);
        if !self.killed && (signal.is_some() || exit_code != Some(0) || !self.answered) {
            tracing::warn!(
                parent: span,
                process.exit_code = exit_code,
                process.signal = signal,
                process.wall_ms = wall_ms,
                process.cpu_ms = cpu_ms,
                process.peak_rss_kib = peak_rss_kib,
                answered = self.answered,
                "Deno child ended abnormally"
            );
        }
    }
}
