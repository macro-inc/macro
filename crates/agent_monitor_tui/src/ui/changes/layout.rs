//! The CHANGES map's geometry, computed without drawing: time buckets to
//! columns, lanes to rows, fork lines, landed arcs packed above the trunk,
//! and what falls outside. [`super::draw`] paints a [`Scene`] with theme
//! tokens; tests check the scene.

use std::collections::{HashMap, HashSet};

use chrono::TimeDelta;

use agent_monitor::domain::model::{Lane, LaneBase, Oid, RepoGraph, Timestamp};

use crate::view::fork_time;

/// Rows of landed arcs drawn above the trunk at most.
pub const MAX_ARC_ROWS: usize = 3;

/// Share of lane forks the automatic zoom keeps on screen; the rest enter
/// from the left edge with their distance, so recent work is not squeezed
/// into a few columns by one old branch.
const FIT_SHARE: f64 = 0.6;

/// What the map looks at.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Viewport {
    /// Map columns; the last one is now.
    pub cols: u16,
    /// Lane rows that fit below the trunk.
    pub rows: u16,
    /// Seconds one column stands for.
    pub col_secs: i64,
    /// The right edge's time: the end of the current bucket, panned back.
    pub now: Timestamp,
    /// The first lane row shown.
    pub scroll: usize,
    /// Arc rows that fit above the trunk.
    pub arc_rows: u16,
}

/// The end of the bucket holding `now`, panned back `pan` columns: the map
/// moves one column when a bucket ends, not every frame.
pub fn quantize(now: Timestamp, col_secs: i64, pan: u32) -> Timestamp {
    let secs = now.timestamp();
    let end = secs.div_euclid(col_secs.max(1)) * col_secs.max(1) + col_secs.max(1);
    let end = end - i64::from(pan) * col_secs.max(1);
    chrono::DateTime::from_timestamp(end, 0).unwrap_or(now)
}

/// The finest of `scales` (seconds per column, finest first) at which at
/// least 60 % of the lanes' forks fit in `cols` columns; the coarsest when
/// none does.
pub fn fit_scale(lanes: &[&Lane], now: Timestamp, cols: u16, scales: &[i64]) -> usize {
    let forks: Vec<Timestamp> = lanes.iter().filter_map(|lane| fork_time(lane)).collect();
    if forks.is_empty() {
        return scales.len().saturating_sub(1).min(2);
    }
    let span = |secs: i64| TimeDelta::seconds(secs * i64::from(cols.saturating_sub(1)));
    scales
        .iter()
        .position(|secs| {
            let inside = forks.iter().filter(|at| now - **at <= span(*secs)).count();
            inside as f64 >= forks.len() as f64 * FIT_SHARE
        })
        .unwrap_or(scales.len().saturating_sub(1))
}

/// A trunk column.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TrunkCell {
    /// Trunk commits in the bucket.
    pub commits: u16,
    /// The newest of them.
    pub oid: Option<Oid>,
    /// One of them is a landed pull request of ours.
    pub landed: bool,
    /// A lane forks down here.
    pub fork_down: bool,
    /// A landed arc rises or lands here.
    pub arc_up: bool,
}

/// What sits in one lane cell.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Station {
    /// The column.
    pub col: u16,
    /// Commits in the bucket.
    pub commits: u16,
    /// The newest commit there.
    pub oid: Oid,
    /// Every commit there is pushed.
    pub pushed: bool,
}

/// One lane's row.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LaneRow {
    /// The lane's index in the ordered lanes.
    pub index: usize,
    /// Its row below the trunk, counted from 0 over every lane (not only
    /// the visible ones).
    pub row: usize,
    /// The column it forks at; `None` when that is left of the window.
    pub start: Option<u16>,
    /// Its commits by column, oldest first.
    pub stations: Vec<Station>,
    /// The tip's column.
    pub tip: u16,
    /// Commits left of the window.
    pub left: usize,
}

/// A fork line: from the row the lane forks off (`None`: the trunk) down to
/// the lane's row, at a column.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Drop {
    /// The column.
    pub col: u16,
    /// The parent lane's row, or `None` for the trunk.
    pub from: Option<usize>,
    /// The lane's row.
    pub to: usize,
}

