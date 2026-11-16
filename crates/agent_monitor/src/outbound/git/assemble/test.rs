use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use chrono::{TimeDelta, TimeZone, Utc};

use super::{
    Candidate, Gathered, Ranked, RepoWanted, TrunkRef, assemble, candidates, choose_trunk, rank,
};
use crate::domain::model::{
    LaneBase, MAX_LANE_COMMITS, MAX_LANES, Oid, RepoGraph, RepoId, Timestamp,
};
use crate::outbound::git::parse::{LogLine, RawCommit, RefRow};

fn oid(n: u64) -> Oid {
    Oid::parse(&format!("{n:040x}")).expect("an oid")
}

fn at(minutes: i64) -> Timestamp {
    Utc.with_ymd_and_hms(2030, 1, 2, 12, 0, 0)
        .single()
        .expect("a time")
        + TimeDelta::minutes(minutes)
}

fn now() -> Timestamp {
    at(0)
}

fn raw(n: u64, parents: &[u64], minutes: i64, subject: &str) -> RawCommit {
    RawCommit {
        oid: oid(n),
        parents: parents.iter().map(|p| oid(*p)).collect(),
        at: at(minutes),
        author: String::from("t"),
        subject: subject.to_owned(),
    }
}

fn line(n: u64, parents: &[u64], minutes: i64) -> LogLine {
    LogLine {
        boundary: false,
        commit: raw(n, parents, minutes, &format!("commit {n}")),
    }
}

fn boundary(n: u64, minutes: i64) -> LogLine {
    LogLine {
        boundary: true,
        commit: raw(n, &[], minutes, "trunk"),
    }
}

fn row(name: &str, n: u64, minutes: i64, worktree: Option<&str>) -> RefRow {
    RefRow {
        name: name.to_owned(),
        oid: oid(n),
        at: Some(at(minutes)),
        worktree: worktree.map(PathBuf::from),
        symref: None,
    }
}

fn trunk() -> TrunkRef {
    TrunkRef {
        full: String::from("refs/remotes/origin/main"),
        short: String::from("origin/main"),
        local: String::from("main"),
        remote: true,
    }
}

fn candidate(branch: &str, tip: u64, agent: Option<bool>) -> Candidate {
    Candidate {
        branch: branch.to_owned(),
        full: format!("refs/heads/{branch}"),
        oid: oid(tip),
        at: Some(at(-1)),
        worktree: None,
        agent,
        pr: false,
    }
}

fn counts(rows: &[(&str, u32, u32)]) -> BTreeMap<String, (u32, u32)> {
    rows.iter()
        .map(|(branch, ahead, behind)| (format!("refs/heads/{branch}"), (*ahead, *behind)))
        .collect()
}

fn build(ranked: Ranked, lane_log: Vec<LogLine>) -> RepoGraph {
    let gathered = Gathered {
        id: RepoId::from_wire(String::from("/r/.git")),
        name: String::from("o/r"),
        remote: None,
        trunk: trunk(),
        refs: Vec::new(),
        local_counts: Some((0, 3)),
        trunk_log: vec![raw(1, &[0], -100, "feat: one (#12)")],
        ranked,
        lane_log,
        fetched_at: None,
        bases: BTreeMap::new(),
    };
    assemble(gathered, now()).graph
}

#[test]
fn the_trunk_is_origin_head_then_origin_main_then_local_main() {
    let mut head = row("refs/remotes/origin/HEAD", 1, 0, None);
    head.symref = Some(String::from("refs/remotes/origin/develop"));
    let refs = vec![
        head,
        row("refs/remotes/origin/develop", 1, 0, None),
        row("refs/remotes/origin/main", 2, 0, None),
        row("refs/heads/main", 3, 0, None),
    ];
    let chosen = choose_trunk(&refs).expect("a trunk");
    assert_eq!(chosen.short, "origin/develop");
    assert_eq!(chosen.local, "develop");

    let chosen = choose_trunk(&refs[2..]).expect("a trunk");
    assert_eq!(chosen.short, "origin/main");
    assert!(chosen.remote);

    let chosen = choose_trunk(&refs[3..]).expect("a trunk");
    assert_eq!(chosen.short, "main");
    assert!(!chosen.remote);
    assert_eq!(choose_trunk(&[]), None);
}

