//! The batched GraphQL query and its answer.
//!
//! One `repository` field per repository (aliased `r<i>`), and inside it one
//! `pullRequest(number:)` per known pull request (`p<j>`) and one
//! `pullRequests(headRefName:)` per branch to resolve (`b<j>`), all sharing
//! one fragment. CI is the head commit's `CI gate` status when it has one,
//! else the rollup of every check.

use std::collections::{BTreeMap, BTreeSet};

use serde::Deserialize;

use crate::domain::model::{CiState, Mergeable, PrRef, PrState, RepoName, ReviewState, Timestamp};
use crate::domain::observation::PrStatusFact;
use crate::outbound::github::GithubError;

/// Lookups per query; more go into further queries.
const ITEMS_PER_QUERY: usize = 100;

/// The commit status that decides a pull request's CI when present.
pub const CI_GATE_CONTEXT: &str = "CI gate";

/// What one query asks, by alias.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PrQuery {
    /// The GraphQL text.
    pub text: String,
    /// Each repository alias with its repository and its lookups by alias.
    pub repos: Vec<(String, RepoName, Vec<(String, Lookup)>)>,
}

/// One lookup inside a repository.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Lookup {
    /// A pull request by number.
    Number(u32),
    /// The most recently updated pull request with this head branch.
    Branch(String),
}

/// The queries that cover `refs` and `branches`, at most
/// [`ITEMS_PER_QUERY`] lookups each; none when there is nothing to ask.
pub fn queries(refs: &BTreeSet<PrRef>, branches: &BTreeSet<(RepoName, String)>) -> Vec<PrQuery> {
    let mut by_repo: BTreeMap<&RepoName, Vec<Lookup>> = BTreeMap::new();
    for pr in refs {
        by_repo
            .entry(&pr.repo)
            .or_default()
            .push(Lookup::Number(pr.number));
    }
    for (repo, branch) in branches {
        by_repo
            .entry(repo)
            .or_default()
            .push(Lookup::Branch(branch.clone()));
    }

    let mut queries = Vec::new();
    let mut current: Vec<(RepoName, Vec<Lookup>)> = Vec::new();
    let mut count = 0;
    for (repo, lookups) in by_repo {
        for lookup in lookups {
            if count == ITEMS_PER_QUERY {
                queries.push(build(std::mem::take(&mut current)));
                count = 0;
            }
            match current.last_mut() {
                Some((last, items)) if last == repo => items.push(lookup),
                _ => current.push((repo.clone(), vec![lookup])),
            }
            count += 1;
        }
    }
    if !current.is_empty() {
        queries.push(build(current));
    }
    queries
}

fn build(repos: Vec<(RepoName, Vec<Lookup>)>) -> PrQuery {
    let mut text = String::from("query {\n");
    let mut aliased = Vec::new();
    for (index, (repo, lookups)) in repos.into_iter().enumerate() {
        let repo_alias = format!("r{index}");
        // Owner and name hold only [A-Za-z0-9_.-] (RepoName), so they need
        // no escaping.
        text.push_str(&format!(
            "  {repo_alias}: repository(owner: \"{}\", name: \"{}\") {{\n",
            repo.owner(),
            repo.name()
        ));
        let mut items = Vec::new();
        for (item, lookup) in lookups.into_iter().enumerate() {
            let alias = match &lookup {
                Lookup::Number(number) => {
                    let alias = format!("p{item}");
                    text.push_str(&format!(
                        "    {alias}: pullRequest(number: {number}) {{ ...pr }}\n"
                    ));
                    alias
                }
                Lookup::Branch(branch) => {
                    let alias = format!("b{item}");
                    let branch = serde_json::to_string(branch).unwrap_or_default();
                    text.push_str(&format!(
                        "    {alias}: pullRequests(headRefName: {branch}, first: 1, \
                         orderBy: {{field: UPDATED_AT, direction: DESC}}) {{ nodes {{ ...pr }} }}\n"
                    ));
                    alias
                }
            };
            items.push((alias, lookup));
        }
        text.push_str("  }\n");
        aliased.push((repo_alias, repo, items));
    }
    text.push_str("}\n");
    text.push_str(&format!(
        "fragment pr on PullRequest {{ number url title state isDraft headRefName mergeable \
         reviewDecision createdAt updatedAt mergedAt closedAt commits(last: 1) {{ nodes {{ commit \
         {{ statusCheckRollup {{ state }} status {{ context(name: \"{CI_GATE_CONTEXT}\") {{ state }} \
         }} }} }} }} }}\n"
    ));
    PrQuery {
        text,
        repos: aliased,
    }
}

#[derive(Deserialize)]
struct Response {
    data: Option<BTreeMap<String, Option<BTreeMap<String, serde_json::Value>>>>,
}