/// A landed lane's arc above the trunk.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Arc {
    /// The landed lane's index in the landed list.
    pub index: usize,
    /// Where it forked (0 when left of the window).
    pub from: u16,
    /// Its squash commit's column.
    pub to: u16,
    /// Its row above the trunk, 0 nearest.
    pub row: usize,
    /// It overlaps another arc without nesting, so it is drawn dim.
    pub crossing: bool,
    /// The trunk commit it landed as.
    pub oid: Oid,
}

/// The whole map.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Scene {
    /// Map columns.
    pub cols: u16,
    /// Trunk columns, left to right.
    pub trunk: Vec<TrunkCell>,
    /// The trunk has commits left of the window.
    pub trunk_left: bool,
    /// Every lane's row, in order (visible or not).
    pub lanes: Vec<LaneRow>,
    /// Fork lines.
    pub drops: Vec<Drop>,
    /// Landed arcs that fit.
    pub arcs: Vec<Arc>,
    /// Arc rows used.
    pub arc_rows: usize,
    /// Landed arcs that did not fit.
    pub hidden_arcs: usize,
    /// The first and one past the last lane row shown.
    pub visible: (usize, usize),
}

/// Columns for times in a viewport.
struct Columns {
    cols: u16,
    col_secs: i64,
    now: Timestamp,
}

impl Columns {
    /// The column of `at`; `None` left of the window. The future is now.
    fn of(&self, at: Timestamp) -> Option<u16> {
        let last = i64::from(self.cols.saturating_sub(1));
        let back = (self.now - at).num_seconds().max(0) / self.col_secs.max(1);
        u16::try_from(last - back).ok()
    }
}

