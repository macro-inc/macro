use std::collections::HashSet;

use chrono::{TimeDelta, TimeZone, Utc};

use agent_monitor::domain::model::{
    Commit, Lane, LaneBase, Oid, RepoGraph, RepoId, Timestamp, Trunk,
};

use super::layout::{Viewport, fit_scale, layout, quantize};
use crate::view::fork_order;

fn oid(n: u64) -> Oid {
    Oid::parse(&format!("{n:040x}")).expect("an oid")
}

fn now() -> Timestamp {
    Utc.with_ymd_and_hms(2030, 1, 2, 12, 0, 0)
        .single()
        .expect("a time")
}

fn ago(minutes: i64) -> Timestamp {
    now() - TimeDelta::minutes(minutes)
}

fn commit(n: u64, minutes: i64) -> Commit {
    Commit {
        oid: oid(n),
        at: ago(minutes),
        author: String::from("t"),
        subject: format!("commit {n}"),
        merge: false,
        pr: None,
    }
}

/// A lane forked from the trunk `fork` minutes ago with commits at `commits`
/// minutes ago (newest first), its ids from `id`.
fn lane(branch: &str, fork: i64, commits: &[i64], id: u64) -> Lane {
    Lane {
        branch: branch.to_owned(),
        aliases: Vec::new(),
        base: LaneBase::Trunk {
            oid: oid(1),
            at: ago(fork),
        },
        ahead: u32::try_from(commits.len()).unwrap_or(0),
        behind: 3,
        commits: commits
            .iter()
            .enumerate()
            .map(|(index, minutes)| commit(id + index as u64, *minutes))
            .collect(),
        elided: 0,
        pushed: None,
        worktree: None,
        agents: Vec::new(),
        pr: None,
        landed: None,
    }
}

fn stacked(branch: &str, on: &str, base: u64, commits: &[i64], id: u64) -> Lane {
    Lane {
        base: LaneBase::Lane {
            branch: on.to_owned(),
            oid: oid(base),
        },
        ..lane(branch, 0, commits, id)
    }
}

fn graph(trunk: Vec<Commit>, lanes: Vec<Lane>) -> RepoGraph {
    RepoGraph {
        id: RepoId::from_wire(String::from("/r/.git")),
        name: String::from("o/r"),
        remote: None,
        trunk: Trunk {
            name: String::from("origin/main"),
            commits: trunk,
            local: None,
            fetched_at: None,
            worktrees: Vec::new(),
        },
        lanes,
        hidden_lanes: 0,
        trunk_agents: Vec::new(),
    }
}

fn viewport(cols: u16, col_secs: i64) -> Viewport {
    Viewport {
        cols,
        rows: 20,
        col_secs,
        now: quantize(now(), col_secs, 0),
        scroll: 0,
        arc_rows: 3,
    }
}

#[test]
fn in_fork_order_no_fork_line_crosses_a_lane_and_stacks_stay_together() {
    let lanes = vec![
        lane("old", 300, &[250, 200], 100),
        lane("new", 60, &[30], 200),
        stacked("on-old", "old", 100, &[150], 300),
        lane("mid", 180, &[120, 90], 400),
        stacked("on-on-old", "on-old", 300, &[100], 500),
    ];
    let refs: Vec<&Lane> = lanes.iter().collect();
    let ordered = fork_order(&refs);
    let names: Vec<&str> = ordered.iter().map(|lane| lane.branch.as_str()).collect();
    // Newest fork nearest the trunk; each stack right under its base.
    assert_eq!(names, ["new", "mid", "old", "on-old", "on-on-old"]);

    let graph = graph(vec![commit(1, 400)], lanes.clone());
    let scene = layout(&graph, &ordered, &[], &HashSet::new(), viewport(120, 300));
    for drop in &scene.drops {
        let from = drop.from.map_or(0, |row| row + 1);
        for (lane, branch) in scene.lanes[from..drop.to]
            .iter()
            .zip(&ordered[from..drop.to])
        {
            assert!(
                lane.start.is_none_or(|start| start > drop.col),
                "the fork line at column {} crosses {}",
                drop.col,
                branch.branch
            );
        }
    }
}

