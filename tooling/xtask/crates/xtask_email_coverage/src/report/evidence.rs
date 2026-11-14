//! The evidence files the harness writes: one per scenario that finished
//! healthy, in its log directory (`crates/email_e2e/src/evidence.rs`).

use std::path::{Path, PathBuf};

use rootcause::prelude::*;
use serde::Deserialize;
use serde_json::Value;

/// The name of an evidence file.
const FILE_NAME: &str = "evidence.json";
/// The layout this report reads.
const VERSION: u8 = 1;

/// What one scenario made the backend do.
#[derive(Debug, Deserialize)]
pub(crate) struct Evidence {
    version: u8,
    /// The test binary, as in `tests/<binary>.rs`.
    pub(crate) binary: String,
    /// The test within the binary.
    pub(crate) test: String,
    /// The providers of the inboxes the scenario linked.
    pub(crate) providers: Vec<String>,
    #[serde(default)]
    pub(crate) http: Vec<Http>,
    #[serde(default)]
    pub(crate) graphql: Vec<Graphql>,
    #[serde(default)]
    pub(crate) queue: Vec<Queue>,
    #[serde(default)]
    pub(crate) lambda: Vec<Lambda>,
    #[serde(default)]
    pub(crate) tools: Vec<Tool>,
    #[serde(default)]
    pub(crate) provider: Vec<ProviderCall>,
    #[serde(default)]
    pub(crate) kafka: Vec<Event>,
    #[serde(default)]
    pub(crate) services: Vec<ServiceRequest>,
}

impl Evidence {
    /// The scenario as nextest names it: `binary test`.
    pub(crate) fn scenario(&self) -> String {
        format!("{} {}", self.binary, self.test)
    }
}

#[derive(Debug, Deserialize)]
pub(crate) struct Http {
    pub(crate) service: String,
    pub(crate) method: String,
    /// The path with ids replaced by `{}`.
    pub(crate) path: String,
    /// The query's keys, each with its value when that is a short word,
    /// joined with `&`.
    #[serde(default)]
    pub(crate) query: String,
    /// The shape of the JSON body.
    #[serde(default)]
    pub(crate) body: Value,
    pub(crate) status: u16,
}

#[derive(Debug, Deserialize)]
pub(crate) struct Graphql {
    pub(crate) query: String,
    /// The shape of the variables.
    #[serde(default)]
    pub(crate) variables: Value,
    /// Whether the answer had data and no errors.
    pub(crate) answered: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct Queue {
    pub(crate) queue: String,
    /// `sent`, `received` or `handled`.
    pub(crate) step: String,
    pub(crate) body: Value,
}

#[derive(Debug, Deserialize)]
pub(crate) struct Lambda {
    pub(crate) function: String,
    pub(crate) succeeded: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct Tool {
    pub(crate) tool: String,
    pub(crate) succeeded: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ProviderCall {
    pub(crate) provider: String,
    /// The API method the emulator matched, if any.
    pub(crate) route: Option<String>,
    pub(crate) method: String,
    /// The path's shape, for a request that matched no API method.
    pub(crate) path: Option<String>,
    pub(crate) status: u16,
}

#[derive(Debug, Deserialize)]
pub(crate) struct Event {
    pub(crate) topic: String,
    /// The event's type, such as `email.message_sent`.
    pub(crate) event: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ServiceRequest {
    pub(crate) body: Option<Value>,
}

/// Reads every evidence file under `dirs`.
pub(crate) fn load(dirs: &[PathBuf]) -> Result<Vec<Evidence>, Report> {
    files_named(dirs, FILE_NAME)?
        .iter()
        .map(|file| {
            let text = std::fs::read_to_string(file)
                .context(format!("could not read {}", file.display()))?;
            let evidence: Evidence = serde_json::from_str(&text)
                .context(format!("{} is not an evidence file", file.display()))?;
            if evidence.version != VERSION {
                bail!(
                    "{} is evidence version {}, and this report reads version {VERSION}",
                    file.display(),
                    evidence.version
                );
            }
            Ok(evidence)
        })
        .collect()
}

/// Every file called `name` under `dirs`, in path order.
pub(crate) fn files_named(dirs: &[PathBuf], name: &str) -> Result<Vec<PathBuf>, Report> {
    let mut files = Vec::new();
    for dir in dirs {
        find(dir, name, &mut files)?;
    }
    files.sort();
    Ok(files)
}

fn find(dir: &Path, name: &str, files: &mut Vec<PathBuf>) -> Result<(), Report> {
    let entries = std::fs::read_dir(dir).context(format!("could not read {}", dir.display()))?;
    for entry in entries {
        let path = entry
            .context(format!("could not read {}", dir.display()))?
            .path();
        if path.is_dir() {
            find(&path, name, files)?;
        } else if path.file_name().is_some_and(|found| found == name) {
            files.push(path);
        }
    }
    Ok(())
}
