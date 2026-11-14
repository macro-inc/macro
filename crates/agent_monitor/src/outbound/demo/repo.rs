//! The demo fleet's repository: a trunk with two days of squash merges and
//! lanes for the demo's agents and pull requests (a stack, a landed branch,
//! a parked stub, a fork older than the window), whose working agents keep
//! committing on the demo clock.

use std::path::PathBuf;

use chrono::TimeDelta;

use crate::domain::model::{
    Commit, Lane, LaneBase, LocalTrunk, Oid, RepoGraph, RepoId, RepoName, Timestamp, Trunk,
};

/// The trunk carries a commit about this often over the window.
const TRUNK_EVERY_MINUTES: i64 = 37;

/// First-parent trunk commits the demo carries.
const TRUNK_COMMITS: usize = 72;

/// A lane gets a commit every this many steps, round-robin over the lanes
/// whose agent keeps working.
pub const COMMIT_EVERY_STEPS: u64 = 40;

/// The trunk moves every this many steps.
pub const TRUNK_EVERY_STEPS: u64 = 170;

const SUBJECTS: &[&str] = &[
    "fix(search): keep the cursor when results refresh",
    "feat(calendar): show the week's travel time",
    "chore(deps): bump the TLS stack",
    "fix(editor): paste lists without doubling bullets",
    "feat(billing): prorate seat changes mid-cycle",
    "refactor(auth): one session store for web and desktop",
    "fix(sync): retry a dropped websocket with backoff",
    "docs(api): document pagination cursors",
    "perf(feed): batch avatar lookups",
    "feat(channels): pin a message to the header",
    "test(email): snapshot the digest renderer",
    "fix(desktop): restore the window on the right display",
];

/// One scripted lane.
struct LaneScript {
    branch: &'static str,
    /// Minutes before the start it forks from the trunk (for a stacked
    /// lane, when its first commit starts).
    fork_minutes: Option<i64>,
    stack_on: Option<&'static str>,
    /// Commits it starts with, spread from its fork to `last_minutes`.
    commits: usize,
    last_minutes: i64,
    /// Commits at the top not yet pushed.
    unpushed: usize,
    /// It keeps getting commits while the demo runs.
    active: bool,
    /// How far behind the trunk it is when its fork is outside the window.
    behind: Option<u32>,
    subjects: &'static [&'static str],
}

