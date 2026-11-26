//! `loop` rows: the background loops a worker binary spawns.

use rootcause::prelude::*;
use syn::{Item, Visibility};

use super::Entry;
use crate::repo::{Loc, Repo};
use crate::sources::LoopSource;

/// What a loop's entry function is named, by convention.
const LOOP_PREFIX: &str = "run";

/// Lists the `pub` and `pub(crate)` `run*` functions of `source.file` as
/// `<file stem>::<function>`.
pub(crate) fn list(repo: &Repo, source: &LoopSource) -> Result<Vec<Entry>, Report> {
    let file = repo.parse(&source.file)?;
    let stem = std::path::Path::new(&source.file)
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .ok_or_else(|| report!("[[loop]] file `{}` has no name", source.file))?;

    let entries: Vec<Entry> = file
        .items
        .iter()
        .filter_map(|item| match item {
            Item::Fn(function)
                if !matches!(function.vis, Visibility::Inherited)
                    && function.sig.ident.to_string().starts_with(LOOP_PREFIX) =>
            {
                Some(&function.sig.ident)
            }
            _ => None,
        })
        .map(|name| Entry {
            key: format!("{stem}::{name}"),
            matcher: String::new(),
            loc: Loc::new(&source.file, name.span()),
        })
        .collect();

    if entries.is_empty() {
        bail!("{}:1: no public `{LOOP_PREFIX}*` function", source.file);
    }
    Ok(entries)
}