#[derive(Deserialize)]
struct Connection {
    nodes: Vec<Option<Node>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Node {
    number: u32,
    url: Option<String>,
    title: Option<String>,
    state: Option<String>,
    #[serde(default)]
    is_draft: bool,
    head_ref_name: Option<String>,
    mergeable: Option<String>,
    review_decision: Option<String>,
    created_at: Option<Timestamp>,
    updated_at: Option<Timestamp>,
    merged_at: Option<Timestamp>,
    closed_at: Option<Timestamp>,
    commits: Option<Commits>,
}

#[derive(Deserialize)]
struct Commits {
    nodes: Vec<Option<CommitNode>>,
}

#[derive(Deserialize)]
struct CommitNode {
    commit: Option<Commit>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Commit {
    status_check_rollup: Option<StateField>,
    status: Option<Status>,
}

#[derive(Deserialize)]
struct Status {
    context: Option<StateField>,
}

#[derive(Deserialize)]
struct StateField {
    state: Option<String>,
}

/// Every pull request in the answer to `query`. A lookup GitHub could not
/// answer (an unknown number, a branch with no pull request, a repository
/// out of reach) is skipped; an answer with no `data` at all is an error.
pub fn parse_response(query: &PrQuery, body: &[u8]) -> Result<Vec<PrStatusFact>, GithubError> {
    let response: Response = serde_json::from_slice(body)
        .map_err(|error| GithubError::Failed(format!("undecodable answer: {error}")))?;
    let data = response
        .data
        .ok_or_else(|| GithubError::Failed(String::from("answer has no data")))?;

    let mut statuses = Vec::new();
    for (repo_alias, repo, items) in &query.repos {
        let Some(Some(fields)) = data.get(repo_alias) else {
            continue;
        };
        for (alias, lookup) in items {
            let Some(value) = fields.get(alias) else {
                continue;
            };
            let node = match lookup {
                Lookup::Number(_) => serde_json::from_value::<Option<Node>>(value.clone())
                    .ok()
                    .flatten(),
                Lookup::Branch(_) => serde_json::from_value::<Option<Connection>>(value.clone())
                    .ok()
                    .flatten()
                    .and_then(|connection| connection.nodes.into_iter().flatten().next()),
            };
            if let Some(node) = node {
                statuses.push(status(repo, node));
            }
        }
    }
    Ok(statuses)
}

fn status(repo: &RepoName, node: Node) -> PrStatusFact {
    let pr = PrRef {
        repo: repo.clone(),
        number: node.number,
    };
    let state = match (node.state.as_deref(), node.is_draft) {
        (Some("MERGED"), _) => PrState::Merged,
        (Some("CLOSED"), _) => PrState::Closed,
        (Some("OPEN"), true) => PrState::Draft,
        (Some("OPEN"), false) => PrState::Open,
        _ => PrState::Unknown,
    };
    let mergeable = match node.mergeable.as_deref() {
        Some("MERGEABLE") => Mergeable::Mergeable,
        Some("CONFLICTING") => Mergeable::Conflicting,
        _ => Mergeable::Unknown,
    };
    let review = match node.review_decision.as_deref() {
        Some("APPROVED") => ReviewState::Approved,
        Some("CHANGES_REQUESTED") => ReviewState::ChangesRequested,
        Some("REVIEW_REQUIRED") => ReviewState::ReviewRequired,
        _ => ReviewState::None,
    };
    let commit = node
        .commits
        .and_then(|commits| commits.nodes.into_iter().flatten().next_back())
        .and_then(|node| node.commit);
    let ci = commit.map_or(CiState::None, |commit| {
        let gate = commit
            .status
            .and_then(|status| status.context)
            .and_then(|context| context.state);
        let rollup = commit
            .status_check_rollup
            .and_then(|rollup| rollup.state);
        gate.or(rollup).as_deref().map_or(CiState::None, ci_state)
    });
    PrStatusFact {
        url: node.url.unwrap_or_else(|| pr.url()),
        pr,
        title: node.title,
        state,
        ci,
        review,
        mergeable,
        branch: node.head_ref_name,
        created: node.created_at,
        updated: node.updated_at,
        closed: node.merged_at.or(node.closed_at),
    }
}

/// A status or rollup state (`SUCCESS`, `FAILURE`, `ERROR`, `PENDING`,
/// `EXPECTED`) as CI.
fn ci_state(state: &str) -> CiState {
    match state {
        "SUCCESS" => CiState::Passed,
        "FAILURE" | "ERROR" => CiState::Failed,
        "PENDING" | "EXPECTED" => CiState::Running,
        _ => CiState::None,
    }
}
