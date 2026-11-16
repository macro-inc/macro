//! The key machine: one pure function from (state, key, page) to the next
//! state and the action the viewer takes. Modes are idle, pane, filter
//! and help; Esc always returns exactly one state.

#[cfg(test)]
mod test;

use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use tui_input::{Input, InputRequest};

use agent_monitor::domain::model::{AgentId, RepoId};

/// A key the viewer reacts to, decoded from a terminal event.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Key {
    /// A printable character.
    Char(char),
    /// Enter.
    Enter,
    /// Escape.
    Esc,
    /// Tab.
    Tab,
    /// Shift-Tab.
    BackTab,
    /// Arrow up.
    Up,
    /// Arrow down.
    Down,
    /// Arrow left.
    Left,
    /// Arrow right.
    Right,
    /// Page up.
    PageUp,
    /// Page down.
    PageDown,
    /// Home.
    Home,
    /// End.
    End,
    /// Backspace.
    Backspace,
    /// Ctrl-C.
    Interrupt,
    /// Ctrl-T: the next colour theme, in any mode (a backtick does it outside
    /// filter fields).
    NextTheme,
}

impl Key {
    /// Decodes a crossterm key press; releases and unknown keys give `None`.
    pub fn from_event(event: KeyEvent) -> Option<Key> {
        if event.kind == KeyEventKind::Release {
            return None;
        }

        let ctrl = event.modifiers.contains(KeyModifiers::CONTROL);
        let key = match event.code {
            KeyCode::Char('c') if ctrl => Key::Interrupt,
            KeyCode::Char('t') if ctrl => Key::NextTheme,
            KeyCode::Char(_) if ctrl => return None,
            KeyCode::Char(character) => Key::Char(character),
            KeyCode::Enter => Key::Enter,
            KeyCode::Esc => Key::Esc,
            KeyCode::Tab => Key::Tab,
            KeyCode::BackTab => Key::BackTab,
            KeyCode::Up => Key::Up,
            KeyCode::Down => Key::Down,
            KeyCode::Left => Key::Left,
            KeyCode::Right => Key::Right,
            KeyCode::PageUp => Key::PageUp,
            KeyCode::PageDown => Key::PageDown,
            KeyCode::Home => Key::Home,
            KeyCode::End => Key::End,
            KeyCode::Backspace => Key::Backspace,
            _ => return None,
        };
        Some(key)
    }
}

/// A page of the viewer.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Page {
    /// The monitor grid of every pane (`0`).
    Monitor,
    /// One pane zoomed to the whole screen (`1`-`8`).
    Zoom(Pane),
    /// The parent/child tree (`5`).
    Tree,
    /// A card per agent (`w`).
    Wall,
    /// One agent's drill-in.
    Agent(AgentId),
    /// One lane of the CHANGES page: its commits, pull request and agents.
    Lane(RepoId, String),
}

impl Page {
    /// The panes Tab cycles through on this page, in order.
    pub fn panes(&self) -> &'static [Pane] {
        match self {
            Page::Monitor => &[
                Pane::Agents,
                Pane::Body,
                Pane::Spend,
                Pane::Sources,
                Pane::Tape,
                Pane::Changes,
                Pane::Failures,
            ],
            Page::Agent(_) => &[Pane::Transcript, Pane::Children, Pane::AgentPrs],
            Page::Zoom(_) | Page::Tree | Page::Wall | Page::Lane(..) => &[],
        }
    }

    /// The pane cursor keys move when no pane is focused.
    pub fn default_pane(&self) -> Option<Pane> {
        match self {
            Page::Monitor => Some(Pane::Agents),
            Page::Zoom(pane) => Some(*pane),
            Page::Agent(_) => Some(Pane::Transcript),
            Page::Tree | Page::Wall | Page::Lane(..) => None,
        }
    }

    /// Whether this page has its own row filters.
    pub fn has_filters(&self) -> bool {
        matches!(
            self,
            Page::Tree
                | Page::Wall
                | Page::Zoom(Pane::Agents | Pane::Tape | Pane::Failures | Pane::Changes)
        )
    }

    /// Whether the ended-agent toggle applies on this page.
    pub fn filters_agents(&self) -> bool {
        matches!(self, Page::Wall | Page::Zoom(Pane::Agents))
    }

    /// Whether kind and status filters apply to this page's agent rows.
    pub fn filters_agent_rows(&self) -> bool {
        self.filters_agents() || *self == Page::Tree
    }

    /// The page a number key opens.
    fn numbered(digit: char) -> Option<Page> {
        let page = match digit {
            '0' => Page::Monitor,
            '1' => Page::Zoom(Pane::Agents),
            '2' => Page::Zoom(Pane::Tape),
            '3' => Page::Zoom(Pane::Spend),
            '4' => Page::Zoom(Pane::Failures),
            '5' => Page::Tree,
            '6' => Page::Zoom(Pane::Sources),
            '7' => Page::Zoom(Pane::Body),
            '8' => Page::Zoom(Pane::Changes),
            _ => return None,
        };
        Some(page)
    }
}

