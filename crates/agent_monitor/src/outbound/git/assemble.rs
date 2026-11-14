//! The pure half of a gather: which ref is the trunk, which branches become
//! lanes, and how the commits git printed become a bounded [`RepoGraph`].

#[cfg(test)]
mod test;

use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::PathBuf;

use chrono::TimeDelta;

use crate::domain::model::{
    Commit, Lane, LaneBase, LocalTrunk, MAX_LANE_COMMITS, MAX_LANES, Oid, RepoGraph, RepoId,
    RepoName, SUBJECT_CHARS, Timestamp, Trunk,
};
use crate::outbound::git::parse::{LogLine, RawCommit, RefRow};

/// A branch committed to this recently is drawn even with no agent or pull
/// request on it.
pub const RECENT: TimeDelta = TimeDelta::hours(24);

const HEADS: &str = "refs/heads/";
const ORIGIN: &str = "refs/remotes/origin/";

/// What the store wants mapped in one repository.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RepoWanted {
    /// Agent working directories inside this repository, each with whether
    /// a live agent sits there.
    pub cwds: BTreeMap<PathBuf, bool>,
    /// Head branches of pull requests on this repository's `origin`.
    pub pr_branches: BTreeSet<String>,
}

/// The ref every lane is measured against.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrunkRef {
    /// Its full name, such as `refs/remotes/origin/main`.
    pub full: String,
    /// Its short name, such as `origin/main`.
    pub short: String,
    /// The local branch of the same name, for a remote trunk, such as `main`;
    /// for a local trunk, the trunk itself.
    pub local: String,
    /// Whether the trunk is a remote-tracking ref.
    pub remote: bool,
}

impl TrunkRef {
    /// The local branch's full name.
    pub fn local_full(&self) -> String {
        format!("{HEADS}{}", self.local)
    }
}

/// The trunk: `origin/HEAD`'s target, else `origin/main`, `origin/master`,
/// local `main` or `master`.
pub fn choose_trunk(refs: &[RefRow]) -> Option<TrunkRef> {
    let exists = |name: &str| refs.iter().any(|row| row.name == name);
    let head = refs
        .iter()
        .find(|row| row.name == format!("{ORIGIN}HEAD"))
        .and_then(|row| row.symref.clone())
        .filter(|target| exists(target));
    let full = head.or_else(|| {
        ["main", "master"]
            .iter()
            .map(|name| format!("{ORIGIN}{name}"))
            .chain(
                ["main", "master"]
                    .iter()
                    .map(|name| format!("{HEADS}{name}")),
            )
            .find(|name| exists(name))
    })?;
    if let Some(name) = full.strip_prefix(ORIGIN) {
        return Some(TrunkRef {
            short: format!("origin/{name}"),
            local: name.to_owned(),
            full,
            remote: true,
        });
    }
    let name = full.strip_prefix(HEADS)?.to_owned();
    Some(TrunkRef {
        short: name.clone(),
        local: name,
        full,
        remote: false,
    })
}

/// A local branch that qualifies as a lane.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Candidate {
    /// Its short name.
    pub branch: String,
    /// Its full name.
    pub full: String,
    /// Its tip.
    pub oid: Oid,
    /// Its tip's commit time.
    pub at: Option<Timestamp>,
    /// The worktree it is checked out in.
    pub worktree: Option<PathBuf>,
    /// An agent sits in its worktree: `Some(true)` when one is live.
    pub agent: Option<bool>,
    /// A pull request has it as its head.
    pub pr: bool,
}

