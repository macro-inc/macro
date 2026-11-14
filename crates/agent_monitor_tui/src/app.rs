//! The viewer's whole state: the mirrored [`ViewState`], the key machine's
//! mode, the page stack, cursors and filters, and how actions change them.

#[cfg(test)]
mod test;

use std::collections::HashSet;

use tui_tree_widget::TreeState;

use agent_monitor::domain::model::{AgentId, Oid, PrId, RepoGraph, RepoId};

use crate::keys::{self, Action, ChangeKey, Key, Mode, Motion, Page, Pane};
use crate::theme::ThemeName;
use crate::view::{Filter, LaneSort, ViewState};

/// Rows a page-up or page-down moves.
const PAGE_ROWS: usize = 10;

/// Columns `<` and `>` pan the CHANGES map.
const PAN_COLUMNS: u32 = 16;

/// Cursor positions, each kept by identity where rows can reorder.
#[derive(Debug, Default)]
pub struct Cursors {
    /// The selected agent in AGENTS; `None` is the first row.
    pub agent: Option<AgentId>,
    /// The tape line under the cursor; `None` follows the newest line.
    pub tape: Option<u64>,
    /// The selected FAILURES row.
    pub failure: usize,
    /// The selected SOURCES row.
    pub source: usize,
    /// The selected SPEND row.
    pub spend: usize,
    /// The tree page's selection and open nodes.
    pub tree: TreeState<String>,
    /// Tree nodes already opened once, so a closed node stays closed.
    pub tree_seen: HashSet<String>,
    /// The selected wall card.
    pub wall: usize,
    /// Cards per row on the wall at the last draw.
    pub wall_columns: usize,
    /// The drill-in transcript row under the cursor; `None` follows the newest.
    pub transcript: Option<usize>,
    /// Tool calls expanded in the transcript, by tool id.
    pub expanded: HashSet<String>,
    /// The selected drill-in child.
    pub child: usize,
    /// The selected pull request in the drill-in.
    pub agent_pr: usize,
    /// The CHANGES page's repository, rows, zoom and toggles.
    pub changes: ChangesCursor,
}

/// A row of the CHANGES page.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ChangeRow {
    /// The trunk.
    Trunk,
    /// A lane, by branch.
    Lane(String),
    /// A pull request with no lane, by id.
    Pr(PrId),
}

/// Time buckets one column of the CHANGES map can stand for, in seconds.
pub const SCALES: [i64; 6] = [60, 5 * 60, 15 * 60, 3_600, 4 * 3_600, 86_400];

/// Where the CHANGES page is: kept by identity so it survives new lanes.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ChangesCursor {
    /// The repository shown; `None` is the first tab.
    pub repo: Option<RepoId>,
    /// The row under the cursor; `None` is the first lane.
    pub row: Option<ChangeRow>,
    /// The commit under the cursor on that row; `None` is its tip.
    pub commit: Option<Oid>,
    /// The time scale chosen with `+`/`-` (an index into [`SCALES`]);
    /// `None` picks one that fits.
    pub zoom: Option<usize>,
    /// The scale the last frame drew, so `+`/`-` step from it.
    pub drawn_zoom: usize,
    /// Columns the map is panned back from now.
    pub pan: u32,
    /// The first list row the last frame showed.
    pub scroll: usize,
    /// Landed lanes are hidden.
    pub hide_landed: bool,
    /// Lane order.
    pub sort: LaneSort,
    /// The agent under the cursor on a lane's page.
    pub lane_agent: usize,
}

/// Everything the viewer draws from.
pub struct App {
    /// The mirrored collector state.
    pub view: ViewState,
    /// The key machine's mode.
    pub mode: Mode,
    /// Pages opened, the current one last; never empty.
    pub pages: Vec<Page>,
    /// Row filtering.
    pub filter: Filter,
    /// Cursors.
    pub cursors: Cursors,
    /// A one-line note for the command line, such as an unknown command.
    pub message: Option<String>,
    /// A label for the header, such as `DEMO`.
    pub label: Option<String>,
    /// The colour theme frames are drawn in.
    pub theme: ThemeName,
    /// Whether the command line names the theme, after Ctrl-T or `THEME`
    /// switched it,
    /// until the next key.
    pub theme_notice: bool,
    /// Set when the user quits.
    pub quit: bool,
}