const LANES: &[LaneScript] = &[
    LaneScript {
        branch: "feat/rpc-server",
        fork_minutes: Some(190),
        stack_on: None,
        commits: 7,
        last_minutes: 3,
        unpushed: 1,
        active: true,
        behind: None,
        subjects: &[
            "feat(monitor): socket server skeleton",
            "feat(monitor): user-only socket permissions",
            "feat(monitor): stream snapshots then deltas",
            "test(monitor): subscribe over a real socket",
            "fix(monitor): re-snapshot a lagging subscriber",
            "feat(monitor): heartbeat every five seconds",
            "fix(monitor): address review",
        ],
    },
    LaneScript {
        branch: "feat/store-reducer",
        fork_minutes: Some(360),
        stack_on: None,
        commits: 5,
        last_minutes: 50,
        unpushed: 0,
        active: false,
        behind: None,
        subjects: &[
            "feat(monitor): facts filed by key",
            "feat(monitor): single-writer reducer",
            "feat(monitor): coalesce bursts into one publish",
            "test(monitor): paused-time store tests",
            "docs(monitor): the store's subscribe rules",
        ],
    },
    LaneScript {
        branch: "feat/ui-pages",
        // Its commits start after its base's tip, 50 minutes before the start.
        fork_minutes: Some(44),
        stack_on: Some("feat/store-reducer"),
        commits: 4,
        last_minutes: 6,
        unpushed: 2,
        active: true,
        behind: None,
        subjects: &[
            "feat(viewer): page stack and zoom",
            "feat(viewer): drill-in transcript",
            "feat(viewer): command line mnemonics",
            "fix(viewer): keep the cursor on resize",
        ],
    },
    LaneScript {
        branch: "feat/invoice-export",
        fork_minutes: Some(20 * 60),
        stack_on: None,
        commits: 9,
        last_minutes: 70,
        unpushed: 0,
        active: false,
        behind: None,
        subjects: &[
            "feat(billing): invoice CSV columns",
            "feat(billing): stream large exports",
            "fix(billing): currency rounding",
            "test(billing): export fixtures",
            "feat(billing): export from the invoices list",
            "fix(billing): escape commas in memo",
            "refactor(billing): share the row formatter",
            "fix(billing): address review",
            "fix(billing): time zones in the date column",
        ],
    },
    LaneScript {
        branch: "chore/4188",
        fork_minutes: Some(26 * 60),
        stack_on: None,
        commits: 3,
        last_minutes: 22 * 60,
        unpushed: 0,
        active: false,
        behind: None,
        subjects: &[
            "chore(billing): drop the legacy exporter",
            "chore(billing): remove its flags",
            "test(billing): drop legacy fixtures",
        ],
    },
    LaneScript {
        branch: "feat/trace-gaps",
        fork_minutes: Some(75),
        stack_on: None,
        commits: 3,
        last_minutes: 9,
        unpushed: 3,
        active: true,
        behind: None,
        subjects: &[
            "fix(tracing): parent spawned tasks on their request",
            "fix(tracing): carry context over the queue",
            "test(tracing): one trace across the hop",
        ],
    },
    LaneScript {
        branch: "feat/mesh-plan",
        fork_minutes: Some(8 * 60),
        stack_on: None,
        commits: 0,
        last_minutes: 0,
        unpushed: 0,
        active: false,
        behind: None,
        subjects: &[],
    },
    LaneScript {
        branch: "eric/scratch-perf",
        fork_minutes: Some(11 * 60),
        stack_on: None,
        commits: 2,
        last_minutes: 10 * 60,
        unpushed: 2,
        active: false,
        behind: None,
        subjects: &["perf(feed): try a bigger page", "perf(feed): measure it"],
    },
    LaneScript {
        branch: "feat/search-ranking",
        fork_minutes: Some(5 * 60),
        stack_on: None,
        commits: 6,
        last_minutes: 25,
        unpushed: 0,
        active: false,
        behind: None,
        subjects: &[
            "feat(search): score by recency and owner",
            "feat(search): boost pinned documents",
            "test(search): ranking fixtures",
            "fix(search): ties sort by title",
            "perf(search): cache owner lookups",
            "docs(search): how ranking works",
        ],
    },
    LaneScript {
        branch: "sync/backoff-1",
        fork_minutes: Some(7 * 60),
        stack_on: None,
        commits: 3,
        last_minutes: 5 * 60,
        unpushed: 0,
        active: false,
        behind: None,
        subjects: &[
            "refactor(sync): one reconnect loop",
            "feat(sync): jittered backoff",
            "test(sync): backoff schedule",
        ],
    },
    LaneScript {
        branch: "sync/backoff-2",
        fork_minutes: Some(290),
        stack_on: Some("sync/backoff-1"),
        commits: 3,
        last_minutes: 3 * 60,
        unpushed: 0,
        active: false,
        behind: None,
        subjects: &[
            "feat(sync): resume from the last cursor",
            "fix(sync): drop stale acks",
            "test(sync): resume after a drop",
        ],
    },
    LaneScript {
        branch: "sync/backoff-3",
        fork_minutes: Some(170),
        stack_on: Some("sync/backoff-2"),
        commits: 2,
        last_minutes: 80,
        unpushed: 1,
        active: false,
        behind: None,
        subjects: &[
            "feat(sync): surface the retry in the status bar",
            "fix(sync): address review",
        ],
    },
    LaneScript {
        branch: "chore/deps-bump",
        fork_minutes: Some(150),
        stack_on: None,
        commits: 2,
        last_minutes: 120,
        unpushed: 0,
        active: false,
        behind: None,
        subjects: &[
            "chore(deps): bump the TLS stack",
            "chore(deps): refresh the lockfile",
        ],
    },
    LaneScript {
        branch: "feat/flaky-tests",
        fork_minutes: Some(9 * 24 * 60),
        stack_on: None,
        commits: 2,
        last_minutes: 30 * 60,
        unpushed: 0,
        active: false,
        behind: Some(204),
        subjects: &[
            "test(sync): retry the flaky reconnect test",
            "test(sync): quarantine the clock test",
        ],
    },
];

