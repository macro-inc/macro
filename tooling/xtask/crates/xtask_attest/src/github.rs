//! What the tool asks GitHub, through the `gh` CLI and the developer's own
//! login: the merge commit `PR CI` will test, and the statuses on a commit.

use std::{collections::BTreeMap, process::Command, time::Duration};

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

/// The merge commit GitHub built for a pull request.
pub struct PullMerge {
    pub number: u64,
    /// The commit of the base branch the head was merged into.
    pub base: String,
    pub tree: String,
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
    tree: Object,
    parents: Vec<Object>,
}

#[derive(Deserialize)]
struct Object {
    sha: String,
}

#[derive(Deserialize)]
struct CombinedStatus {
    statuses: Vec<Status>,
}

#[derive(Deserialize)]
struct Status {
    context: String,
    state: String,
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

/// The base and tree of a merge commit, when it is the merge of `head` into
/// one commit of the base branch. A pull request's merge commit holds an older
/// head until GitHub rebuilds it.
fn merge_of(commit: &GitCommit, head: &str) -> Option<(String, String)> {
    match commit.parents.as_slice() {
        [base, merged] if merged.sha == head => Some((base.sha.clone(), commit.tree.sha.clone())),
        _ => None,
    }
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
            "no open pull request into {base_branch} has {} as its head; push it and open one before --post",
            &head[..10]
        ))?
        .number;

    for attempt in 1..=MERGE_ATTEMPTS {
        let pull: Pull = api(&[&format!("repos/{repository}/pulls/{number}")])?;
        if pull.mergeable == Some(false) {
            bail!("#{number} conflicts with {base_branch}; PR CI can't run on it either");
        }
        if let Some(merge) = pull
            .merge_commit_sha
            .filter(|_| pull.mergeable == Some(true))
        {
            let commit: GitCommit = api(&[&format!("repos/{repository}/git/commits/{merge}")])?;
            if let Some((base, tree)) = merge_of(&commit, head) {
                return Ok(PullMerge { number, base, tree });
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

/// The state of the newest status of each context on a commit. Contexts are
/// in lower case: GitHub treats two that differ only in case as one.
pub fn newest_statuses(repository: &str, head: &str) -> Result<BTreeMap<String, String>, Report> {
    let combined: CombinedStatus = api(&[&format!(
        "repos/{repository}/commits/{head}/status?per_page=100"
    )])?;
    Ok(combined
        .statuses
        .into_iter()
        .map(|status| (status.context.to_lowercase(), status.state))
        .collect())
}

/// Post a commit status on `head`.
pub fn post_status(
    repository: &str,
    head: &str,
    state: &str,
    context: &str,
    description: &str,
) -> Result<(), Report> {
    let description: String = description.chars().take(DESCRIPTION_LIMIT).collect();
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
