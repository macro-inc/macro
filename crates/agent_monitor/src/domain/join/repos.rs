//! Repository graphs joined to agents and pull requests (the join table in
//! [`crate::domain::observation`]): the git source reports branches and
//! commits; this attaches who works on each lane and which pull request it is.

use std::collections::BTreeMap;
use std::path::Path;

use crate::domain::join::{Built, Facts};
use crate::domain::model::{Agent, AgentId, AgentKind, Lane, Pr, PrState, RepoGraph};
use crate::domain::observation::GitWanted;

/// Where an agent's working directory puts it in one repository.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Place {
    Trunk,
    Lane(usize),
}

/// Fills each graph's joined fields from `built`'s agents and pull requests
/// and files the result in `built.repos`.
pub(super) fn join_repos(facts: &Facts, built: &mut Built) {
    for owned in facts.repos.values() {
        let mut graph = owned.fact.clone();
        graph.trunk_agents.clear();
        for lane in &mut graph.lanes {
            lane.agents.clear();
            lane.pr = None;
            lane.landed = None;
        }
        attach_agents(&mut graph, built, facts);
        attach_prs(&mut graph, built);
        built.repos.insert(graph.id.clone(), graph);
    }
}

/// Whether an agent of this kind is drawn on a lane: subagents share their
/// session's checkout and shells are not agents.
fn drawn(agent: &Agent) -> bool {
    !matches!(agent.kind, AgentKind::Subagent | AgentKind::Shell)
}

fn attach_agents(graph: &mut RepoGraph, built: &Built, facts: &Facts) {
    let mut checkouts: Vec<(&Path, Place)> = graph
        .trunk
        .worktrees
        .iter()
        .map(|path| (path.as_path(), Place::Trunk))
        .collect();
    checkouts.extend(
        graph
            .lanes
            .iter()
            .enumerate()
            .filter_map(|(index, lane)| Some((lane.worktree.as_deref()?, Place::Lane(index)))),
    );
    let local_trunk = graph.trunk.local.as_ref().map(|local| local.name.clone());

    let mut placed: Vec<(Place, &Agent)> = Vec::new();
    for agent in built.agents.values().filter(|agent| drawn(agent)) {
        let by_cwd = agent.cwd.as_deref().and_then(|cwd| {
            checkouts
                .iter()
                .filter(|(path, _)| cwd.starts_with(path))
                .max_by_key(|(path, _)| path.components().count())
                .map(|(_, place)| *place)
        });
        let place = by_cwd.or_else(|| by_branch(graph, agent, facts, local_trunk.as_deref()));
        if let Some(place) = place {
            placed.push((place, agent));
        }
    }

    for (place, agent) in placed {
        match place {
            Place::Trunk => graph.trunk_agents.push(agent.id.clone()),
            Place::Lane(index) => {
                if let Some(lane) = graph.lanes.get_mut(index) {
                    lane.agents.push(agent.id.clone());
                }
            }
        }
    }
    order_agents(&mut graph.trunk_agents, built, None);
}

/// An agent whose directory is no worktree of this repository, matched by
/// its branch when its directory is a checkout of the same GitHub repository.
fn by_branch(
    graph: &RepoGraph,
    agent: &Agent,
    facts: &Facts,
    local_trunk: Option<&str>,
) -> Option<Place> {
    let branch = agent.branch.as_deref()?;
    let remote = graph.remote.as_ref()?;
    let repo = facts.checkout_repo(agent.cwd.as_deref()?)?;
    if repo != remote {
        return None;
    }
    if local_trunk == Some(branch) {
        return Some(Place::Trunk);
    }
    graph
        .lanes
        .iter()
        .position(|lane| lane.is_named(branch))
        .map(Place::Lane)
}

/// Agents in drawing order: `author` first, managers last. Status plays no
/// part, so an agent going idle does not change the graph.
fn order_agents(agents: &mut [AgentId], built: &Built, author: Option<&AgentId>) {
    agents.sort_by_key(|id| {
        let manager = built
            .agents
            .get(id)
            .is_some_and(|agent| agent.kind == AgentKind::Manager);
        (Some(id) != author, manager)
    });
}

fn attach_prs(graph: &mut RepoGraph, built: &Built) {
    let Some(remote) = graph.remote.clone() else {
        for lane in &mut graph.lanes {
            order_agents(&mut lane.agents, built, None);
        }
        return;
    };
    // Trunk commits by the pull request number their subject names.
    let by_number: BTreeMap<u32, _> = graph
        .trunk
        .commits
        .iter()
        .filter_map(|commit| Some((commit.pr?, commit.oid.clone())))
        .collect();
    for lane in &mut graph.lanes {
        let pr = best_pr(built.prs.values().filter(|pr| pr.repo == remote), lane);
        if let Some(pr) = pr {
            lane.pr = Some(pr.id.clone());
            if pr.state == PrState::Merged {
                lane.landed = pr
                    .merge_oid
                    .clone()
                    .or_else(|| by_number.get(&pr.number).cloned());
            }
            if lane.pushed.is_none() {
                lane.pushed.clone_from(&pr.head_oid);
            }
            // The author works on the lane even from another checkout.
            if let Some(author) = &pr.author_agent
                && built.agents.get(author).is_some_and(drawn)
                && !lane.agents.contains(author)
            {
                lane.agents.push(author.clone());
            }
        }
        let author = pr.and_then(|pr| pr.author_agent.as_ref());
        order_agents(&mut lane.agents, built, author);
    }
}

/// The lane's pull request: an open one over a finished one, then the newest.
fn best_pr<'a>(prs: impl Iterator<Item = &'a Pr>, lane: &Lane) -> Option<&'a Pr> {
    prs.filter(|pr| {
        pr.branch
            .as_deref()
            .is_some_and(|branch| lane.is_named(branch))
    })
    .max_by_key(|pr| (!pr.state.is_final(), pr.opened_at, pr.number))
}

/// What the git source should map for `built`: every drawn agent's working
/// directory (marked live unless the agent has ended), and the head branch
/// of every pull request by repository.
pub fn git_wanted(built: &Built) -> GitWanted {
    let mut wanted = GitWanted::default();
    for agent in built.agents.values().filter(|agent| drawn(agent)) {
        if let Some(cwd) = &agent.cwd {
            let live = wanted.cwds.entry(cwd.clone()).or_insert(false);
            *live |= !agent.status.is_final();
        }
    }
    for pr in built.prs.values() {
        if let Some(branch) = &pr.branch {
            wanted
                .pr_branches
                .entry(pr.repo.clone())
                .or_default()
                .insert(branch.clone());
        }
    }
    wanted
}
