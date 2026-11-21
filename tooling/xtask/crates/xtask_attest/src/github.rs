//! What the tool asks GitHub, through the `gh` CLI and the developer's own
//! login: the merge commit `PR CI` will test, and the statuses on a commit.

use std::{process::Command, time::Duration};

use nom::{
    IResult, Parser,
    bytes::complete::{tag, take_while_m_n},
    character::complete::char,
    combinator::{all_consuming, opt, rest},
    sequence::preceded,
};
use rootcause::{option_ext::OptionExt, prelude::*};
use serde::Deserialize;

#[cfg(test)]
mod test;

/// GitHub cuts a status description here.
const DESCRIPTION_LIMIT: usize = 140;
/// GitHub builds a pull request's merge commit in the background after a
/// push; how often to ask for it, and how long to wait in between.
const MERGE_ATTEMPTS: u8 = 8;
const MERGE_WAIT: Duration = Duration::from_secs(5);
/// How many statuses GitHub lists per page.
const STATUS_PAGE: usize = 100;
/// The length of a fingerprint and of a git tree id, in hex digits.
const FINGERPRINT_DIGITS: usize = 16;
const TREE_DIGITS: usize = 40;

/// The merge commit GitHub built for a pull request.
pub struct PullMerge {
    pub number: u64,
    pub sha: String,
}

#[derive(Deserialize)]
struct Pull {
    number: u64,
    state: String,
    head: Ref,
    base: Ref,
    #[serde(default)]
    mergeable: Option<bool>,
    #[serde(default)]
    merge_commit_sha: Option<String>,
}

#[derive(Deserialize)]
struct Ref {
    #[serde(rename = "ref")]
    name: String,
    sha: String,
}

#[derive(Deserialize)]
struct GitCommit {
    parents: Vec<Object>,
}

#[derive(Deserialize)]
struct Object {
    sha: String,
}

/// One commit status. GitHub lists a commit's statuses newest first, and
/// keeps every one that was ever posted.
#[derive(Clone, Debug, Deserialize)]
pub struct Status {
    pub context: String,
    pub state: String,
    #[serde(default)]
    pub description: Option<String>,
}

/// What a status vouches for: the check as it was defined, and the tree it
/// ran on.
#[derive(Debug, PartialEq)]
pub struct Claim {
    pub fingerprint: String,
    pub tree: String,
}

/// Exactly `digits` lowercase hex digits.
fn hex_digits<'a>(
    digits: usize,
) -> impl Parser<&'a str, Output = &'a str, Error = nom::error::Error<&'a str>> {
    take_while_m_n(digits, digits, |c: char| {
        c.is_ascii_hexdigit() && !c.is_ascii_uppercase()
    })
}

/// `fp=<fingerprint> tree=<tree>`, then nothing or a space and free text.
fn claim(input: &str) -> IResult<&str, Claim> {
    let (input, (fingerprint, tree)) = (
        preceded(tag("fp="), hex_digits(FINGERPRINT_DIGITS)),
        preceded(tag(" tree="), hex_digits(TREE_DIGITS)),
    )
        .parse(input)?;
    let (input, _) = all_consuming(opt(preceded(char(' '), rest))).parse(input)?;
    Ok((
        input,
        Claim {
            fingerprint: fingerprint.to_owned(),
            tree: tree.to_owned(),
        },
    ))
}

impl Status {
    /// What the status vouches for, when `cargo x attest` or `PR CI` wrote it.
    pub fn claim(&self) -> Option<Claim> {
        claim(self.description.as_deref()?)
            .ok()
            .map(|(_, claim)| claim)
    }
}

/// The description of a status for a check and the tree it ran on.
pub fn description(fingerprint: &str, tree: &str, note: Option<&str>) -> String {
    let description = match note {
        Some(note) => format!("fp={fingerprint} tree={tree} {note}"),
        None => format!("fp={fingerprint} tree={tree}"),
    };
    description.chars().take(DESCRIPTION_LIMIT).collect()
}

