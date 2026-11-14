//! The viewer's whole state: the mirrored [`ViewState`], the key machine's
//! mode, the page stack, cursors and filters, and how actions change them.

use std::collections::HashSet;

use tui_tree_widget::TreeState;

use agent_monitor::domain::model::AgentId;

use crate::keys::{self, Action, Key, Mode, Motion, Page, Pane};
use crate::view::{Filter, ViewState};

/// Rows a page-up or page-down moves.
const PAGE_ROWS: usize = 10;

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
            quit: false,
        }
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
        (body_visible && self.view.body.animating()) || self.view.any_working()
    }

    /// Handles one key.
    pub fn key(&mut self, key: Key) {
        let mode = std::mem::take(&mut self.mode);
        let page = self.page().clone();
        let (mode, action) = keys::step(mode, key, &page);
        self.mode = mode;
        self.message = None;
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
                self.filter.words = command.filter;
                self.open(command.page);
            }
            Action::Unknown(line) => {
                self.message = Some(format!("UNKNOWN COMMAND: {line}"));
            }
            Action::Find(query) => self.filter.find = query.to_lowercase(),
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
