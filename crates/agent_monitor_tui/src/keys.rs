//! The key machine: one pure function from (state, key, page) to the next
//! state and the action the viewer takes. Modes are idle, pane, command, find
//! and help; Esc always returns exactly one state.

#[cfg(test)]
mod test;

use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use tui_input::{Input, InputRequest};

use agent_monitor::domain::model::AgentId;

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
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Page {
    /// The monitor grid of every pane (`0`).
    Monitor,
    /// One pane zoomed to the whole screen (`1`-`7`).
    Zoom(Pane),
    /// The parent/child tree (`5`).
    Tree,
    /// A card per agent (`w`).
    Wall,
    /// One agent's drill-in.
    Agent(AgentId),
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
                Pane::Failures,
            ],
            Page::Agent(_) => &[Pane::Transcript, Pane::Children],
            Page::Zoom(_) | Page::Tree | Page::Wall => &[],
        }
    }

    /// The pane cursor keys move when no pane is focused.
    pub fn default_pane(&self) -> Option<Pane> {
        match self {
            Page::Monitor => Some(Pane::Agents),
            Page::Zoom(pane) => Some(*pane),
            Page::Agent(_) => Some(Pane::Transcript),
            Page::Tree | Page::Wall => None,
        }
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
    /// The drill-in's transcript tail.
    Transcript,
    /// The drill-in's children list.
    Children,
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

/// A parsed command line: the page its mnemonic opens and the filter words
/// after it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Command {
    /// The page.
    pub page: Page,
    /// Lowercase filter words; empty clears the filter.
    pub filter: Vec<String>,
}

impl Command {
    /// Parses `AGT builder working`; mnemonics are case-insensitive.
    pub fn parse(line: &str) -> Option<Command> {
        let mut words = line.split_whitespace();
        let mnemonic = words.next()?.to_ascii_uppercase();
        let page = match mnemonic.as_str() {
            "MON" => Page::Monitor,
            "AGT" | "AGENTS" => Page::Zoom(Pane::Agents),
            "TAPE" => Page::Zoom(Pane::Tape),
            "SPND" | "SPEND" => Page::Zoom(Pane::Spend),
            "FAIL" => Page::Zoom(Pane::Failures),
            "TREE" => Page::Tree,
            "SRC" => Page::Zoom(Pane::Sources),
            "BODY" => Page::Zoom(Pane::Body),
            "WALL" => Page::Wall,
            _ => return None,
        };
        let filter = words.map(str::to_lowercase).collect();
        Some(Command { page, filter })
    }
}

/// The mode the base state returns to after a command, find or help.
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
    /// Typing a command line.
    Command {
        /// What is typed so far.
        input: Input,
        /// Where Esc or Enter returns.
        base: Base,
    },
    /// Typing a find query.
    Find {
        /// What is typed so far.
        input: Input,
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
            (Mode::Command { input: a, base: x }, Mode::Command { input: b, base: y })
            | (Mode::Find { input: a, base: x }, Mode::Find { input: b, base: y }) => {
                x == y && same_line(a, b)
            }
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
            Mode::Base(base)
            | Mode::Command { base, .. }
            | Mode::Find { base, .. }
            | Mode::Help { base } => *base,
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
    /// Run a command line.
    Run(Command),
    /// An unknown command line, to report.
    Unknown(String),
    /// Filter rows by this find query; empty clears it.
    Find(String),
}

/// The next state and action for `key` in `mode` on `page`.
pub fn step(mode: Mode, key: Key, page: &Page) -> (Mode, Action) {
    if key == Key::Interrupt {
        return (mode, Action::Quit);
    }

    match mode {
        Mode::Base(base) => step_base(base, key, page),
        Mode::Command { input, base } => step_command(input, base, key),
        Mode::Find { input, base } => step_find(input, base, key),
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
        Key::Char('w') => (Mode::Base(Base::Idle), Action::Open(Page::Wall)),
        Key::Char('/') => (
            Mode::Find {
                input: Input::default(),
                base,
            },
            Action::Find(String::new()),
        ),
        Key::Char('?') => (Mode::Help { base }, Action::None),
        Key::Char(digit) if digit.is_ascii_digit() => match Page::numbered(digit) {
            Some(target) => (Mode::Base(Base::Idle), Action::Open(target)),
            None => (stay, Action::None),
        },
        Key::Char(letter) if letter.is_alphabetic() => {
            let mut input = Input::default();
            input.handle(InputRequest::InsertChar(letter));
            (Mode::Command { input, base }, Action::None)
        }
        Key::Char(_) | Key::Backspace | Key::Interrupt => (stay, Action::None),
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
    Base::Pane(panes[next])
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

fn step_command(mut input: Input, base: Base, key: Key) -> (Mode, Action) {
    match key {
        Key::Esc => (Mode::Base(base), Action::None),
        Key::Enter => {
            let line = input.value().trim().to_owned();
            let action = match Command::parse(&line) {
                Some(command) => Action::Run(command),
                None if line.is_empty() => Action::None,
                None => Action::Unknown(line),
            };
            (Mode::Base(base), action)
        }
        Key::Backspace if input.value().is_empty() => (Mode::Base(base), Action::None),
        _ => {
            edit(&mut input, key);
            (Mode::Command { input, base }, Action::None)
        }
    }
}

fn step_find(mut input: Input, base: Base, key: Key) -> (Mode, Action) {
    match key {
        Key::Esc => (Mode::Base(base), Action::Find(String::new())),
        Key::Enter => (Mode::Base(base), Action::None),
        _ => {
            if edit(&mut input, key) {
                let query = input.value().to_owned();
                (Mode::Find { input, base }, Action::Find(query))
            } else {
                (Mode::Find { input, base }, Action::None)
            }
        }
    }
}
