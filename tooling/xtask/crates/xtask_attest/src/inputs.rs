//! What a check read: its input paths and the git object each one holds.
//!
//! A pass is recorded for a hash of these, and `PR CI`'s `Start` computes the
//! same hash over the merge commit it tests (`inputsHash` in `ci_gate.ts`).
//! A path's object id is git's own hash of everything under it, so two trees
//! hash alike exactly when every input holds the same bytes.

use std::{collections::BTreeMap, path::Path};

use nom::{
    IResult, Parser,
    bytes::complete::{tag, take_while1},
    character::complete::char,
    combinator::rest,
};
use rootcause::prelude::*;
use sha2::{Digest, Sha256};

use crate::git::{git, git_raw};

#[cfg(test)]
mod test;

/// The whole tree, as an input path.
const WHOLE_TREE: &str = ".";

/// The git object at each path of a tree; a path the tree lacks has no entry.
pub type Objects = BTreeMap<String, String>;

/// One entry of `git ls-tree`: `<mode> <type> <object>\t<path>`.
fn entry(input: &str) -> IResult<&str, (&str, &str)> {
    let word = || take_while1(|c: char| c.is_ascii_alphanumeric());
    let (path, (_, _, _, _, object, _)) =
        (word(), char(' '), word(), char(' '), word(), tag("\t")).parse(input)?;
    rest.map(|path| (object, path)).parse(path)
}

/// The object at each of `paths` in a commit or tree.
pub fn objects_at(dir: &Path, tree: &str, paths: &[String]) -> Result<Objects, Report> {
    let mut objects = Objects::new();

    let below: Vec<&str> = paths
        .iter()
        .map(String::as_str)
        .filter(|path| *path != WHOLE_TREE)
        .collect();
    if !below.is_empty() {
        let mut args = vec!["ls-tree", "-z", tree, "--"];
        args.extend(&below);
        let listing = String::from_utf8(git_raw(dir, &args)?)
            .map_err(|_| report!("git listed a path that is not UTF-8"))?;
        for line in listing.split('\0').filter(|line| !line.is_empty()) {
            let (_, (object, path)) =
                entry(line).map_err(|_| report!("git ls-tree printed `{line}`"))?;
            objects.insert(path.to_owned(), object.to_owned());
        }
    }
    if paths.iter().any(|path| path == WHOLE_TREE) {
        let root = git(dir, &["rev-parse", &format!("{tree}^{{tree}}")])?;
        objects.insert(WHOLE_TREE.to_owned(), root);
    }
    Ok(objects)
}

/// The hash a pass is recorded for: each input path with the object it holds,
/// in path order, SHA-256, 16 hex digits.
pub fn inputs_hash(inputs: &[String], objects: &Objects) -> String {
    let mut sorted: Vec<&String> = inputs.iter().collect();
    sorted.sort();
    let lines: String = sorted
        .iter()
        .map(|path| {
            let object = objects.get(*path).map_or("-", String::as_str);
            format!("{path}\t{object}\n")
        })
        .collect();
    hex::encode(&Sha256::digest(lines)[..8])
}

/// The inputs whose objects differ between two trees.
pub fn differing(inputs: &[String], left: &Objects, right: &Objects) -> Vec<String> {
    inputs
        .iter()
        .filter(|path| left.get(*path) != right.get(*path))
        .cloned()
        .collect()
}

/// What git reports as changed or untracked under the inputs. A pass is
/// recorded for a commit's files, so these must be committed first.
pub fn uncommitted(dir: &Path, inputs: &[String]) -> Result<Vec<String>, Report> {
    let mut args = vec!["status", "--porcelain", "--untracked-files=all", "--"];
    args.extend(inputs.iter().map(String::as_str));
    Ok(git(dir, &args)?
        .lines()
        .map(|line| line.trim().to_owned())
        .collect())
}
