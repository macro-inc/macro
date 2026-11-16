//! One gather: the four git reads that map a repository (refs, ahead/behind,
//! the trunk's log, the lanes' log) and the pure assembly around them.

use std::collections::BTreeMap;
use std::path::PathBuf;

use crate::domain::model::{MAX_TRUNK_COMMITS, RepoGraph, RepoId, RepoName, Timestamp};
use crate::outbound::git::assemble::{
    Assembled, Gathered, RepoWanted, assemble, candidates, choose_trunk, rank,
};
use crate::outbound::git::backend::{GitBackend, GitError};

/// Commits one gather reads at most across every lane.
pub const MAX_REPO_COMMITS: usize = 600;

/// A repository the source maps.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RepoPlace {
    /// Its id.
    pub id: RepoId,
    /// Its canonical common directory.
    pub common_dir: PathBuf,
    /// `owner/name` of `origin`, else the directory's name.
    pub name: String,
    /// Its `origin` repository on GitHub.
    pub remote: Option<RepoName>,
}

/// The repository's graph, or `None` when it has no trunk to draw against.
pub async fn gather<B: GitBackend>(
    backend: &B,
    place: &RepoPlace,
    wanted: &RepoWanted,
    now: Timestamp,
) -> Result<Option<RepoGraph>, GitError> {
    let repo = place.common_dir.clone();
    let refs = backend.refs(repo.clone()).await?;
    let Some(trunk) = choose_trunk(&refs) else {
        return Ok(None);
    };
    let candidates = candidates(&refs, &trunk, wanted, now);

    let mut names: Vec<String> = candidates.iter().map(|lane| lane.full.clone()).collect();
    if trunk.remote {
        names.push(trunk.local_full());
    }
    let counts = backend
        .ahead_behind(repo.clone(), trunk.full.clone(), names)
        .await?;
    let local_counts = trunk
        .remote
        .then(|| counts.get(&trunk.local_full()).copied())
        .flatten();
    let ranked = rank(candidates, &counts);

    let trunk_log = backend
        .trunk_log(repo.clone(), trunk.full.clone(), MAX_TRUNK_COMMITS)
        .await?;
    let tips = ranked
        .lanes
        .iter()
        .filter(|lane| lane.ahead > 0 && lane.child_of.is_none())
        .map(|lane| lane.candidate.oid.clone())
        .collect();
    let lane_log = backend
        .lane_log(repo.clone(), trunk.full.clone(), tips, MAX_REPO_COMMITS)
        .await?;
    let truncated = lane_log.iter().filter(|line| !line.boundary).count() >= MAX_REPO_COMMITS;
    let fetched_at = if trunk.remote {
        // The last fetch, else when the trunk's ref (or its reflog) last moved.
        let name = trunk.full.trim_start_matches("refs/");
        let mut latest = None;
        for path in [
            repo.join("FETCH_HEAD"),
            repo.join(&trunk.full),
            repo.join("logs/refs").join(name),
        ] {
            latest = latest.max(backend.modified(path).await);
        }
        latest
    } else {
        None
    };

    let mut gathered = Gathered {
        id: place.id.clone(),
        name: place.name.clone(),
        remote: place.remote.clone(),
        trunk: trunk.clone(),
        refs,
        local_counts,
        trunk_log,
        ranked,
        lane_log,
        fetched_at,
        bases: BTreeMap::new(),
    };
    let Assembled { graph, suspect } = assemble(gathered.clone(), now);
    if !truncated || suspect.is_empty() {
        return Ok(Some(graph));
    }
    // The limit cut the log short: a boundary may be a cut, not a fork.
    for (branch, tip) in suspect {
        if let Some(base) = backend
            .merge_base(repo.clone(), trunk.full.clone(), tip)
            .await
        {
            gathered.bases.insert(branch, base);
        }
    }
    Ok(Some(assemble(gathered, now).graph))
}