impl App {
    /// A viewer on the monitor page.
    pub fn new(view: ViewState, label: Option<String>) -> Self {
        Self {
            view,
            mode: Mode::default(),
            pages: vec![Page::Monitor],
            filter: Filter::default(),
            cursors: Cursors::default(),
            message: None,
            label,
            theme: ThemeName::default(),
            theme_notice: false,
            quit: false,
        }
    }

    /// Draws in `theme`, the BODY figure too.
    pub fn set_theme(&mut self, theme: ThemeName) {
        self.theme = theme;
        self.view.body.set_theme(theme.theme());
        self.view.dirty = true;
    }

    /// The current page.
    pub fn page(&self) -> &Page {
        self.pages.last().unwrap_or(&Page::Monitor)
    }

    /// The agent whose transcript should be followed now.
    pub fn transcript_target(&self) -> Option<&AgentId> {
        match self.page() {
            Page::Agent(id) => Some(id),
            _ => None,
        }
    }

    /// Whether anything on screen moves without new data.
    pub fn animating(&self) -> bool {
        let body_visible = matches!(self.page(), Page::Monitor | Page::Zoom(Pane::Body));
        (body_visible && self.view.body.animating())
            || self.view.any_working()
            || (*self.page() == Page::Zoom(Pane::Changes) && !self.view.fresh.is_empty())
    }

    /// Handles one key.
    pub fn key(&mut self, key: Key) {
        let mode = std::mem::take(&mut self.mode);
        let page = self.page().clone();
        let (mode, action) = keys::step(mode, key, &page);
        self.mode = mode;
        self.message = None;
        self.theme_notice = false;
        self.act(action);
        self.view.dirty = true;
    }

    fn act(&mut self, action: Action) {
        match action {
            Action::None => {}
            Action::Quit => self.quit = true,
            Action::Open(page) => self.open(page),
            Action::Back => {
                if self.pages.len() > 1 {
                    self.pages.pop();
                }
            }
            Action::Move(pane, motion) => self.move_cursor(pane, motion),
            Action::Activate(pane) => self.activate(pane),
            Action::Run(command) => {
                // `all` among the words lists ended agents too.
                let (all, words): (Vec<String>, Vec<String>) =
                    command.filter.into_iter().partition(|word| word == "all");
                self.filter.all = !all.is_empty();
                self.filter.words = words;
                self.open(command.page);
            }
            Action::ToggleAll => self.filter.all = !self.filter.all,
            Action::Theme(theme) => {
                self.set_theme(theme.unwrap_or_else(|| self.theme.next()));
                self.theme_notice = true;
            }
            Action::UnknownTheme(name) => {
                use strum::IntoEnumIterator as _;
                let known: Vec<String> = ThemeName::iter().map(|name| name.to_string()).collect();
                self.message = Some(format!("UNKNOWN THEME: {name} ({})", known.join(", ")));
            }
            Action::Unknown(line) => {
                self.message = Some(format!("UNKNOWN COMMAND: {line}"));
            }
            Action::Find(query) => self.filter.find = query.to_lowercase(),
            Action::Changes(change) => self.change(change),
        }
    }

    /// The repository the CHANGES page shows.
    pub fn change_repo(&self) -> Option<&RepoGraph> {
        let tabs = self.view.repo_tabs();
        self.cursors
            .changes
            .repo
            .as_ref()
            .and_then(|id| tabs.iter().find(|graph| graph.id == *id).copied())
            .or_else(|| tabs.first().copied())
    }

