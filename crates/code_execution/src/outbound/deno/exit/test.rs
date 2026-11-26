use super::*;
use std::collections::BTreeMap;
use std::fmt::Debug;
use std::sync::{Arc, Mutex};
use tokio::process::Command;
use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id, Record};
use tracing::{Event, Subscriber};
use tracing_subscriber::layer::{Context as LayerContext, Layer, SubscriberExt as _};
use tracing_subscriber::registry::LookupSpan;

type Fields = BTreeMap<String, String>;

/// The process span's fields and every event's, as text.
#[derive(Clone, Default)]
struct Captured {
    span: Arc<Mutex<Fields>>,
    events: Arc<Mutex<Vec<Fields>>>,
}

struct FieldText<'a>(&'a mut Fields);

impl Visit for FieldText<'_> {
    fn record_str(&mut self, field: &Field, value: &str) {
        self.0.insert(field.name().to_owned(), value.to_owned());
    }

    fn record_debug(&mut self, field: &Field, value: &dyn Debug) {
        self.0.insert(field.name().to_owned(), format!("{value:?}"));
    }
}

impl<S: Subscriber + for<'a> LookupSpan<'a>> Layer<S> for Captured {
    fn on_new_span(&self, attrs: &Attributes<'_>, _: &Id, _: LayerContext<'_, S>) {
        attrs.record(&mut FieldText(&mut self.span.lock().unwrap()));
    }

    fn on_record(&self, _: &Id, values: &Record<'_>, _: LayerContext<'_, S>) {
        values.record(&mut FieldText(&mut self.span.lock().unwrap()));
    }

    fn on_event(&self, event: &Event<'_>, _: LayerContext<'_, S>) {
        let mut fields = Fields::new();
        fields.insert("level".into(), event.metadata().level().to_string());
        event.record(&mut FieldText(&mut fields));
        self.events.lock().unwrap().push(fields);
    }
}

/// Run `script` in `sh` to its end and record its exit as a Deno child's.
async fn record_exit(script: &str, answered: bool) -> Captured {
    record_exit_of(script, answered, false).await
}

async fn record_exit_of(script: &str, answered: bool, killed: bool) -> Captured {
    let status = Command::new("sh")
        .args(["-c", script])
        .status()
        .await
        .unwrap();
    let captured = Captured::default();
    let _guard =
        tracing::subscriber::set_default(tracing_subscriber::registry().with(captured.clone()));
    let span = tracing::info_span!(
        "code_execution.process",
        process.exit_code = tracing::field::Empty,
        process.signal = tracing::field::Empty,
        process.wall_ms = tracing::field::Empty,
        process.cpu_ms = tracing::field::Empty,
        process.peak_rss_kib = tracing::field::Empty,
        process.killed = tracing::field::Empty,
    );
    ProcessExit {
        status,
        wall: Duration::from_millis(1500),
        usage: ProcessUsage {
            cpu: Some(Duration::from_millis(1200)),
            peak_rss_kib: Some(180_000),
        },
        answered,
        killed,
    }
    .record(&span);
    captured
}

fn warnings(captured: &Captured) -> Vec<Fields> {
    captured
        .events
        .lock()
        .unwrap()
        .iter()
        .filter(|event| event["level"] == "WARN")
        .cloned()
        .collect()
}

#[tokio::test]
async fn a_killed_child_records_its_signal_and_warns_once() {
    let captured = record_exit("kill -ABRT $$", false).await;
    let span = captured.span.lock().unwrap().clone();
    assert_eq!(span["process.signal"], "6", "{span:?}");
    assert!(!span.contains_key("process.exit_code"), "{span:?}");
    assert_eq!(span["process.wall_ms"], "1500");
    assert_eq!(span["process.cpu_ms"], "1200");
    assert_eq!(span["process.peak_rss_kib"], "180000");
    let warnings = warnings(&captured);
    assert_eq!(warnings.len(), 1, "{warnings:?}");
    assert_eq!(warnings[0]["process.signal"], "6");
    assert_eq!(warnings[0]["process.peak_rss_kib"], "180000");
}

#[tokio::test]
async fn an_exit_code_is_recorded_and_a_nonzero_one_warns() {
    let captured = record_exit("exit 3", true).await;
    let span = captured.span.lock().unwrap().clone();
    assert_eq!(span["process.exit_code"], "3", "{span:?}");
    assert!(!span.contains_key("process.signal"), "{span:?}");
    assert_eq!(warnings(&captured).len(), 1);
}

#[tokio::test]
async fn exiting_cleanly_without_a_result_warns() {
    let captured = record_exit("exit 0", false).await;
    assert_eq!(captured.span.lock().unwrap()["process.exit_code"], "0");
    assert_eq!(warnings(&captured).len(), 1);
}

#[tokio::test]
async fn a_finished_program_records_its_exit_quietly() {
    let captured = record_exit("exit 0", true).await;
    assert_eq!(captured.span.lock().unwrap()["process.exit_code"], "0");
    assert!(warnings(&captured).is_empty());
}

#[tokio::test]
async fn a_child_the_runner_killed_records_its_end_without_a_warning() {
    let captured = record_exit_of("kill -KILL $$", false, true).await;
    let span = captured.span.lock().unwrap().clone();
    assert_eq!(span["process.signal"], "9", "{span:?}");
    assert_eq!(span["process.killed"], "true");
    assert_eq!(span["process.peak_rss_kib"], "180000");
    assert!(
        warnings(&captured).is_empty(),
        "the outcome already says why"
    );
}