/// A pane: a numbered monitor pane, or a section of the drill-in page.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Pane {
    /// 1 AGENTS.
    Agents,
    /// 2 TAPE.
    Tape,
    /// 3 SPEND.
    Spend,
    /// 4 FAILURES.
    Failures,
    /// 6 SOURCES.
    Sources,
    /// 7 BODY.
    Body,
    /// 8 CHANGES: the git graph agents commit to, with pull requests on it.
    Changes,
    /// The drill-in's transcript tail.
    Transcript,
    /// The drill-in's children list.
    Children,
    /// The drill-in's pull requests.
    AgentPrs,
}

/// Where the cursor moves.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Motion {
    /// One row up.
    Up,
    /// One row down.
    Down,
    /// One page up.
    PageUp,
    /// One page down.
    PageDown,
    /// The first (newest) row.
    Top,
    /// The last row.
    Bottom,
    /// Collapse, or go to the previous card.
    Left,
    /// Expand, or go to the next card.
    Right,
}

/// The mode the base state returns to after filtering or help.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Base {
    /// No pane focused; cursor keys move the page's default pane.
    Idle,
    /// A pane is focused.
    Pane(Pane),
}

/// The key machine's state.
#[derive(Clone, Debug)]
pub enum Mode {
    /// Idle or a focused pane.
    Base(Base),
    /// Editing an on-page filter.
    Filter {
        /// What is typed so far.
        input: Input,
        /// Value restored by Escape.
        original: String,
        /// Where Esc or Enter returns.
        base: Base,
    },
    /// The key help overlay.
    Help {
        /// Where Esc returns.
        base: Base,
    },
}

// `Input` has no `PartialEq`; two lines are equal when their text and cursor are.
impl PartialEq for Mode {
    fn eq(&self, other: &Self) -> bool {
        let same_line = |a: &Input, b: &Input| a.value() == b.value() && a.cursor() == b.cursor();
        match (self, other) {
            (Mode::Base(a), Mode::Base(b)) => a == b,
            (Mode::Help { base: a }, Mode::Help { base: b }) => a == b,
            (
                Mode::Filter {
                    input: x,
                    original: old_x,
                    base: bx,
                },
                Mode::Filter {
                    input: y,
                    original: old_y,
                    base: by,
                },
            ) => bx == by && old_x == old_y && same_line(x, y),
            _ => false,
        }
    }
}

impl Default for Mode {
    fn default() -> Self {
        Mode::Base(Base::Idle)
    }
}

impl Mode {
    /// The pane cursor keys move on `page`.
    pub fn pane(&self, page: &Page) -> Option<Pane> {
        match self.base() {
            Base::Pane(pane) => Some(pane),
            Base::Idle => page.default_pane(),
        }
    }

    /// The base this mode returns to.
    pub fn base(&self) -> Base {
        match self {
            Mode::Base(base) | Mode::Filter { base, .. } | Mode::Help { base } => *base,
        }
    }
}