    /// The CHANGES page's rows: the trunk, the lanes in order, then pull
    /// requests with no lane.
    pub fn change_rows(&self) -> Vec<ChangeRow> {
        let Some(graph) = self.change_repo() else {
            return self
                .view
                .unmapped_prs(&self.filter)
                .into_iter()
                .map(|pr| ChangeRow::Pr(pr.id.clone()))
                .collect();
        };
        let cursor = &self.cursors.changes;
        let mut rows = vec![ChangeRow::Trunk];
        rows.extend(
            self.view
                .sorted_lanes(graph, &self.filter, cursor.sort)
                .into_iter()
                .map(|lane| ChangeRow::Lane(lane.branch.clone())),
        );
        rows.extend(
            self.view
                .orphan_prs(graph, &self.filter)
                .into_iter()
                .map(|pr| ChangeRow::Pr(pr.id.clone())),
        );
        rows
    }

    /// The row under the CHANGES cursor: the chosen one while it exists,
    /// else the first lane.
    pub fn change_row(&self) -> Option<ChangeRow> {
        let rows = self.change_rows();
        let chosen = self
            .cursors
            .changes
            .row
            .as_ref()
            .filter(|row| rows.contains(row))
            .cloned();
        chosen.or_else(|| rows.get(1).or(rows.first()).cloned())
    }

    fn change(&mut self, change: ChangeKey) {
        let cursor = &mut self.cursors.changes;
        match change {
            ChangeKey::ZoomIn => {
                cursor.zoom = Some(cursor.drawn_zoom.saturating_sub(1));
            }
            ChangeKey::ZoomOut => {
                cursor.zoom = Some((cursor.drawn_zoom + 1).min(SCALES.len() - 1));
            }
            ChangeKey::Earlier => cursor.pan = cursor.pan.saturating_add(PAN_COLUMNS),
            ChangeKey::Later => cursor.pan = cursor.pan.saturating_sub(PAN_COLUMNS),
            ChangeKey::Now => cursor.pan = 0,
            ChangeKey::ToggleLanded => cursor.hide_landed = !cursor.hide_landed,
            ChangeKey::Sort => {
                cursor.sort = match cursor.sort {
                    LaneSort::Fork => LaneSort::Attention,
                    LaneSort::Attention => LaneSort::Fork,
                };
            }
            ChangeKey::PrevRepo | ChangeKey::NextRepo => {
                let ids: Vec<RepoId> = self
                    .view
                    .repo_tabs()
                    .iter()
                    .map(|graph| graph.id.clone())
                    .collect();
                let current = self
                    .change_repo()
                    .and_then(|graph| ids.iter().position(|id| *id == graph.id))
                    .unwrap_or(0);
                let next = if change == ChangeKey::NextRepo {
                    (current + 1) % ids.len().max(1)
                } else {
                    (current + ids.len().max(1) - 1) % ids.len().max(1)
                };
                let cursor = &mut self.cursors.changes;
                cursor.repo = ids.get(next).cloned();
                cursor.row = None;
                cursor.commit = None;
            }
            ChangeKey::NextAttention | ChangeKey::PrevAttention => {
                self.jump_to_attention(change == ChangeKey::NextAttention);
            }
            ChangeKey::OpenLane => {
                if let (Some(graph), Some(ChangeRow::Lane(branch))) =
                    (self.change_repo(), self.change_row())
                {
                    let page = Page::Lane(graph.id.clone(), branch);
                    self.open(page);
                }
            }
        }
    }

    /// Moves the CHANGES cursor to the next (or previous) lane that wants a
    /// look, wrapping around.
    fn jump_to_attention(&mut self, forward: bool) {
        let rows = self.change_rows();
        let Some(graph) = self.change_repo() else {
            return;
        };
        let wants: Vec<bool> = rows
            .iter()
            .map(|row| match row {
                ChangeRow::Lane(branch) => graph
                    .lanes
                    .iter()
                    .find(|lane| lane.branch == *branch)
                    .is_some_and(|lane| self.view.attention(lane).is_some()),
                ChangeRow::Trunk | ChangeRow::Pr(_) => false,
            })
            .collect();
        let current = self
            .change_row()
            .and_then(|row| rows.iter().position(|candidate| *candidate == row))
            .unwrap_or(0);
        let len = rows.len();
        let found = (1..=len)
            .map(|step| {
                if forward {
                    (current + step) % len
                } else {
                    (current + len - step % len) % len
                }
            })
            .find(|index| wants.get(*index).copied().unwrap_or(false));
        if let Some(index) = found {
            self.cursors.changes.row = rows.get(index).cloned();
            self.cursors.changes.commit = None;
        }
    }