#[tokio::test]
async fn a_running_child_shows_its_cpu_time_and_peak_memory() {
    let mut child = Command::new("sh")
        .args([
            "-c",
            "i=0; while [ $i -lt 20000 ]; do i=$((i+1)); done; sleep 5",
        ])
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let pid = child.id().unwrap();
    let mut usage = ProcessUsage::default();
    usage.sample(pid);
    assert!(usage.peak_rss_kib.is_some_and(|kib| kib > 0), "{usage:?}");
    assert!(usage.cpu.is_some(), "{usage:?}");
    child.start_kill().unwrap();
    child.wait().await.unwrap();

    // A reaped child has no procfs entry; what was seen is kept.
    let seen = usage;
    usage.sample(pid);
    assert_eq!(usage, seen);
}

#[test]
fn stat_and_status_parse_as_procfs_writes_them() {
    // A command name may hold spaces and parentheses.
    let stat = "4242 (deno (x) y) S 1 4242 4242 0 -1 4194304 2105 0 0 0 157 43 0 0 20 0 9 0 3456 1258291200 45000 18446744073709551615";
    assert_eq!(cpu_ticks(stat), Some(200));
    let status = "Name:\tdeno\nVmPeak:\t 1300000 kB\nVmHWM:\t  181234 kB\nVmRSS:\t  170000 kB\n";
    assert_eq!(peak_rss_kib(status), Some(181_234));
    assert_eq!(peak_rss_kib("Name:\tdeno\nState:\tZ (zombie)\n"), None);
    assert_eq!(cpu_ticks("garbage"), None);
}

/// The failure the field data could not explain: a program that grows past
/// its heap limit dies without a result. Its span now says how.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_program_that_exhausts_its_heap_records_how_deno_died() {
    use crate::domain::{
        EventKind, ExecuteRequest, ExecutionService, Limits, Outcome, RunEnvironment,
    };
    let captured = Captured::default();
    let _guard =
        tracing::subscriber::set_default(tracing_subscriber::registry().with(captured.clone()));
    let root = tempfile::tempdir().unwrap();
    let binary = Command::new("which").arg("deno").output().await.unwrap();
    assert!(binary.status.success(), "Deno 2.9.6 must be on PATH");
    let binary = PathBuf::from(String::from_utf8(binary.stdout).unwrap().trim());
    let runner = super::super::DenoRunner::new(binary, root.path().to_owned(), 128)
        .await
        .unwrap();
    let service = ExecutionService::new(
        Arc::new(runner),
        Arc::new(super::super::test::Unchecked),
        Limits::default(),
    )
    .unwrap();
    let mut handle = service
        .execute(
            ExecuteRequest {
                source: "export async function main() { const kept = []; for (;;) kept.push(new Array(100000).fill(Math.random())); }".into(),
                timeout_ms: 30_000,
            },
            RunEnvironment::default(),
        )
        .unwrap();
    let outcome = loop {
        let event = tokio::time::timeout(Duration::from_secs(30), handle.events.recv())
            .await
            .unwrap()
            .unwrap();
        if let EventKind::Finished { outcome } = event.kind {
            break outcome;
        }
    };
    assert!(matches!(outcome, Outcome::Failed { .. }), "{outcome:?}");

    let span = captured.span.lock().unwrap().clone();
    let died_abnormally = span.contains_key("process.signal")
        || span
            .get("process.exit_code")
            .is_some_and(|code| code != "0");
    assert!(died_abnormally, "{span:?}");
    // The peak is the last sample before the child's memory went away; one
    // that exhausts its heap within a sample interval shows only its start.
    let peak: u64 = span["process.peak_rss_kib"].parse().unwrap();
    assert!(peak > 0, "{span:?}");
    assert!(span.contains_key("process.cpu_ms"), "{span:?}");
    assert!(span.contains_key("process.wall_ms"), "{span:?}");
    assert_eq!(warnings(&captured).len(), 1);
}

/// A program the deadline stops is killed by the runner; its span still
/// shows how it ended and what it used.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn a_program_the_deadline_stops_records_its_end() {
    use crate::domain::{
        EventKind, ExecuteRequest, ExecutionService, Limits, Outcome, RunEnvironment,
    };
    let captured = Captured::default();
    let _guard =
        tracing::subscriber::set_default(tracing_subscriber::registry().with(captured.clone()));
    let root = tempfile::tempdir().unwrap();
    let binary = Command::new("which").arg("deno").output().await.unwrap();
    assert!(binary.status.success(), "Deno 2.9.6 must be on PATH");
    let binary = PathBuf::from(String::from_utf8(binary.stdout).unwrap().trim());
    let runner = super::super::DenoRunner::new(binary, root.path().to_owned(), 128)
        .await
        .unwrap();
    let service = ExecutionService::new(
        Arc::new(runner),
        Arc::new(super::super::test::Unchecked),
        Limits::default(),
    )
    .unwrap();
    let mut handle = service
        .execute(
            ExecuteRequest {
                source: "export async function main() { for (;;) {} }".into(),
                timeout_ms: 1_500,
            },
            RunEnvironment::default(),
        )
        .unwrap();
    let outcome = loop {
        let event = tokio::time::timeout(Duration::from_secs(30), handle.events.recv())
            .await
            .unwrap()
            .unwrap();
        if let EventKind::Finished { outcome } = event.kind {
            break outcome;
        }
    };
    assert!(matches!(outcome, Outcome::TimedOut), "{outcome:?}");
    let span = captured.span.lock().unwrap().clone();
    assert_eq!(span["process.signal"], "9", "{span:?}");
    assert_eq!(span["process.killed"], "true");
    assert!(span.contains_key("process.peak_rss_kib"), "{span:?}");
    assert!(span.contains_key("process.cpu_ms"), "{span:?}");
    assert!(warnings(&captured).is_empty());
}