#[test]
fn branches_qualify_by_agent_pull_request_or_a_recent_commit() {
    let refs = vec![
        row("refs/heads/main", 1, 0, Some("/src/repo")),
        row("refs/heads/feat/agent", 2, -60 * 72, Some("/src/wt/agent")),
        row(
            "refs/heads/feat/nested",
            3,
            -60 * 72,
            Some("/src/wt/agent/inner"),
        ),
        row("refs/heads/feat/pr", 4, -60 * 72, None),
        row("refs/heads/feat/recent", 5, -30, None),
        row("refs/heads/feat/old", 6, -60 * 72, None),
        row("refs/remotes/origin/main", 1, 0, None),
    ];
    let wanted = RepoWanted {
        cwds: [
            // In a subdirectory: the longest worktree path wins.
            (PathBuf::from("/src/wt/agent/inner/crates"), true),
            (PathBuf::from("/src/wt/agent/docs"), false),
            // On the trunk's local branch: no lane.
            (PathBuf::from("/src/repo"), true),
        ]
        .into_iter()
        .collect(),
        pr_branches: BTreeSet::from([String::from("feat/pr")]),
    };
    let found = candidates(&refs, &trunk(), &wanted, now());
    let summary: Vec<(&str, Option<bool>, bool)> = found
        .iter()
        .map(|c| (c.branch.as_str(), c.agent, c.pr))
        .collect();
    assert_eq!(
        summary,
        vec![
            ("feat/agent", Some(false), false),
            ("feat/nested", Some(true), false),
            ("feat/pr", None, true),
            ("feat/recent", None, false),
        ]
    );
}

#[test]
fn ranking_puts_live_agents_first_folds_aliases_and_drops_empty_branches() {
    let mut pr = candidate("pr", 30, None);
    pr.pr = true;
    let ranked = rank(
        vec![
            candidate("recent", 10, None),
            pr,
            candidate("ended", 40, Some(false)),
            candidate("live", 50, Some(true)),
            // Same commit as `recent`, no agent: an alias.
            candidate("recent-copy", 10, None),
            // Same commit as `live`, with its own agent: a child lane.
            candidate("live-twin", 50, Some(true)),
            // Nothing ahead and no agent: dropped.
            candidate("parked", 60, None),
            // Nothing ahead with an agent: a stub.
            candidate("stub", 70, Some(false)),
        ],
        &counts(&[
            ("recent", 2, 0),
            ("recent-copy", 2, 0),
            ("pr", 1, 0),
            ("ended", 1, 0),
            ("live", 3, 1),
            ("live-twin", 3, 1),
            ("parked", 0, 5),
            ("stub", 0, 46),
        ]),
    );
    let order: Vec<&str> = ranked
        .lanes
        .iter()
        .map(|lane| lane.candidate.branch.as_str())
        .collect();
    assert_eq!(
        order,
        ["live", "live-twin", "ended", "stub", "pr", "recent"]
    );
    assert_eq!(ranked.lanes[1].child_of.as_deref(), Some("live"));
    assert_eq!(ranked.lanes[5].aliases, ["recent-copy"]);
    assert_eq!(ranked.hidden, 0);

    let graph = build(
        ranked,
        vec![line(50, &[1], -5), boundary(1, -100), line(10, &[1], -9)],
    );
    let twin = graph
        .lanes
        .iter()
        .find(|lane| lane.branch == "live-twin")
        .expect("twin");
    assert_eq!(
        twin.base,
        LaneBase::Lane {
            branch: String::from("live"),
            oid: oid(50)
        }
    );
    assert!(twin.commits.is_empty());
    let stub = graph
        .lanes
        .iter()
        .find(|lane| lane.branch == "stub")
        .expect("stub");
    assert_eq!(
        stub.base,
        LaneBase::Trunk {
            oid: oid(70),
            at: at(-1)
        }
    );
    assert_eq!(stub.behind, 46);
}

#[test]
fn a_plain_lane_forks_from_its_boundary_and_keeps_its_commits_newest_first() {
    let ranked = rank(
        vec![candidate("feat", 12, Some(true))],
        &counts(&[("feat", 2, 4)]),
    );
    let graph = build(
        ranked,
        vec![line(12, &[11], -2), line(11, &[1], -3), boundary(1, -100)],
    );
    let lane = &graph.lanes[0];
    assert_eq!(
        lane.base,
        LaneBase::Trunk {
            oid: oid(1),
            at: at(-100)
        }
    );
    let oids: Vec<Oid> = lane.commits.iter().map(|c| c.oid.clone()).collect();
    assert_eq!(oids, [oid(12), oid(11)]);
    assert_eq!((lane.ahead, lane.behind, lane.elided), (2, 4, 0));
    assert_eq!(graph.trunk.commits[0].pr, Some(12));
    assert_eq!(
        graph.trunk.local.as_ref().map(|local| local.behind),
        Some(3)
    );
}