    fn move_change(&mut self, motion: Motion) {
        match motion {
            Motion::Left | Motion::Right => self.move_change_commit(motion == Motion::Left),
            _ => {
                let rows = self.change_rows();
                let current = self
                    .change_row()
                    .and_then(|row| rows.iter().position(|candidate| *candidate == row))
                    .unwrap_or(0);
                let next = moved(current, rows.len(), motion);
                if rows.get(next) != rows.get(current) {
                    self.cursors.changes.commit = None;
                }
                self.cursors.changes.row = rows.get(next).cloned();
            }
        }
    }

    /// Moves the commit cursor along the selected row: left is older.
    fn move_change_commit(&mut self, older: bool) {
        let Some(graph) = self.change_repo() else {
            return;
        };
        let commits: Vec<Oid> = match self.change_row() {
            Some(ChangeRow::Lane(branch)) => graph
                .lanes
                .iter()
                .find(|lane| lane.branch == branch)
                .map(|lane| {
                    lane.commits
                        .iter()
                        .map(|commit| commit.oid.clone())
                        .collect()
                })
                .unwrap_or_default(),
            Some(ChangeRow::Trunk) => graph
                .trunk
                .commits
                .iter()
                .map(|commit| commit.oid.clone())
                .collect(),
            Some(ChangeRow::Pr(_)) | None => Vec::new(),
        };
        if commits.is_empty() {
            return;
        }
        // Newest first: older is a higher index.
        let current = self
            .cursors
            .changes
            .commit
            .as_ref()
            .and_then(|oid| commits.iter().position(|candidate| candidate == oid))
            .unwrap_or(0);
        let next = if older {
            (current + 1).min(commits.len() - 1)
        } else {
            current.saturating_sub(1)
        };
        self.cursors.changes.commit = if next == 0 {
            None
        } else {
            commits.get(next).cloned()
        };
    }

    /// The agent the CHANGES row under the cursor opens, or its lane page.
    fn activate_change(&mut self) -> Option<AgentId> {
        let graph = self.change_repo()?;
        match self.change_row()? {
            ChangeRow::Lane(branch) => {
                let lane = graph.lanes.iter().find(|lane| lane.branch == branch)?;
                match self.view.lane_agent(lane) {
                    Some(agent) => Some(agent.id.clone()),
                    None => {
                        let page = Page::Lane(graph.id.clone(), branch);
                        self.open(page);
                        None
                    }
                }
            }
            ChangeRow::Pr(id) => self
                .view
                .prs
                .get(&id)
                .and_then(|pr| ViewState::pr_agent(pr).cloned()),
            ChangeRow::Trunk => graph.trunk_agents.first().cloned(),
        }
    }

    fn open(&mut self, page: Page) {
        if page == Page::Monitor {
            self.pages = vec![Page::Monitor];
            return;
        }
        if *self.page() == page {
            return;
        }
        if let Page::Agent(_) = page {
            self.cursors.transcript = None;
            self.cursors.child = 0;
            self.cursors.agent_pr = 0;
        }
        if let Page::Lane(..) = page {
            self.cursors.changes.lane_agent = 0;
        }
        self.pages.push(page);
    }