/// The local branches worth drawing:
///
/// 1. one checked out in the worktree that holds a wanted agent directory
///    (the longest matching worktree path, as agents sit in subdirectories);
/// 2. one a pull request has as its head;
/// 3. one committed to within [`RECENT`].
///
/// The trunk's local branch is never a lane.
pub fn candidates(
    refs: &[RefRow],
    trunk: &TrunkRef,
    wanted: &RepoWanted,
    now: Timestamp,
) -> Vec<Candidate> {
    let checkouts: Vec<(&PathBuf, &str)> = refs
        .iter()
        .filter(|row| row.name.starts_with(HEADS))
        .filter_map(|row| Some((row.worktree.as_ref()?, row.name.as_str())))
        .collect();
    let mut agents: HashMap<&str, bool> = HashMap::new();
    for (cwd, live) in &wanted.cwds {
        let best = checkouts
            .iter()
            .filter(|(path, _)| cwd.starts_with(path))
            .max_by_key(|(path, _)| path.components().count());
        if let Some((_, name)) = best {
            *agents.entry(name).or_insert(false) |= *live;
        }
    }

    let local_trunk = trunk.local_full();
    let horizon = now - RECENT;
    refs.iter()
        .filter(|row| row.name != local_trunk)
        .filter_map(|row| {
            let branch = row.name.strip_prefix(HEADS)?.to_owned();
            let agent = agents.get(row.name.as_str()).copied();
            let pr = wanted.pr_branches.contains(&branch);
            let recent = row.at.is_some_and(|at| at >= horizon);
            (agent.is_some() || pr || recent).then(|| Candidate {
                full: row.name.clone(),
                branch,
                oid: row.oid.clone(),
                at: row.at,
                worktree: row.worktree.clone(),
                agent,
                pr,
            })
        })
        .collect()
}

/// A candidate chosen as a lane.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Picked {
    /// The branch.
    pub candidate: Candidate,
    /// Commits it has that the trunk lacks.
    pub ahead: u32,
    /// Commits the trunk has that it lacks.
    pub behind: u32,
    /// Other branches at the same commit, with no agent of their own.
    pub aliases: Vec<String>,
    /// The lane at the same commit this one sits on, when this one has its
    /// own agent: a zero-commit child lane.
    pub child_of: Option<String>,
}

/// The lanes, in rank order, and how many qualified but did not fit.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Ranked {
    /// At most [`MAX_LANES`].
    pub lanes: Vec<Picked>,
    /// Lanes left out.
    pub hidden: u32,
}

/// Ranks candidates (live agent, ended agent, pull request, then newest
/// commit), drops those with nothing ahead of the trunk unless an agent sits
/// on them, folds branches at one commit into aliases, and keeps at most
/// [`MAX_LANES`].
pub fn rank(candidates: Vec<Candidate>, counts: &BTreeMap<String, (u32, u32)>) -> Ranked {
    let mut kept: Vec<(Candidate, u32, u32)> = candidates
        .into_iter()
        .filter_map(|candidate| {
            let (ahead, behind) = counts.get(&candidate.full).copied().unwrap_or((0, 0));
            (ahead > 0 || candidate.agent.is_some()).then_some((candidate, ahead, behind))
        })
        .collect();
    kept.sort_by_key(|(candidate, _, _)| {
        let class = match (candidate.agent, candidate.pr) {
            (Some(true), _) => 0,
            (Some(false), _) => 1,
            (None, true) => 2,
            (None, false) => 3,
        };
        (class, Reverse(candidate.at), candidate.branch.clone())
    });

    let mut lanes: Vec<Picked> = Vec::new();
    let mut by_oid: HashMap<Oid, usize> = HashMap::new();
    for (candidate, ahead, behind) in kept {
        if let Some(&first) = by_oid.get(&candidate.oid) {
            if candidate.agent.is_none() {
                if let Some(lane) = lanes.get_mut(first) {
                    lane.aliases.push(candidate.branch);
                }
                continue;
            }
            let parent = lanes.get(first).map(|lane| lane.candidate.branch.clone());
            lanes.push(Picked {
                candidate,
                ahead,
                behind,
                aliases: Vec::new(),
                child_of: parent,
            });
            continue;
        }
        by_oid.insert(candidate.oid.clone(), lanes.len());
        lanes.push(Picked {
            candidate,
            ahead,
            behind,
            aliases: Vec::new(),
            child_of: None,
        });
    }
    let hidden = u32::try_from(lanes.len().saturating_sub(MAX_LANES)).unwrap_or(u32::MAX);
    lanes.truncate(MAX_LANES);
    // A child whose parent was cut stands on its own.
    let names: BTreeSet<String> = lanes
        .iter()
        .map(|lane| lane.candidate.branch.clone())
        .collect();
    for lane in &mut lanes {
        if lane
            .child_of
            .as_ref()
            .is_some_and(|parent| !names.contains(parent))
        {
            lane.child_of = None;
        }
    }
    Ranked { lanes, hidden }
}