#[test]
fn a_stack_of_three_hangs_each_lane_off_the_one_below() {
    let ranked = rank(
        vec![
            candidate("s3", 31, Some(true)),
            candidate("s1", 11, Some(true)),
            candidate("s2", 21, Some(true)),
        ],
        &counts(&[("s1", 1, 0), ("s2", 2, 0), ("s3", 3, 0)]),
    );
    let graph = build(
        ranked,
        vec![
            line(31, &[21], -1),
            line(21, &[11], -2),
            line(11, &[1], -3),
            boundary(1, -100),
        ],
    );
    let base = |branch: &str| {
        graph
            .lanes
            .iter()
            .find(|lane| lane.branch == branch)
            .map(|lane| (lane.base.clone(), lane.commits.len()))
            .expect("a lane")
    };
    assert_eq!(
        base("s1"),
        (
            LaneBase::Trunk {
                oid: oid(1),
                at: at(-100)
            },
            1
        )
    );
    assert_eq!(
        base("s2"),
        (
            LaneBase::Lane {
                branch: String::from("s1"),
                oid: oid(11)
            },
            1
        )
    );
    assert_eq!(
        base("s3"),
        (
            LaneBase::Lane {
                branch: String::from("s2"),
                oid: oid(21)
            },
            1
        )
    );
}

#[test]
fn a_merge_of_the_trunk_into_a_lane_follows_the_first_parent() {
    let ranked = rank(
        vec![candidate("feat", 13, Some(true))],
        &counts(&[("feat", 3, 0)]),
    );
    let graph = build(
        ranked,
        vec![
            line(13, &[12, 5], -1),
            line(12, &[11], -2),
            line(11, &[1], -3),
            boundary(5, -10),
            boundary(1, -100),
        ],
    );
    let lane = &graph.lanes[0];
    assert_eq!(lane.commits.len(), 3);
    assert!(lane.commits[0].merge);
    assert!(!lane.commits[1].merge);
    assert_eq!(
        lane.base,
        LaneBase::Trunk {
            oid: oid(1),
            at: at(-100)
        }
    );
}

#[test]
fn a_fork_older_than_the_trunk_window_keeps_its_time_and_distance() {
    let ranked = rank(
        vec![candidate("old", 11, None)],
        &counts(&[("old", 1, 204)]),
    );
    let graph = build(ranked, vec![line(11, &[2], -1), boundary(2, -60 * 24 * 9)]);
    let lane = &graph.lanes[0];
    assert_eq!(lane.behind, 204);
    assert_eq!(
        lane.base,
        LaneBase::Trunk {
            oid: oid(2),
            at: at(-60 * 24 * 9)
        }
    );
}

#[test]
fn lanes_and_commits_are_capped_and_counted() {
    let many: Vec<Candidate> = (0..45)
        .map(|n| candidate(&format!("b{n:02}"), 1_000 + n, None))
        .collect();
    let rows: Vec<(String, u32, u32)> = (0..45).map(|n| (format!("b{n:02}"), 1, 0)).collect();
    let rows: Vec<(&str, u32, u32)> = rows.iter().map(|(b, a, c)| (b.as_str(), *a, *c)).collect();
    let ranked = rank(many, &counts(&rows));
    assert_eq!(ranked.lanes.len(), MAX_LANES);
    assert_eq!(ranked.hidden, 5);

    // A lane 35 commits long carries 30 and counts the rest.
    let ranked = rank(
        vec![candidate("long", 135, Some(true))],
        &counts(&[("long", 35, 0)]),
    );
    let mut log: Vec<LogLine> = (101..=135)
        .rev()
        .map(|n| {
            line(
                n,
                &[if n == 101 { 1 } else { n - 1 }],
                -(136 - i64::try_from(n).unwrap_or(0)),
            )
        })
        .collect();
    log.push(boundary(1, -100));
    let graph = build(ranked, log);
    let lane = &graph.lanes[0];
    assert_eq!(lane.commits.len(), MAX_LANE_COMMITS);
    assert_eq!(lane.elided, 5);
    assert_eq!(lane.commits[0].oid, oid(135));
}

#[test]
fn a_walk_cut_off_by_the_commit_limit_is_flagged_for_its_merge_base() {
    let ranked = rank(
        vec![candidate("long", 13, None)],
        &counts(&[("long", 9, 0)]),
    );
    let gathered = Gathered {
        id: RepoId::from_wire(String::from("/r/.git")),
        name: String::from("o/r"),
        remote: None,
        trunk: trunk(),
        refs: Vec::new(),
        local_counts: None,
        trunk_log: Vec::new(),
        ranked,
        lane_log: vec![line(13, &[12], -1), boundary(12, -2)],
        fetched_at: None,
        bases: BTreeMap::new(),
    };
    let assembled = assemble(gathered.clone(), now());
    assert_eq!(assembled.suspect, vec![(String::from("long"), oid(13))]);
    let mut fixed = gathered;
    fixed.bases.insert(String::from("long"), (oid(1), at(-500)));
    let graph = assemble(fixed, now()).graph;
    assert_eq!(
        graph.lanes[0].base,
        LaneBase::Trunk {
            oid: oid(1),
            at: at(-500)
        }
    );
    assert_eq!(graph.lanes[0].elided, 8);
}