    fn move_cursor(&mut self, pane: Option<Pane>, motion: Motion) {
        match (pane, self.page()) {
            (Some(Pane::Agents), _) => self.move_agent(motion),
            (Some(Pane::Tape), _) => self.move_tape(motion),
            (Some(Pane::Failures), _) => {
                let len = self.view.failures(&self.filter).len();
                self.cursors.failure = moved(self.cursors.failure, len, motion);
            }
            (Some(Pane::Sources), _) => {
                let len = self.view.source_rows().len();
                self.cursors.source = moved(self.cursors.source, len, motion);
            }
            (Some(Pane::Spend), _) => {
                let len = self.view.spend_by_kind().len();
                self.cursors.spend = moved(self.cursors.spend, len, motion);
            }
            (Some(Pane::Body), _) => {}
            (Some(Pane::Changes), _) => self.move_change(motion),
            (Some(Pane::AgentPrs), Page::Agent(id)) => {
                let len = self.view.agents.get(id).map_or(0, |agent| agent.prs.len());
                self.cursors.agent_pr = moved(self.cursors.agent_pr, len, motion);
            }
            (Some(Pane::AgentPrs), _) => {}
            (Some(Pane::Transcript), _) => self.move_transcript(motion),
            (Some(Pane::Children), Page::Agent(id)) => {
                let len = self
                    .view
                    .agents
                    .get(id)
                    .map_or(0, |agent| agent.children.len());
                self.cursors.child = moved(self.cursors.child, len, motion);
            }
            (Some(Pane::Children), _) => {}
            (None, Page::Tree) => self.move_tree(motion),
            (None, Page::Wall) => self.move_wall(motion),
            (None, Page::Lane(repo, branch)) => {
                let len = self
                    .view
                    .repos
                    .get(repo)
                    .and_then(|graph| graph.lanes.iter().find(|lane| lane.branch == *branch))
                    .map_or(0, |lane| lane.agents.len());
                self.cursors.changes.lane_agent =
                    moved(self.cursors.changes.lane_agent, len, motion);
            }
            (None, _) => {}
        }
    }

    fn move_agent(&mut self, motion: Motion) {
        let agents = self.view.sorted_agents(&self.filter);
        let current = self
            .cursors
            .agent
            .as_ref()
            .and_then(|id| agents.iter().position(|agent| agent.id == *id))
            .unwrap_or(0);
        let next = moved(current, agents.len(), motion);
        self.cursors.agent = agents.get(next).map(|agent| agent.id.clone());
    }

    fn move_tape(&mut self, motion: Motion) {
        let seqs: Vec<u64> = self
            .view
            .tape_newest_first(&self.filter)
            .map(|event| event.seq)
            .collect();
        let current = self
            .cursors
            .tape
            .and_then(|seq| seqs.iter().position(|candidate| *candidate == seq))
            .unwrap_or(0);
        let next = moved(current, seqs.len(), motion);

        // The newest row follows new lines; any other row stays put.
        self.cursors.tape = if next == 0 {
            None
        } else {
            seqs.get(next).copied()
        };
    }

    fn move_transcript(&mut self, motion: Motion) {
        let len = self
            .view
            .transcript
            .as_ref()
            .map_or(0, |transcript| transcript.items.len());
        if len == 0 {
            return;
        }

        let last = len - 1;
        let current = self.cursors.transcript.unwrap_or(last);
        let next = moved(current, len, motion);
        self.cursors.transcript = if next == last { None } else { Some(next) };
    }

    fn move_tree(&mut self, motion: Motion) {
        let tree = &mut self.cursors.tree;
        match motion {
            Motion::Up => tree.key_up(),
            Motion::Down => tree.key_down(),
            Motion::Left => tree.key_left(),
            Motion::Right => tree.key_right(),
            Motion::Top => tree.select_first(),
            Motion::Bottom => tree.select_last(),
            Motion::PageUp => tree.select_relative(|current| {
                current.map_or(0, |index| index.saturating_sub(PAGE_ROWS))
            }),
            Motion::PageDown => {
                tree.select_relative(|current| current.map_or(0, |index| index + PAGE_ROWS))
            }
        };
    }

