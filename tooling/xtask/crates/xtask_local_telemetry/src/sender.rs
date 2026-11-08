//! The background thread that sends buffered events.
//!
//! It first sends files left by runs that ended without sending (killed, or the
//! endpoint was down), then this run's new lines every flush interval and once
//! more at the end. A file is deleted only once Loki accepted or refused it;
//! after a timeout or a 5xx it stays and is sent again later. Nothing here
//! prints: a failed send must not disturb a run's output.

use std::collections::BTreeMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use flate2::Compression;
use flate2::write::GzEncoder;
use serde_json::{Value, json};

use super::config::Config;
use super::{Begin, Line, RUN_EVENT, Record, Shared, otlp, unix_ns};

/// Long enough for a slow link, short enough that a dead endpoint costs little.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// How often a long run sends what it has, so a kill loses at most this much.
pub(crate) const FLUSH_INTERVAL: Duration = Duration::from_secs(20);
/// Older buffer files are deleted unsent: a week down means nobody is watching.
const MAX_FILE_AGE: Duration = Duration::from_secs(7 * 24 * 3600);
/// Bounds one flush's work when the endpoint was down for a while.
const MAX_FILES_PER_FLUSH: usize = 20;
const LAST_SEND_FILE: &str = "last-send.json";

/// What a send did with a batch.
#[derive(Debug, PartialEq, Eq)]
enum Outcome {
    /// Stored (2xx), or refused for good (4xx): either way, don't send it again.
    Settled,
    /// Timed out, unreachable or 5xx: keep it for the next flush.
    Retry,
}

struct Client {
    runtime: tokio::runtime::Runtime,
    http: reqwest::Client,
}

pub(crate) fn run(config: &Config, buffer_dir: &Path, shared: &Shared) {
    let Some(client) = Client::new() else {
        return;
    };
    send_left_behind(&client, config, buffer_dir, &shared.own_file);

    // The begin line comes first in the file and is held in memory, so skip it.
    let mut sent_to = first_line_end(&shared.own_file);
    loop {
        let shutting_down = shared.wait(FLUSH_INTERVAL);
        sent_to = send_own(&client, config, buffer_dir, shared, sent_to);
        if shutting_down {
            let fully_sent =
                std::fs::metadata(&shared.own_file).is_ok_and(|meta| meta.len() == sent_to);
            if fully_sent {
                let _ = std::fs::remove_file(&shared.own_file);
            }
            return;
        }
    }
}

impl Client {
    fn new() -> Option<Self> {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .ok()?;
        // The DNS resolver binds to the runtime it is built in.
        let _entered = runtime.enter();
        let http = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .connect_timeout(CONNECT_TIMEOUT)
            .build()
            .ok()?;
        drop(_entered);
        Some(Self { runtime, http })
    }

    fn post(&self, url: &str, config: &Config, body: &Value) -> Result<u16, String> {
        let mut gzip = GzEncoder::new(Vec::new(), Compression::default());
        gzip.write_all(body.to_string().as_bytes())
            .map_err(|_| "compression failed".to_owned())?;
        let bytes = gzip.finish().map_err(|_| "compression failed".to_owned())?;
        let mut request = self
            .http
            .post(url)
            .header("Content-Type", "application/json")
            .header("Content-Encoding", "gzip")
            .body(bytes);
        if let Some(token) = config.token() {
            request = request.bearer_auth(token.expose());
        }
        // Built inside the runtime: the request's timeout needs its timer.
        self.runtime
            .block_on(async { request.send().await })
            .map(|response| response.status().as_u16())
            // Only the error's class, so neither the token nor a response is kept.
            .map_err(|error| describe(&error))
    }

    /// Send records as logs, and as spans when traces are on. Logs decide the
    /// outcome; spans are one attempt, so a missing traces route costs nothing.
    fn send(
        &self,
        config: &Config,
        buffer_dir: &Path,
        begin: &Begin,
        records: &[Record],
    ) -> Outcome {
        if records.is_empty() {
            return Outcome::Settled;
        }
        let logs = otlp::logs(begin, records, unix_ns(SystemTime::now()));
        let result = self.post(&config.logs_url(), config, &logs);
        let outcome = match result {
            Ok(status) if status == 408 || status == 429 || status >= 500 => Outcome::Retry,
            Ok(_) => Outcome::Settled,
            Err(_) => Outcome::Retry,
        };
        if outcome == Outcome::Settled
            && let (Some(url), Some(spans)) = (config.traces_url(), otlp::traces(begin, records))
        {
            let _ = self.post(&url, config, &spans);
        }
        note_last_send(buffer_dir, records.len(), &result);
        outcome
    }
}

fn describe(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "timeout".to_owned()
    } else if error.is_connect() {
        "connect".to_owned()
    } else {
        "request".to_owned()
    }
}

