//! What `dorny/paths-filter` decides on a pull request: for each named
//! filter, whether any changed file matches one of its patterns.
//!
//! The action reads the pull request's files from GitHub, where a rename
//! counts as its old and its new path; [`crate::checkout::changed_files`]
//! lists them the same way. Patterns are picomatch globs with `dot: true`; the
//! attested workflows use only plain ones, and anything else is refused.

use std::collections::BTreeMap;

use glob::{MatchOptions, Pattern};
use rootcause::prelude::*;

#[cfg(test)]
mod test;

/// `*` stays inside one path segment, `**` crosses them, and dot files match.
const OPTIONS: MatchOptions = MatchOptions {
    case_sensitive: true,
    require_literal_separator: true,
    require_literal_leading_dot: false,
};

/// Characters of picomatch's braces and extglobs.
const UNSUPPORTED: [char; 5] = ['{', '}', '(', ')', '|'];

/// The action's outputs for its `filters` input: `'true'` or `'false'` per filter.
pub fn outputs(filters: &str, changed: &[String]) -> Result<BTreeMap<String, String>, Report> {
    let filters: BTreeMap<String, Vec<String>> = serde_yaml::from_str(filters)
        .context("a path filter is not a list of plain patterns per name")?;

    filters
        .into_iter()
        .map(|(name, patterns)| {
            let mut matched = false;
            for pattern in &patterns {
                if pattern.starts_with('!') {
                    bail!(
                        "filter `{name}` negates `{pattern}`, which cargo x attest does not emulate"
                    );
                }
                // Braces and extglobs mean something to picomatch and are
                // literal text to the matcher here.
                if pattern.contains(UNSUPPORTED) {
                    bail!(
                        "filter `{name}`: `{pattern}` uses glob syntax cargo x attest does not emulate"
                    );
                }
                let pattern = Pattern::new(pattern)
                    .context(format!("filter `{name}`: `{pattern}` is not a glob"))?;
                matched |= changed
                    .iter()
                    .any(|path| pattern.matches_with(path, OPTIONS));
            }
            Ok((name, matched.to_string()))
        })
        .collect()
}