/// Everything [`assemble`] builds a graph from.
#[derive(Clone, Debug)]
pub struct Gathered {
    /// The repository's id.
    pub id: RepoId,
    /// Its display name.
    pub name: String,
    /// Its `origin` repository.
    pub remote: Option<RepoName>,
    /// The trunk.
    pub trunk: TrunkRef,
    /// Every ref.
    pub refs: Vec<RefRow>,
    /// The local trunk branch's `(ahead, behind)`, for a remote trunk.
    pub local_counts: Option<(u32, u32)>,
    /// The trunk's first-parent commits, newest first.
    pub trunk_log: Vec<RawCommit>,
    /// The lanes chosen.
    pub ranked: Ranked,
    /// Their commits and boundaries.
    pub lane_log: Vec<LogLine>,
    /// When the remote trunk last moved.
    pub fetched_at: Option<Timestamp>,
    /// Real merge-bases for lanes whose walk was cut off by the commit
    /// limit, by branch.
    pub bases: BTreeMap<String, (Oid, Timestamp)>,
}

/// The pull request number a squash merge's subject ends with: `… (#123)`.
fn pr_number(subject: &str) -> Option<u32> {
    lazy_regex::regex_captures!(r"\(#([0-9]+)\)\s*$", subject)
        .and_then(|(_, number)| number.parse().ok())
}

fn clip(text: &str) -> String {
    if text.chars().count() <= SUBJECT_CHARS {
        return text.to_owned();
    }
    let mut clipped: String = text.chars().take(SUBJECT_CHARS - 1).collect();
    clipped.push('…');
    clipped
}

/// A printed commit as the graph carries it.
pub fn commit(raw: &RawCommit) -> Commit {
    Commit {
        oid: raw.oid.clone(),
        at: raw.at,
        author: raw.author.clone(),
        subject: clip(&raw.subject),
        merge: raw.parents.len() > 1,
        pr: pr_number(&raw.subject),
    }
}

/// A built graph, and the lanes whose fork may be wrong.
#[derive(Clone, Debug, PartialEq)]
pub struct Assembled {
    /// The graph.
    pub graph: RepoGraph,
    /// Lanes forked from the trunk that walked fewer commits than they are
    /// ahead, with their tips: when the commit limit cut the log short,
    /// their boundary may not be their merge-base.
    pub suspect: Vec<(String, Oid)>,
}