fn api<T: serde::de::DeserializeOwned>(arguments: &[&str]) -> Result<T, Report> {
    let output = Command::new("gh")
        .arg("api")
        .args(arguments)
        .output()
        .context("could not run gh; cargo x attest reads and posts through it")?;
    if !output.status.success() {
        bail!(
            "gh api {} failed: {}",
            arguments.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(serde_json::from_slice(&output.stdout).context(format!(
        "gh api {} did not answer as expected",
        arguments.join(" ")
    ))?)
}

/// The open pull request into `base_branch` whose head is `head`.
fn open_pull(pulls: Vec<Pull>, head: &str, base_branch: &str) -> Option<Pull> {
    pulls
        .into_iter()
        .find(|pull| pull.state == "open" && pull.head.sha == head && pull.base.name == base_branch)
}

/// Whether a merge commit is the merge of `head` into one commit of the base
/// branch. A pull request's merge commit holds an older head until GitHub
/// rebuilds it.
fn merges(commit: &GitCommit, head: &str) -> bool {
    matches!(commit.parents.as_slice(), [_, merged] if merged.sha == head)
}

/// The merge commit `PR CI` will test for `head`: GitHub's merge of it into
/// `base_branch`, for the open pull request that has it as its head.
pub fn pull_request_merge(
    repository: &str,
    head: &str,
    base_branch: &str,
) -> Result<PullMerge, Report> {
    let pulls: Vec<Pull> = api(&[&format!("repos/{repository}/commits/{head}/pulls")])
        .context(format!("is {} pushed?", &head[..10]))?;
    let number = open_pull(pulls, head, base_branch)
        .context(format!(
            "no open pull request into {base_branch} has {} as its head; push it and open one first",
            &head[..10]
        ))?
        .number;

    for attempt in 1..=MERGE_ATTEMPTS {
        let pull: Pull = api(&[&format!("repos/{repository}/pulls/{number}")])?;
        if pull.mergeable == Some(false) {
            bail!("#{number} conflicts with {base_branch}; PR CI can't run on it either");
        }
        if let Some(sha) = pull
            .merge_commit_sha
            .filter(|_| pull.mergeable == Some(true))
        {
            let commit: GitCommit = api(&[&format!("repos/{repository}/git/commits/{sha}")])?;
            if merges(&commit, head) {
                return Ok(PullMerge { number, sha });
            }
        }
        if attempt < MERGE_ATTEMPTS {
            eprintln!("waiting for GitHub to build #{number}'s merge commit");
            std::thread::sleep(MERGE_WAIT);
        }
    }
    bail!(
        "GitHub has not built #{number}'s merge commit for {} yet; run this again in a moment",
        &head[..10]
    )
}

/// Every status on a commit, newest first.
pub fn statuses(repository: &str, head: &str) -> Result<Vec<Status>, Report> {
    let mut all = Vec::new();
    for page in 1.. {
        let batch: Vec<Status> = api(&[&format!(
            "repos/{repository}/commits/{head}/statuses?per_page={STATUS_PAGE}&page={page}"
        )])?;
        let last = batch.len() < STATUS_PAGE;
        all.extend(batch);
        if last {
            break;
        }
    }
    Ok(all)
}

/// Post a commit status on `head`.
pub fn post_status(
    repository: &str,
    head: &str,
    state: &str,
    context: &str,
    description: &str,
) -> Result<(), Report> {
    let output = Command::new("gh")
        .args(["api", "--method", "POST"])
        .arg(format!("repos/{repository}/statuses/{head}"))
        .args(["-f", &format!("state={state}")])
        .args(["-f", &format!("context={context}")])
        .args(["-f", &format!("description={description}")])
        .output()
        .context("could not run gh")?;
    if !output.status.success() {
        bail!(
            "could not post {context} on {}: {}",
            &head[..10],
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}