/// The pull request number the demo's merged PR squashed into the trunk as.
const LANDED_PR: u32 = 4188;

/// A deterministic object id for a lane (or the trunk, 0) and a commit number.
fn oid(lane: usize, number: usize) -> Oid {
    let mix = |value: u64| value.wrapping_mul(0x9E37_79B9_7F4A_7C15).rotate_left(17);
    let lane = u64::try_from(lane).unwrap_or(0);
    let number = u64::try_from(number).unwrap_or(0);
    let text = format!(
        "{:016x}{:016x}{:08x}",
        mix(lane * 1_000 + number + 1),
        mix(number * 7 + lane + 3),
        (lane << 20) | number
    );
    Oid::parse(&text).unwrap_or_default()
}

fn commit(oid: Oid, at: Timestamp, subject: &str, pr: Option<u32>) -> Commit {
    let subject = match pr {
        Some(number) => format!("{subject} (#{number})"),
        None => subject.to_owned(),
    };
    Commit {
        oid,
        at,
        author: String::from("demo"),
        subject,
        merge: false,
        pr,
    }
}

/// The demo repository as it evolves.
#[derive(Clone, Debug)]
pub struct DemoRepo {
    start: Timestamp,
    /// Trunk commits, newest first.
    trunk: Vec<Commit>,
    /// Each scripted lane's commits, newest first.
    lanes: Vec<Vec<Commit>>,
    next_active: usize,
}

impl DemoRepo {
    /// The repository as it stands at `start`.
    pub fn new(start: Timestamp) -> Self {
        let mut trunk = Vec::new();
        for number in 0..TRUNK_COMMITS {
            let minutes = i64::try_from(number).unwrap_or(0) * TRUNK_EVERY_MINUTES + 8;
            let at = start - TimeDelta::minutes(minutes);
            let subject = SUBJECTS
                .get(number % SUBJECTS.len())
                .copied()
                .unwrap_or("chore: tidy");
            let pr = 4_180 - u32::try_from(number).unwrap_or(0);
            trunk.push(commit(oid(0, number), at, subject, Some(pr)));
        }
        // The legacy exporter's squash, 20 minutes after it was opened 55
        // minutes before the start (the demo's merged pull request).
        trunk.push(commit(
            oid(0, 900),
            start - TimeDelta::minutes(35),
            "chore(billing): drop the legacy exporter",
            Some(LANDED_PR),
        ));
        trunk.sort_by(|a, b| b.at.cmp(&a.at));

        let lanes = LANES
            .iter()
            .enumerate()
            .map(|(index, script)| {
                let fork = start
                    - TimeDelta::minutes(script.fork_minutes.unwrap_or(script.last_minutes + 60));
                let last = start - TimeDelta::minutes(script.last_minutes);
                let span = (last - fork).num_seconds().max(60);
                let count = i64::try_from(script.commits).unwrap_or(1).max(1);
                (0..script.commits)
                    .rev()
                    .map(|number| {
                        let step = i64::try_from(number + 1).unwrap_or(1);
                        let at = fork + TimeDelta::seconds(span * step / count);
                        let subject = script.subjects.get(number).copied().unwrap_or("wip");
                        commit(oid(index + 1, number), at, subject, None)
                    })
                    .collect()
            })
            .collect();
        Self {
            start,
            trunk,
            lanes,
            next_active: 0,
        }
    }