/// What the viewer does after a key.
#[derive(Clone, Debug, PartialEq)]
pub enum Action {
    /// Nothing beyond the new state.
    None,
    /// Quit the viewer.
    Quit,
    /// Open a page.
    Open(Page),
    /// Go back one page.
    Back,
    /// Move the cursor of a pane, or of the page when `None`.
    Move(Option<Pane>, Motion),
    /// Open the row under the cursor of a pane, or of the page when `None`.
    Activate(Option<Pane>),
    /// Start editing the current value of a filter field.
    EditFilter,
    /// Update a filter field live.
    SetFilter(String),
    /// Cycle the agent kind filter.
    NextKind,
    /// Cycle the agent status filter.
    NextStatus,
    /// Clear this page's row filters and hide ended agents again.
    ClearFilters,
    /// Show ended agents too, or only current ones again.
    ToggleAll,
    /// Show the BODY pane's next figure, or the previous one when false.
    CycleFigure(bool),
    /// Switch to the next colour theme.
    NextTheme,
    /// A CHANGES page key.
    Changes(ChangeKey),
}

/// What a key does on the CHANGES page, beyond moving and opening.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChangeKey {
    /// Inspect the selected change full-screen.
    Inspect,
    /// Open the selected change's agent.
    OpenAgent,
    /// `+`: finer time buckets.
    ZoomIn,
    /// `-`: coarser time buckets.
    ZoomOut,
    /// `<`: look earlier.
    Earlier,
    /// `>`: look later.
    Later,
    /// `Home`: back to now.
    Now,
    /// `[`: the previous repository.
    PrevRepo,
    /// `]`: the next repository.
    NextRepo,
    /// `n`: the next lane needing attention.
    NextAttention,
    /// `N`: the previous lane needing attention.
    PrevAttention,
    /// `m`: show or hide landed lanes.
    ToggleLanded,
    /// `s`: fork order or attention first.
    Sort,
    /// `p`: the lane's detail page.
    OpenLane,
}

impl ChangeKey {
    /// The CHANGES key `key` is, if any.
    fn of(key: Key) -> Option<ChangeKey> {
        let change = match key {
            Key::Char('a') => ChangeKey::OpenAgent,
            Key::Char('d') => ChangeKey::Inspect,
            Key::Char('+' | '=') => ChangeKey::ZoomIn,
            Key::Char('-' | '_') => ChangeKey::ZoomOut,
            Key::Char('<' | ',') => ChangeKey::Earlier,
            Key::Char('>' | '.') => ChangeKey::Later,
            Key::Home => ChangeKey::Now,
            Key::Char('[') => ChangeKey::PrevRepo,
            Key::Char(']') => ChangeKey::NextRepo,
            Key::Char('n') => ChangeKey::NextAttention,
            Key::Char('N') => ChangeKey::PrevAttention,
            Key::Char('m') => ChangeKey::ToggleLanded,
            Key::Char('s') => ChangeKey::Sort,
            Key::Char('p') => ChangeKey::OpenLane,
            _ => return None,
        };
        Some(change)
    }
}

/// The next state and action for `key` in `mode` on `page`.
pub fn step(mode: Mode, key: Key, page: &Page) -> (Mode, Action) {
    match key {
        Key::Interrupt => return (mode, Action::Quit),
        Key::NextTheme => return (mode, Action::NextTheme),
        _ => {}
    }

    match mode {
        Mode::Base(base) => step_base(base, key, page),
        Mode::Filter {
            input,
            original,
            base,
        } => step_filter(input, original, base, key),
        Mode::Help { base } => match key {
            Key::Esc | Key::Char('?') => (Mode::Base(base), Action::None),
            Key::Char('q') => (Mode::Help { base }, Action::Quit),
            _ => (Mode::Help { base }, Action::None),
        },
    }
}

