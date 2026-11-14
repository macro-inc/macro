//! `lambda` rows: one per lambda service directory.

use rootcause::prelude::*;
use syn::Item;

use super::Entry;
use crate::repo::{Loc, Repo};
use crate::sources::LambdaSource;

/// Files that may hold a lambda's handler, most specific first.
const HANDLER_FILES: [&str; 2] = ["src/handler.rs", "src/main.rs"];

/// Lists the packages in the directories `source.glob` matches. A row's
/// source is the package's handler function, or its `main` without one.
pub(crate) fn list(repo: &Repo, source: &LambdaSource) -> Result<Vec<Entry>, Report> {
    let pattern = repo.root().join(&source.glob);
    let directories = glob::glob(&pattern.to_string_lossy())
        .context(format!("[[lambda]] glob `{}` is not valid", source.glob))?;

    let mut entries = Vec::new();
    for directory in directories {
        let directory = directory.context("could not list a lambda directory")?;
        let directory = directory
            .strip_prefix(repo.root())
            .context("a lambda directory is outside the repository")?
            .to_string_lossy()
            .into_owned();

        let manifest_path = format!("{directory}/Cargo.toml");
        let manifest: toml::Table = toml::from_str(&repo.read(&manifest_path)?)
            .context(format!("{manifest_path} is not valid"))?;
        let package = manifest
            .get("package")
            .and_then(|package| package.get("name"))
            .and_then(toml::Value::as_str)
            .ok_or_else(|| report!("{manifest_path}:1: no package name"))?;

        let handler_file = HANDLER_FILES
            .iter()
            .map(|file| format!("{directory}/{file}"))
            .find(|file| repo.is_file(file))
            .ok_or_else(|| report!("{directory} has no src/handler.rs or src/main.rs"))?;
        let parsed = repo.parse(&handler_file)?;
        let functions = || {
            parsed.items.iter().filter_map(|item| match item {
                Item::Fn(function) => Some(&function.sig.ident),
                _ => None,
            })
        };
        let handler = functions()
            .find(|name| name.to_string().contains("handler"))
            .or_else(|| functions().find(|name| *name == "main"))
            .ok_or_else(|| report!("{handler_file}:1: no handler or main function"))?;

        entries.push(Entry {
            key: package.to_owned(),
            matcher: String::new(),
            loc: Loc::new(&handler_file, handler.span()),
        });
    }

    if entries.is_empty() {
        bail!("[[lambda]] glob `{}` matches no directory", source.glob);
    }
    Ok(entries)
}