    /// Moves the repository on at `step`: a commit on the next active lane,
    /// or on the trunk. Returns whether anything changed.
    pub fn step(&mut self, step: u64, now: Timestamp) -> bool {
        let mut changed = false;
        if step.is_multiple_of(COMMIT_EVERY_STEPS) {
            let active: Vec<usize> = LANES
                .iter()
                .enumerate()
                .filter(|(_, script)| script.active)
                .map(|(index, _)| index)
                .collect();
            if let Some(&index) = active.get(self.next_active % active.len().max(1)) {
                self.next_active += 1;
                if let Some(commits) = self.lanes.get_mut(index) {
                    let number = commits.len() + 100;
                    let subject = SUBJECTS
                        .get(number % SUBJECTS.len())
                        .copied()
                        .unwrap_or("wip");
                    commits.insert(0, commit(oid(index + 1, number), now, subject, None));
                    changed = true;
                }
            }
        }
        if step.is_multiple_of(TRUNK_EVERY_STEPS) {
            let number = self.trunk.len() + 1_000;
            let subject = SUBJECTS
                .get(number % SUBJECTS.len())
                .copied()
                .unwrap_or("chore: tidy");
            let pr = 4_216 + u32::try_from(step / TRUNK_EVERY_STEPS).unwrap_or(0);
            self.trunk
                .insert(0, commit(oid(0, number), now, subject, Some(pr)));
            changed = true;
        }
        changed
    }

    /// The trunk commit at or before `at`.
    fn trunk_at(&self, at: Timestamp) -> Option<&Commit> {
        self.trunk.iter().find(|commit| commit.at <= at)
    }

    /// The graph as the git source would report it, for the demo's agents in
    /// `/srv/work/<name>` on `feat/<name>`.
    pub fn graph(&self, repo: &RepoName) -> RepoGraph {
        let lanes = LANES
            .iter()
            .zip(&self.lanes)
            .map(|(script, commits)| self.lane(script, commits))
            .collect();
        RepoGraph {
            id: RepoId::from_wire(String::from("/srv/repo/.git")),
            name: repo.as_str().to_owned(),
            remote: Some(repo.clone()),
            trunk: Trunk {
                name: String::from("origin/main"),
                commits: self.trunk.clone(),
                local: Some(LocalTrunk {
                    name: String::from("main"),
                    ahead: 0,
                    behind: 37,
                }),
                fetched_at: Some(self.start - TimeDelta::minutes(4)),
                worktrees: vec![PathBuf::from("/srv/work/scratch-notes")],
            },
            lanes,
            hidden_lanes: 3,
            trunk_agents: Vec::new(),
        }
    }

    fn lane(&self, script: &LaneScript, commits: &[Commit]) -> Lane {
        let fork_at = self.start - TimeDelta::minutes(script.fork_minutes.unwrap_or(0));
        let base = match (script.stack_on, self.trunk_at(fork_at)) {
            (Some(below), _) => {
                let tip = LANES
                    .iter()
                    .position(|other| other.branch == below)
                    .and_then(|index| self.lanes.get(index))
                    .and_then(|commits| commits.first());
                LaneBase::Lane {
                    branch: below.to_owned(),
                    oid: tip.map_or_else(|| oid(0, 0), |tip| tip.oid.clone()),
                }
            }
            (None, Some(base)) if script.behind.is_none() => LaneBase::Trunk {
                oid: base.oid.clone(),
                at: base.at,
            },
            (None, _) => LaneBase::Trunk {
                oid: oid(0, 5_000),
                at: fork_at,
            },
        };
        let behind = script.behind.unwrap_or_else(|| {
            let since = match &base {
                LaneBase::Trunk { at, .. } => *at,
                LaneBase::Lane { .. } => fork_at,
            };
            u32::try_from(self.trunk.iter().filter(|commit| commit.at > since).count())
                .unwrap_or(u32::MAX)
        });
        let below = script
            .stack_on
            .and_then(|below| LANES.iter().position(|other| other.branch == below))
            .and_then(|index| self.lanes.get(index))
            .map_or(0, Vec::len);
        let own = u32::try_from(commits.len()).unwrap_or(u32::MAX);
        let worktree = script
            .branch
            .split_once('/')
            .filter(|(prefix, _)| *prefix == "feat")
            .map(|(_, name)| PathBuf::from(format!("/srv/work/{name}")));
        Lane {
            branch: script.branch.to_owned(),
            aliases: Vec::new(),
            base,
            ahead: own + u32::try_from(below).unwrap_or(0),
            behind,
            commits: commits.to_vec(),
            elided: 0,
            pushed: commits
                .get(script.unpushed)
                .map(|commit| commit.oid.clone()),
            worktree,
            agents: Vec::new(),
            pr: None,
            landed: None,
        }
    }
}