fn step_base(base: Base, key: Key, page: &Page) -> (Mode, Action) {
    let pane = match base {
        Base::Pane(pane) => Some(pane),
        Base::Idle => page.default_pane(),
    };
    let stay = Mode::Base(base);

    // The CHANGES page has its own navigation and display controls.
    if *page == Page::Zoom(Pane::Changes)
        && let Some(change) = ChangeKey::of(key)
    {
        return (stay, Action::Changes(change));
    }

    match key {
        Key::Esc => match base {
            Base::Pane(_) => (Mode::Base(Base::Idle), Action::None),
            Base::Idle => (stay, Action::Back),
        },
        Key::Tab | Key::BackTab => (Mode::Base(cycle(base, key == Key::Tab, page)), Action::None),
        Key::Up | Key::Char('k') => (stay, Action::Move(pane, Motion::Up)),
        Key::Down | Key::Char('j') => (stay, Action::Move(pane, Motion::Down)),
        Key::Left | Key::Char('h') => (stay, Action::Move(pane, Motion::Left)),
        Key::Right | Key::Char('l') => (stay, Action::Move(pane, Motion::Right)),
        Key::PageUp => (stay, Action::Move(pane, Motion::PageUp)),
        Key::PageDown => (stay, Action::Move(pane, Motion::PageDown)),
        Key::Home => (stay, Action::Move(pane, Motion::Top)),
        Key::End => (stay, Action::Move(pane, Motion::Bottom)),
        Key::Enter => (stay, Action::Activate(pane)),
        Key::Char('q') => (stay, Action::Quit),
        // Browsers keep Ctrl-T for a new tab, so a terminal in a browser
        // (ttyd) cycles themes with a backtick.
        Key::Char('`') => (stay, Action::NextTheme),
        Key::Char('w') => (Mode::Base(Base::Idle), Action::Open(Page::Wall)),
        Key::Char('a') if page.filters_agents() => (stay, Action::ToggleAll),
        Key::Char('x') if page.has_filters() => (stay, Action::ClearFilters),
        Key::Char('b') if matches!(page, Page::Monitor | Page::Zoom(Pane::Body)) => {
            (stay, Action::CycleFigure(true))
        }
        Key::Char('B') if matches!(page, Page::Monitor | Page::Zoom(Pane::Body)) => {
            (stay, Action::CycleFigure(false))
        }
        Key::Char('/') if page.has_filters() => (stay, Action::EditFilter),
        Key::Char('t') if page.filters_agent_rows() => (stay, Action::NextKind),
        Key::Char('s') if page.filters_agent_rows() => (stay, Action::NextStatus),
        Key::Char('?') => (Mode::Help { base }, Action::None),
        Key::Char(digit) if digit.is_ascii_digit() => match Page::numbered(digit) {
            Some(target) => (Mode::Base(Base::Idle), Action::Open(target)),
            None => (stay, Action::None),
        },
        Key::Char(_) | Key::Backspace | Key::Interrupt | Key::NextTheme => (stay, Action::None),
    }
}

/// The next focus when Tab (forward) or Shift-Tab moves across `page`'s panes.
fn cycle(base: Base, forward: bool, page: &Page) -> Base {
    let panes = page.panes();
    if panes.is_empty() {
        return base;
    }

    let last = panes.len() - 1;
    let current = match base {
        Base::Pane(pane) => panes.iter().position(|candidate| *candidate == pane),
        Base::Idle => None,
    };
    let next = match (current, forward) {
        (None, true) => 0,
        (None, false) => last,
        (Some(index), true) if index == last => 0,
        (Some(index), true) => index + 1,
        (Some(0), false) => last,
        (Some(index), false) => index - 1,
    };
    panes.get(next).copied().map_or(base, Base::Pane)
}

/// Applies an editing key to a line input; returns whether the key edited it.
fn edit(input: &mut Input, key: Key) -> bool {
    let request = match key {
        Key::Char(character) => InputRequest::InsertChar(character),
        Key::Backspace => InputRequest::DeletePrevChar,
        Key::Left => InputRequest::GoToPrevChar,
        Key::Right => InputRequest::GoToNextChar,
        Key::Home => InputRequest::GoToStart,
        Key::End => InputRequest::GoToEnd,
        _ => return false,
    };
    input.handle(request);
    true
}

fn step_filter(mut input: Input, original: String, base: Base, key: Key) -> (Mode, Action) {
    match key {
        Key::Esc => (Mode::Base(base), Action::SetFilter(original)),
        Key::Enter => (Mode::Base(base), Action::None),
        _ => {
            let action = if edit(&mut input, key) {
                Action::SetFilter(input.value().to_owned())
            } else {
                Action::None
            };
            (
                Mode::Filter {
                    input,
                    original,
                    base,
                },
                action,
            )
        }
    }
}
