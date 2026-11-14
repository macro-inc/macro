//! The results nextest writes as JUnit XML: which scenarios passed, which
//! failed, and which passed only when tried again.
//!
//! Only what nextest writes is read: `<testsuite name>` holding
//! `<testcase name>` elements, with a `<failure>` or `<error>` child for a
//! failed test and `<flakyFailure>` children for the failed attempts of one
//! that passed in the end.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use lazy_regex::regex;
use rootcause::prelude::*;

/// How a scenario ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Outcome {
    Passed,
    /// Passed after this many failed attempts.
    Flaky(usize),
    Failed,
}

/// One results file: one job's share of the suite.
#[derive(Debug)]
pub(crate) struct Run {
    /// The directory the file is in: one per job when a workflow gathers
    /// several.
    pub(crate) name: String,
    pub(crate) tests: usize,
    pub(crate) failed: usize,
    pub(crate) flaky: usize,
    /// The run's wall time in seconds, as nextest reports it.
    pub(crate) seconds: f64,
}

/// The results of every file given.
#[derive(Debug, Default)]
pub(crate) struct Results {
    pub(crate) runs: Vec<Run>,
    /// `binary test` to how it ended.
    pub(crate) outcomes: BTreeMap<String, Outcome>,
}

/// Reads the results files.
pub(crate) fn load(files: &[PathBuf]) -> Result<Results, Report> {
    let mut results = Results::default();
    for file in files {
        let text =
            std::fs::read_to_string(file).context(format!("could not read {}", file.display()))?;
        results.runs.push(read(file, &text, &mut results.outcomes));
    }
    Ok(results)
}

fn read(file: &Path, text: &str, outcomes: &mut BTreeMap<String, Outcome>) -> Run {
    let seconds = regex!(r#"<testsuites\b[^>]*\btime="([0-9.]+)""#)
        .captures(text)
        .and_then(|found| found[1].parse().ok())
        .unwrap_or_default();
    let mut run = Run {
        name: file
            .parent()
            .and_then(Path::file_name)
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        tests: 0,
        failed: 0,
        flaky: 0,
        seconds,
    };

    for case in regex!(r#"(?s)<testcase\b([^>]*?)(/>|>(.*?)</testcase>)"#).captures_iter(text) {
        let attributes = &case[1];
        let body = case.get(3).map_or("", |body| body.as_str());
        let (Some(name), Some(class)) = (
            attribute(attributes, "name"),
            attribute(attributes, "classname"),
        ) else {
            continue;
        };
        // nextest names a binary `package::binary`.
        let binary = class.rsplit("::").next().unwrap_or(&class).to_owned();
        let outcome = if body.contains("<failure") || body.contains("<error") {
            Outcome::Failed
        } else {
            match body.matches("<flakyFailure").count() {
                0 => Outcome::Passed,
                attempts => Outcome::Flaky(attempts),
            }
        };
        run.tests += 1;
        match outcome {
            Outcome::Failed => run.failed += 1,
            Outcome::Flaky(_) => run.flaky += 1,
            Outcome::Passed => {}
        }
        outcomes.insert(format!("{binary} {name}"), outcome);
    }
    run
}

fn attribute(attributes: &str, name: &str) -> Option<String> {
    regex!(r#"\b([a-z]+)="([^"]*)""#)
        .captures_iter(attributes)
        .find(|found| &found[1] == name)
        .map(|found| unescape(&found[2]))
}

fn unescape(text: &str) -> String {
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}