/// Lays out `lanes` (in drawing order) and `landed` (lanes whose pull
/// request landed) of `graph` in `viewport`. `ours` are pull request
/// numbers of ours that merged, so their trunk commits show as landed.
pub fn layout(
    graph: &RepoGraph,
    lanes: &[&Lane],
    landed: &[&Lane],
    ours: &HashSet<u32>,
    viewport: Viewport,
) -> Scene {
    let columns = Columns {
        cols: viewport.cols,
        col_secs: viewport.col_secs,
        now: viewport.now,
    };
    let cols = usize::from(viewport.cols);
    let mut scene = Scene {
        cols: viewport.cols,
        trunk: vec![TrunkCell::default(); cols],
        ..Scene::default()
    };

    // The trunk, bucketed.
    let landed_oids: HashSet<&Oid> = landed
        .iter()
        .filter_map(|lane| lane.landed.as_ref())
        .collect();
    let mut trunk_cols: HashMap<&Oid, u16> = HashMap::new();
    for commit in graph.trunk.commits.iter().rev() {
        let Some(col) = columns.of(commit.at) else {
            scene.trunk_left = true;
            continue;
        };
        trunk_cols.insert(&commit.oid, col);
        if let Some(cell) = scene.trunk.get_mut(usize::from(col)) {
            cell.commits = cell.commits.saturating_add(1);
            cell.oid = Some(commit.oid.clone());
            if landed_oids.contains(&commit.oid) || commit.pr.is_some_and(|pr| ours.contains(&pr)) {
                cell.landed = true;
            }
        }
    }

    // Lanes.
    let index_of: HashMap<&str, usize> = lanes
        .iter()
        .enumerate()
        .map(|(index, lane)| (lane.branch.as_str(), index))
        .collect();
    for (index, lane) in lanes.iter().enumerate() {
        let parent = match &lane.base {
            LaneBase::Lane { branch, oid } => index_of
                .get(branch.as_str())
                .copied()
                .filter(|parent| *parent < index)
                .map(|parent| (parent, oid)),
            LaneBase::Trunk { .. } => None,
        };
        let start = match parent {
            Some((parent, oid)) => {
                let parent_lane = lanes.get(parent);
                let at = parent_lane
                    .and_then(|lane| lane.commits.iter().find(|commit| commit.oid == *oid))
                    .or_else(|| parent_lane.and_then(|lane| lane.tip()))
                    .map(|commit| commit.at)
                    .or_else(|| fork_time(lane));
                at.and_then(|at| columns.of(at))
            }
            None => fork_time(lane).and_then(|at| columns.of(at)),
        };
        let unpushed = unpushed(lane);
        let mut stations: Vec<Station> = Vec::new();
        let mut left = 0;
        for (position, commit) in lane.commits.iter().enumerate().rev() {
            let Some(col) = columns.of(commit.at) else {
                left += 1;
                continue;
            };
            let pushed = position >= unpushed;
            match stations.last_mut() {
                Some(station) if station.col == col => {
                    station.commits = station.commits.saturating_add(1);
                    station.oid = commit.oid.clone();
                    station.pushed &= pushed;
                }
                _ => stations.push(Station {
                    col,
                    commits: 1,
                    oid: commit.oid.clone(),
                    pushed,
                }),
            }
        }
        let tip = stations
            .last()
            .map(|station| station.col)
            .or(start)
            .unwrap_or(0);
        // A fork can never sit right of the lane's first commit.
        let start = match (start, stations.first()) {
            (Some(start), Some(first)) => Some(start.min(first.col)),
            (start, _) => start,
        };
        let row = index;
        if let Some(col) = start {
            match parent {
                Some((parent, _)) => scene.drops.push(Drop {
                    col,
                    from: Some(parent),
                    to: row,
                }),
                None => {
                    if let Some(cell) = scene.trunk.get_mut(usize::from(col)) {
                        cell.fork_down = true;
                    }
                    scene.drops.push(Drop {
                        col,
                        from: None,
                        to: row,
                    });
                }
            }
        }
        scene.lanes.push(LaneRow {
            index,
            row,
            start,
            stations,
            tip,
            left,
        });
    }

    // Arcs, narrowest first so nested ones sit nearer the trunk.
    let mut spans: Vec<(usize, u16, u16, Oid)> = landed
        .iter()
        .enumerate()
        .filter_map(|(index, lane)| {
            let oid = lane.landed.as_ref()?;
            let to = *trunk_cols.get(oid)?;
            let from = fork_time(lane)
                .and_then(|at| columns.of(at))
                .unwrap_or(0)
                .min(to);
            Some((index, from, to, oid.clone()))
        })
        .collect();
    spans.sort_by_key(|(index, from, to, _)| (to - from, *index));
    let rows_allowed = usize::from(viewport.arc_rows).min(MAX_ARC_ROWS);
    let mut placed: Vec<Arc> = Vec::new();
    for (index, from, to, oid) in spans {
        let nested_below = placed
            .iter()
            .filter(|arc| from <= arc.from && arc.to <= to)
            .map(|arc| arc.row + 1)
            .max()
            .unwrap_or(0);
        let row = (nested_below..rows_allowed).find(|row| {
            placed
                .iter()
                .filter(|arc| arc.row == *row)
                .all(|arc| arc.to + 1 < from || to + 1 < arc.from)
        });
        let Some(row) = row else {
            scene.hidden_arcs += 1;
            continue;
        };
        let crossing = placed.iter().any(|arc| {
            let overlap = arc.from <= to && from <= arc.to;
            let nests = (from <= arc.from && arc.to <= to) || (arc.from <= from && to <= arc.to);
            overlap && !nests
        });
        if let Some(cell) = scene.trunk.get_mut(usize::from(from)) {
            cell.arc_up = true;
        }
        if let Some(cell) = scene.trunk.get_mut(usize::from(to)) {
            cell.arc_up = true;
        }
        placed.push(Arc {
            index,
            from,
            to,
            row,
            crossing,
            oid,
        });
    }
    scene.arc_rows = placed.iter().map(|arc| arc.row + 1).max().unwrap_or(0);
    scene.arcs = placed;

    let rows = usize::from(viewport.rows);
    let first = viewport.scroll.min(lanes.len().saturating_sub(rows.max(1)));
    scene.visible = (first, (first + rows).min(lanes.len()));
    scene
}

/// How many of a lane's newest commits are not pushed: those above
/// `pushed`; every commit when nothing was pushed, or when the pushed
/// commit is not in the lane's history at all (amended or rebased locally
/// and not force-pushed yet). When commits are elided the pushed commit
/// may be among them, so none count.
pub fn unpushed(lane: &Lane) -> usize {
    match &lane.pushed {
        None => lane.commits.len(),
        Some(pushed) => lane
            .commits
            .iter()
            .position(|commit| commit.oid == *pushed)
            .unwrap_or(if lane.elided == 0 {
                lane.commits.len()
            } else {
                0
            }),
    }
}

/// The scroll that keeps `cursor` (a lane row) in view of `rows` rows.
pub fn scroll_for(cursor: Option<usize>, current: usize, rows: usize) -> usize {
    let Some(cursor) = cursor else {
        return current;
    };
    if rows == 0 {
        return cursor;
    }
    if cursor < current {
        cursor
    } else if cursor >= current + rows {
        cursor + 1 - rows
    } else {
        current
    }
}