/// Builds the graph. Each lane walks its tip's first-parent chain until it
/// reaches a boundary commit (it forks from the trunk there) or a commit a
/// lane walked earlier owns (it is stacked on that lane). Lanes walk in
/// ascending `ahead`, so the bottom of a stack claims shared commits first.
pub fn assemble(gathered: Gathered, now: Timestamp) -> Assembled {
    let Gathered {
        id,
        name,
        remote,
        trunk,
        refs,
        local_counts,
        trunk_log,
        ranked,
        lane_log,
        fetched_at,
        bases,
    } = gathered;

    let mut commits: HashMap<&Oid, &RawCommit> = HashMap::new();
    let mut boundary: HashMap<&Oid, Timestamp> = HashMap::new();
    for line in &lane_log {
        if line.boundary {
            boundary.insert(&line.commit.oid, line.commit.at);
        } else {
            commits.insert(&line.commit.oid, &line.commit);
        }
    }

    let mut order: Vec<usize> = (0..ranked.lanes.len()).collect();
    order.sort_by_key(|&index| ranked.lanes.get(index).map_or(0, |lane| lane.ahead));

    let mut owner: HashMap<Oid, String> = HashMap::new();
    let mut suspect = Vec::new();
    let mut walked: BTreeMap<usize, (LaneBase, Vec<Commit>, u32)> = BTreeMap::new();
    for index in order {
        let Some(picked) = ranked.lanes.get(index) else {
            continue;
        };
        let candidate = &picked.candidate;
        let tip_at = candidate.at.unwrap_or(now);
        if let Some(parent) = &picked.child_of {
            let base = LaneBase::Lane {
                branch: parent.clone(),
                oid: candidate.oid.clone(),
            };
            walked.insert(index, (base, Vec::new(), 0));
            continue;
        }
        let mut current = candidate.oid.clone();
        let mut own: Vec<&RawCommit> = Vec::new();
        let base = loop {
            if let Some(branch) = owner.get(&current) {
                break LaneBase::Lane {
                    branch: branch.clone(),
                    oid: current,
                };
            }
            if let Some(at) = boundary.get(&current) {
                break LaneBase::Trunk {
                    oid: current,
                    at: *at,
                };
            }
            let Some(raw) = commits.get(&current) else {
                // Not printed: the tip is on the trunk (nothing ahead), or the
                // commit limit cut the walk off.
                let at = own.last().map_or(tip_at, |raw| raw.at);
                break LaneBase::Trunk { oid: current, at };
            };
            owner.insert(current.clone(), candidate.branch.clone());
            own.push(raw);
            match raw.parents.first() {
                Some(parent) => current = parent.clone(),
                None => {
                    break LaneBase::Trunk {
                        oid: raw.oid.clone(),
                        at: raw.at,
                    };
                }
            }
        };
        let base = match (base, bases.get(&candidate.branch)) {
            (LaneBase::Trunk { .. }, Some((oid, at))) => LaneBase::Trunk {
                oid: oid.clone(),
                at: *at,
            },
            (base, _) => base,
        };
        let walked_count = u32::try_from(own.len()).unwrap_or(u32::MAX);
        if matches!(base, LaneBase::Trunk { .. }) && walked_count < picked.ahead {
            suspect.push((candidate.branch.clone(), candidate.oid.clone()));
        }
        let kept: Vec<Commit> = own.into_iter().take(MAX_LANE_COMMITS).map(commit).collect();
        let kept_count = u32::try_from(kept.len()).unwrap_or(u32::MAX);
        let total = match base {
            LaneBase::Trunk { .. } => walked_count.max(picked.ahead),
            LaneBase::Lane { .. } => walked_count,
        };
        walked.insert(index, (base, kept, total.saturating_sub(kept_count)));
    }

    let origin_of = |branch: &str| {
        refs.iter()
            .find(|row| row.name == format!("{ORIGIN}{branch}"))
            .map(|row| row.oid.clone())
    };
    let lanes = ranked
        .lanes
        .iter()
        .enumerate()
        .filter_map(|(index, picked)| {
            let (base, commits, elided) = walked.remove(&index)?;
            let candidate = &picked.candidate;
            Some(Lane {
                branch: candidate.branch.clone(),
                aliases: picked.aliases.clone(),
                base,
                ahead: picked.ahead,
                behind: picked.behind,
                commits,
                elided,
                pushed: origin_of(&candidate.branch),
                worktree: candidate.worktree.clone(),
                agents: Vec::new(),
                pr: None,
                landed: None,
            })
        })
        .collect();

    let local_full = trunk.local_full();
    let worktrees = refs
        .iter()
        .filter(|row| row.name == local_full)
        .filter_map(|row| row.worktree.clone())
        .collect();
    let local = match (trunk.remote, local_counts) {
        (true, Some((ahead, behind))) => Some(LocalTrunk {
            name: trunk.local.clone(),
            ahead,
            behind,
        }),
        _ => None,
    };
    let graph = RepoGraph {
        id,
        name,
        remote,
        trunk: Trunk {
            name: trunk.short,
            commits: trunk_log.iter().map(commit).collect(),
            local,
            fetched_at,
            worktrees,
        },
        lanes,
        hidden_lanes: ranked.hidden,
        trunk_agents: Vec::new(),
    };
    Assembled { graph, suspect }
}