/// `last-send.json` beside the buffer, for checking delivery by hand.
fn note_last_send(buffer_dir: &Path, events: usize, result: &Result<u16, String>) {
    let summary = match result {
        Ok(status) => json!({ "status": status }),
        Err(error) => json!({ "error": error }),
    };
    let note = json!({
        "at_unix": unix_ns(SystemTime::now()) / 1_000_000_000,
        "events": events,
        "result": summary,
    });
    let _ = std::fs::write(buffer_dir.join(LAST_SEND_FILE), note.to_string());
}

/// Send this run's lines past `sent_to`; returns how far the file is now sent.
fn send_own(
    client: &Client,
    config: &Config,
    buffer_dir: &Path,
    shared: &Shared,
    sent_to: u64,
) -> u64 {
    let Ok((lines, end)) = read_lines(&shared.own_file, sent_to) else {
        return sent_to;
    };
    let records: Vec<Record> = records(&lines).cloned().collect();
    match client.send(config, buffer_dir, &shared.begin, &records) {
        Outcome::Settled => end,
        Outcome::Retry => sent_to,
    }
}

/// Send, then delete, the files of runs that are no longer recording. A file
/// whose lock is held belongs to a live run, which sends it itself.
fn send_left_behind(client: &Client, config: &Config, buffer_dir: &Path, own: &Path) {
    let Ok(entries) = std::fs::read_dir(buffer_dir) else {
        return;
    };
    let files: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().is_some_and(|ext| ext == "jsonl") && path != own)
        .take(MAX_FILES_PER_FLUSH)
        .collect();
    for path in files {
        let Ok(file) = File::open(&path) else {
            continue;
        };
        if file.try_lock().is_err() {
            continue;
        }
        let too_old = file
            .metadata()
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|modified| modified.elapsed().ok())
            .is_some_and(|age| age > MAX_FILE_AGE);
        if too_old {
            let _ = std::fs::remove_file(&path);
            continue;
        }
        let Ok((lines, _)) = read_lines(&path, 0) else {
            continue;
        };
        let outcome = match left_behind_batch(&lines) {
            Some((begin, records)) => client.send(config, buffer_dir, &begin, &records),
            // Not even a begin line: nothing to send.
            None => Outcome::Settled,
        };
        if outcome == Outcome::Settled {
            let _ = std::fs::remove_file(&path);
        }
    }
}

/// A left-behind file's records, closed with an `interrupted` run event when the
/// run never finished. That event names the step it was in.
pub(crate) fn left_behind_batch(lines: &[Line]) -> Option<(Begin, Vec<Record>)> {
    let begin = lines.iter().find_map(|line| match line {
        Line::Begin(begin) => Some(begin.clone()),
        _ => None,
    })?;
    let mut records: Vec<Record> = records(lines).cloned().collect();
    if records.iter().any(|record| record.event == RUN_EVENT) {
        return Some((begin, records));
    }

    let mut open_steps: Vec<&str> = Vec::new();
    let mut last_ns = begin.started_ns;
    for line in lines {
        match line {
            Line::Begin(_) => {}
            Line::Started { step, at_ns } => {
                open_steps.push(step);
                last_ns = last_ns.max(*at_ns);
            }
            Line::Record(record) => {
                if let Some(step) = record.fields.get("step").and_then(Value::as_str)
                    && let Some(index) = open_steps.iter().rposition(|open| *open == step)
                {
                    open_steps.remove(index);
                }
                last_ns = last_ns.max(record.at_ns);
            }
        }
    }
    let mut fields = BTreeMap::new();
    fields.insert("outcome".to_owned(), Value::from("interrupted"));
    if let Some(step) = open_steps.last() {
        fields.insert("failed_step".to_owned(), Value::from(*step));
    }
    let seq = records.iter().map(|record| record.seq).max().unwrap_or(0) + 1;
    records.push(Record {
        seq,
        event: RUN_EVENT.to_owned(),
        name: Some(RUN_EVENT.to_owned()),
        at_ns: last_ns,
        duration_ns: Some(last_ns.saturating_sub(begin.started_ns)),
        fields,
    });
    Some((begin, records))
}

fn records(lines: &[Line]) -> impl Iterator<Item = &Record> {
    lines.iter().filter_map(|line| match line {
        Line::Record(record) => Some(record),
        _ => None,
    })
}

/// Whole lines from `offset`, and the offset just past the last one. A line still
/// being written has no newline yet and waits for the next read.
fn read_lines(path: &Path, offset: u64) -> std::io::Result<(Vec<Line>, u64)> {
    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(offset))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    let complete = bytes
        .iter()
        .rposition(|byte| *byte == b'\n')
        .map_or(0, |index| index + 1);
    let lines = String::from_utf8_lossy(&bytes[..complete])
        .lines()
        // One unreadable line costs that line only.
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();
    Ok((lines, offset + complete as u64))
}

fn first_line_end(path: &Path) -> u64 {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| text.find('\n'))
        .map_or(0, |index| index as u64 + 1)
}