#[test]
fn landed_arcs_nest_and_overlaps_are_flagged() {
    let mut outer = lane("outer", 300, &[250], 100);
    outer.landed = Some(oid(11));
    let mut inner = lane("inner", 200, &[190], 200);
    inner.landed = Some(oid(12));
    let mut overlapping = lane("overlap", 150, &[140], 300);
    overlapping.landed = Some(oid(13));
    let trunk = vec![
        commit(13, 20),
        commit(11, 60),
        commit(12, 100),
        commit(1, 400),
    ];
    let graph = graph(trunk, Vec::new());
    let landed = vec![&outer, &inner, &overlapping];
    let scene = layout(&graph, &[], &landed, &HashSet::new(), viewport(120, 300));
    let arc = |index: usize| {
        scene
            .arcs
            .iter()
            .find(|arc| arc.index == index)
            .expect("an arc")
    };
    assert!(
        arc(1).row < arc(0).row,
        "the inner arc sits nearer the trunk"
    );
    assert!(arc(2).crossing || arc(0).crossing || arc(1).crossing);
    assert!(scene.trunk[usize::from(arc(0).to)].arc_up);
}

#[test]
fn a_fork_left_of_the_window_has_no_start_and_buckets_count_commits() {
    let lanes = vec![lane("ancient", 60 * 24 * 9, &[60 * 24 * 8, 7, 6], 100)];
    let refs: Vec<&Lane> = lanes.iter().collect();
    let graph = graph(vec![commit(1, 30)], lanes.clone());
    let scene = layout(&graph, &refs, &[], &HashSet::new(), viewport(100, 300));
    let row = &scene.lanes[0];
    assert_eq!(row.start, None);
    assert_eq!(row.left, 1);
    // Two commits a minute apart share a five-minute bucket.
    assert_eq!(row.stations.len(), 1);
    assert_eq!(row.stations[0].commits, 2);
    assert!(!row.stations[0].pushed, "nothing pushed: hollow");
    // Both are held, so the commit cursor marks the bucket on either one.
    assert_eq!(row.stations[0].held, vec![oid(102), oid(101)]);
}

#[test]
fn now_is_quantised_so_a_scene_holds_within_a_bucket() {
    let lanes = vec![lane("feat", 120, &[60, 5], 100)];
    let refs: Vec<&Lane> = lanes.iter().collect();
    let graph = graph(vec![commit(1, 30)], lanes.clone());
    let at = |seconds: i64| Viewport {
        now: quantize(now() + TimeDelta::seconds(seconds), 300, 0),
        ..viewport(100, 300)
    };
    let first = layout(&graph, &refs, &[], &HashSet::new(), at(20));
    let second = layout(&graph, &refs, &[], &HashSet::new(), at(30));
    assert_eq!(first, second);
}

#[test]
fn the_automatic_zoom_fits_most_forks() {
    let lanes = [
        lane("a", 30, &[1], 1),
        lane("b", 90, &[1], 2),
        lane("c", 150, &[1], 3),
        lane("d", 60 * 24 * 5, &[1], 4),
    ];
    let refs: Vec<&Lane> = lanes.iter().collect();
    // 100 columns: one minute fits 30 and 90 (half), five minutes all but one.
    let scales = [60, 300, 900, 3_600];
    assert_eq!(fit_scale(&refs, now(), 100, &scales), 1);
}

#[test]
fn unpushed_counts_a_local_rewrite_as_all_unpushed() {
    let mut lane = lane("feat/a", 60, &[10, 20, 30], 100);
    lane.pushed = Some(oid(101));
    assert_eq!(
        super::layout::unpushed(&lane),
        1,
        "one commit above the push"
    );

    // Amended or rebased locally: the pushed commit is in no carried commit.
    lane.pushed = Some(oid(999));
    assert_eq!(super::layout::unpushed(&lane), 3);

    // It may be among elided commits: say nothing.
    lane.elided = 4;
    assert_eq!(super::layout::unpushed(&lane), 0);
}