    fn move_wall(&mut self, motion: Motion) {
        let len = self.view.sorted_agents(&self.filter).len();
        if len == 0 {
            return;
        }

        let columns = self.cursors.wall_columns.max(1);
        let wall = self.cursors.wall.min(len - 1);
        self.cursors.wall = match motion {
            Motion::Left => wall.saturating_sub(1),
            Motion::Right => (wall + 1).min(len - 1),
            Motion::Up => wall.saturating_sub(columns),
            Motion::Down => (wall + columns).min(len - 1),
            Motion::PageUp | Motion::PageDown | Motion::Top | Motion::Bottom => {
                moved(wall, len, motion)
            }
        };
    }

    fn activate(&mut self, pane: Option<Pane>) {
        let target = match (pane, self.page()) {
            (Some(Pane::Agents), _) => self.selected_agent(),
            (Some(Pane::Tape), _) => self
                .view
                .tape_newest_first(&self.filter)
                .find(|event| self.cursors.tape.is_none_or(|seq| event.seq == seq))
                .map(|event| event.agent.clone()),
            (Some(Pane::Failures), _) => self
                .view
                .failures(&self.filter)
                .get(self.cursors.failure)
                .map(|row| row.agent.clone()),
            (Some(Pane::Children), Page::Agent(id)) => self
                .view
                .agents
                .get(id)
                .and_then(|agent| agent.children.get(self.cursors.child).cloned()),
            (Some(Pane::Changes), _) => self.activate_change(),
            // Another agent tied to the pull request: its author when this
            // agent is not, else the next tied agent.
            (Some(Pane::AgentPrs), Page::Agent(id)) => {
                let id = id.clone();
                self.view
                    .agents
                    .get(&id)
                    .and_then(|agent| agent.prs.get(self.cursors.agent_pr))
                    .and_then(|pr| self.view.prs.get(pr))
                    .and_then(|pr| pr.agents.iter().find(|other| **other != id).cloned())
            }
            (Some(Pane::Transcript), _) => {
                self.toggle_expanded();
                None
            }
            (None, Page::Tree) => self
                .cursors
                .tree
                .selected()
                .last()
                .map(|id| AgentId::from_wire(id.clone())),
            (None, Page::Wall) => self
                .view
                .sorted_agents(&self.filter)
                .get(self.cursors.wall)
                .map(|agent| agent.id.clone()),
            (None, Page::Lane(repo, branch)) => self
                .view
                .repos
                .get(repo)
                .and_then(|graph| graph.lanes.iter().find(|lane| lane.branch == *branch))
                .and_then(|lane| lane.agents.get(self.cursors.changes.lane_agent).cloned()),
            _ => None,
        };

        if let Some(id) = target {
            self.open(Page::Agent(id));
        }
    }

    /// The agent under the AGENTS cursor.
    pub fn selected_agent(&self) -> Option<AgentId> {
        let agents = self.view.sorted_agents(&self.filter);
        let selected = self
            .cursors
            .agent
            .as_ref()
            .and_then(|id| agents.iter().find(|agent| agent.id == *id))
            .or(agents.first());
        selected.map(|agent| agent.id.clone())
    }

    fn toggle_expanded(&mut self) {
        let Some(transcript) = self.view.transcript.as_ref() else {
            return;
        };
        let last = transcript.items.len().saturating_sub(1);
        let index = self.cursors.transcript.unwrap_or(last);
        let Some(tool_id) = transcript
            .items
            .get(index)
            .and_then(|item| item.tool_id.clone())
        else {
            return;
        };
        if !self.cursors.expanded.remove(&tool_id) {
            self.cursors.expanded.insert(tool_id);
        }
    }
}

/// A cursor index after `motion` over `len` rows.
fn moved(current: usize, len: usize, motion: Motion) -> usize {
    if len == 0 {
        return 0;
    }

    let last = len - 1;
    match motion {
        Motion::Up | Motion::Left => current.saturating_sub(1),
        Motion::Down | Motion::Right => (current + 1).min(last),
        Motion::PageUp => current.saturating_sub(PAGE_ROWS),
        Motion::PageDown => (current + PAGE_ROWS).min(last),
        Motion::Top => 0,
        Motion::Bottom => last,
    }
}
