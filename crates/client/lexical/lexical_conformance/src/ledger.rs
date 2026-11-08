//! Exact, reasoned expected failures. Unsupported work remains visible.
use crate::{
    fixture::Fixture,
    replay::{Result, fail},
};
use serde::Deserialize;
/// Tier A ledger, pinned to the same upstream as fixtures.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Ledger {
    /// Oracle version.
    pub upstream: String,
    /// Declared oracle patches.
    pub patches: Vec<String>,
    /// Packages whose allocation order is checked literally.
    pub strict_packages: Vec<String>,
    /// Exact expected failures.
    pub entries: Vec<Entry>,
}
/// One exact test identity. No case-level globs or blanket error matching.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Entry {
    /// Source file.
    pub file: String,
    /// Full test name, joined with ` > `.
    pub test: String,
    /// Must fail until the missing capability lands.
    pub status: Status,
    /// Closed reason from S4 §2.6.
    pub reason: Reason,
    /// Review provenance.
    pub reviewed_by: String,
    /// Specification decision.
    pub decision: String,
    /// Concrete missing API or policy, for review.
    pub note: String,
    /// Expected diagnostic; a different earlier error must still fail.
    pub failure: String,
}
/// Only expected failures are currently admitted; they always execute.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    /// Unexpected success fails the ratchet.
    Xfail,
}
/// Supported, narrowly scoped S4 reasons.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Reason {
    /// A later work package or explicit n/a API.
    NotPorted,
    /// DOM-only reconciliation internals.
    ReconcilerInternal,
    /// Production and development have explicitly different outcomes.
    DevOnlyInvariant,
    /// Persistent map replaces the upstream GenMap implementation.
    Genmap,
    /// Macro-specific policy/configuration is deferred to its package layer.
    MacroPatch,
    /// D6 leaves tokenization and syntax highlighting in JavaScript.
    D6Highlight,
}
impl Ledger {
    /// Validate every entry and reject stale or duplicate identities.
    pub fn validate(&self, fixtures: &[Fixture]) -> Result<()> {
        if self.upstream != "0.45.0" || !self.patches.is_empty() {
            return Err(fail("unsupported ledger oracle/patches"));
        }
        let mut identities = std::collections::HashSet::new();
        for entry in &self.entries {
            if entry.test == "*" || !identities.insert((&entry.file, &entry.test)) {
                return Err(fail("duplicate or wildcard ledger test"));
            }
            if [
                &entry.reviewed_by,
                &entry.decision,
                &entry.note,
                &entry.failure,
            ]
            .iter()
            .any(|s| s.trim().is_empty())
            {
                return Err(fail("ledger entry lacks reason/review/decision/diagnostic"));
            }
            if !fixtures
                .iter()
                .any(|f| f.source.file == entry.file && f.source.test.join(" > ") == entry.test)
            {
                return Err(fail(format!("stale ledger entry: {}", entry.test)));
            }
        }
        Ok(())
    }
    /// Find the exact expected failure for a fixture.
    pub fn entry(&self, fixture: &Fixture) -> Option<&Entry> {
        self.entries
            .iter()
            .find(|e| e.file == fixture.source.file && e.test == fixture.source.test.join(" > "))
    }
}

impl Entry {
    /// Match the complete diagnostic, including operation context, byte for byte.
    pub fn matches_failure(&self, error: &crate::replay::ReplayError) -> bool {
        error.to_string() == self.failure
    }
}
#[cfg(test)]
mod test;
