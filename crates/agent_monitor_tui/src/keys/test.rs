use agent_monitor::domain::model::AgentId;
use tui_input::Input;

use super::*;

fn idle() -> Mode {
    Mode::Base(Base::Idle)
}

fn typed(text: &str) -> Input {
    Input::new(text.to_owned())
}

/// Feeds keys one by one, returning the final mode and every action.
fn run(mut mode: Mode, keys: &[Key], page: &Page) -> (Mode, Vec<Action>) {
    let mut actions = Vec::new();
    for key in keys {
        let (next, action) = step(mode, *key, page);
        mode = next;
        actions.push(action);
    }
    (mode, actions)
}

#[test]
fn number_keys_open_pages_and_drop_focus() {
    let focused = Mode::Base(Base::Pane(Pane::Tape));
    let cases = [
        ('0', Page::Monitor),
        ('1', Page::Zoom(Pane::Agents)),
        ('2', Page::Zoom(Pane::Tape)),
        ('3', Page::Zoom(Pane::Spend)),
        ('4', Page::Zoom(Pane::Failures)),
        ('5', Page::Tree),
        ('6', Page::Zoom(Pane::Sources)),
        ('7', Page::Zoom(Pane::Body)),
    ];
    for (digit, page) in cases {
        assert_eq!(
            step(focused.clone(), Key::Char(digit), &Page::Monitor),
            (idle(), Action::Open(page))
        );
    }
    assert_eq!(
        step(idle(), Key::Char('8'), &Page::Monitor),
        (idle(), Action::None)
    );
}

#[test]
fn tab_cycles_the_monitor_panes_both_ways() {
    let page = Page::Monitor;
    let (mode, _) = run(idle(), &[Key::Tab], &page);
    assert_eq!(mode, Mode::Base(Base::Pane(Pane::Agents)));

    let (mode, _) = run(idle(), &[Key::Tab; 7], &page);
    assert_eq!(mode, Mode::Base(Base::Pane(Pane::Agents)));

    let (mode, _) = run(idle(), &[Key::BackTab], &page);
    assert_eq!(mode, Mode::Base(Base::Pane(Pane::Failures)));

    let (mode, _) = run(Mode::Base(Base::Pane(Pane::Agents)), &[Key::BackTab], &page);
    assert_eq!(mode, Mode::Base(Base::Pane(Pane::Failures)));
}

#[test]
fn tab_cycles_drill_in_sections_and_does_nothing_on_flat_pages() {
    let agent = Page::Agent(AgentId::from_wire(String::from("demo:1")));
    let (mode, _) = run(idle(), &[Key::Tab, Key::Tab], &agent);
    assert_eq!(mode, Mode::Base(Base::Pane(Pane::Children)));

    assert_eq!(step(idle(), Key::Tab, &Page::Wall), (idle(), Action::None));
    assert_eq!(step(idle(), Key::Tab, &Page::Tree), (idle(), Action::None));
}

#[test]
fn cursor_keys_move_the_focused_pane_or_the_page_default() {
    let cases = [
        (Key::Up, Motion::Up),
        (Key::Char('k'), Motion::Up),
        (Key::Down, Motion::Down),
        (Key::Char('j'), Motion::Down),
        (Key::Left, Motion::Left),
        (Key::Char('h'), Motion::Left),
        (Key::Right, Motion::Right),
        (Key::Char('l'), Motion::Right),
        (Key::PageUp, Motion::PageUp),
        (Key::PageDown, Motion::PageDown),
        (Key::Home, Motion::Top),
        (Key::End, Motion::Bottom),
    ];
    for (key, motion) in cases {
        assert_eq!(
            step(idle(), key, &Page::Monitor),
            (idle(), Action::Move(Some(Pane::Agents), motion))
        );
        let focused = Mode::Base(Base::Pane(Pane::Tape));
        assert_eq!(
            step(focused.clone(), key, &Page::Monitor),
            (focused, Action::Move(Some(Pane::Tape), motion))
        );
        assert_eq!(
            step(idle(), key, &Page::Tree),
            (idle(), Action::Move(None, motion))
        );
    }
}

#[test]
fn enter_activates_the_row_under_the_cursor() {
    assert_eq!(
        step(idle(), Key::Enter, &Page::Monitor),
        (idle(), Action::Activate(Some(Pane::Agents)))
    );
    let children = Mode::Base(Base::Pane(Pane::Children));
    let agent = Page::Agent(AgentId::from_wire(String::from("demo:1")));
    assert_eq!(
        step(children.clone(), Key::Enter, &agent),
        (children, Action::Activate(Some(Pane::Children)))
    );
    assert_eq!(
        step(idle(), Key::Enter, &Page::Wall),
        (idle(), Action::Activate(None))
    );
}

#[test]
fn esc_returns_exactly_one_state() {
    let focused = Mode::Base(Base::Pane(Pane::Spend));
    assert_eq!(
        step(focused.clone(), Key::Esc, &Page::Monitor),
        (idle(), Action::None)
    );
    assert_eq!(step(idle(), Key::Esc, &Page::Monitor), (idle(), Action::Back));

    let command = Mode::Command {
        input: typed("AG"),
        base: Base::Pane(Pane::Spend),
    };
    assert_eq!(
        step(command, Key::Esc, &Page::Monitor),
        (focused.clone(), Action::None)
    );

    let find = Mode::Find {
        input: typed("rpc"),
        base: Base::Pane(Pane::Spend),
    };
    assert_eq!(
        step(find, Key::Esc, &Page::Monitor),
        (focused.clone(), Action::Find(String::new()))
    );

    let help = Mode::Help {
        base: Base::Pane(Pane::Spend),
    };
    assert_eq!(step(help, Key::Esc, &Page::Monitor), (focused, Action::None));
}

#[test]
fn quit_keys() {
    assert_eq!(step(idle(), Key::Char('q'), &Page::Monitor), (idle(), Action::Quit));

    let command = Mode::Command {
        input: typed("AG"),
        base: Base::Idle,
    };
    assert_eq!(
        step(command.clone(), Key::Interrupt, &Page::Monitor),
        (command, Action::Quit)
    );

    let help = Mode::Help { base: Base::Idle };
    assert_eq!(
        step(help.clone(), Key::Char('q'), &Page::Monitor),
        (help, Action::Quit)
    );
}

#[test]
fn w_opens_the_wall_and_question_mark_toggles_help() {
    assert_eq!(
        step(Mode::Base(Base::Pane(Pane::Tape)), Key::Char('w'), &Page::Monitor),
        (idle(), Action::Open(Page::Wall))
    );

    let (mode, actions) = run(idle(), &[Key::Char('?')], &Page::Monitor);
    assert_eq!(mode, Mode::Help { base: Base::Idle });
    assert_eq!(actions, vec![Action::None]);

    let (mode, _) = run(idle(), &[Key::Char('?'), Key::Char('x'), Key::Char('?')], &Page::Monitor);
    assert_eq!(mode, idle());
}

#[test]
fn a_letter_starts_the_command_line_and_enter_runs_it() {
    let keys: Vec<Key> = "AGT builder working".chars().map(Key::Char).collect();
    let (mode, actions) = run(idle(), &keys, &Page::Monitor);
    assert_eq!(
        mode,
        Mode::Command {
            input: typed("AGT builder working"),
            base: Base::Idle,
        }
    );
    assert!(actions.iter().all(|action| *action == Action::None));

    assert_eq!(
        step(mode, Key::Enter, &Page::Monitor),
        (
            idle(),
            Action::Run(Command {
                page: Page::Zoom(Pane::Agents),
                filter: vec![String::from("builder"), String::from("working")],
            })
        )
    );
}

#[test]
fn reserved_letters_do_not_start_the_command_line() {
    for letter in ['j', 'k', 'h', 'l', 'q', 'w'] {
        let (mode, _) = step(idle(), Key::Char(letter), &Page::Monitor);
        assert_eq!(mode, idle(), "{letter}");
    }
    let (mode, _) = step(idle(), Key::Char('J'), &Page::Monitor);
    assert!(matches!(mode, Mode::Command { .. }));
}

#[test]
fn command_line_editing() {
    let (mode, _) = run(
        idle(),
        &[Key::Char('T'), Key::Char('R'), Key::Char('X'), Key::Backspace, Key::Char('E'), Key::Char('E')],
        &Page::Monitor,
    );
    assert_eq!(
        step(mode, Key::Enter, &Page::Monitor),
        (
            idle(),
            Action::Run(Command {
                page: Page::Tree,
                filter: Vec::new(),
            })
        )
    );

    // Backspace on an empty line leaves the command line.
    let (mode, _) = run(idle(), &[Key::Char('T'), Key::Backspace, Key::Backspace], &Page::Monitor);
    assert_eq!(mode, idle());
}

#[test]
fn unknown_commands_are_reported() {
    let (mode, _) = run(idle(), &[Key::Char('Z'), Key::Char('Z')], &Page::Monitor);
    assert_eq!(
        step(mode, Key::Enter, &Page::Monitor),
        (idle(), Action::Unknown(String::from("ZZ")))
    );
}

#[test]
fn every_mnemonic_parses_case_insensitively() {
    let cases = [
        ("MON", Page::Monitor),
        ("agt", Page::Zoom(Pane::Agents)),
        ("TAPE", Page::Zoom(Pane::Tape)),
        ("SPND", Page::Zoom(Pane::Spend)),
        ("Spend", Page::Zoom(Pane::Spend)),
        ("FAIL", Page::Zoom(Pane::Failures)),
        ("TREE", Page::Tree),
        ("SRC", Page::Zoom(Pane::Sources)),
        ("BODY", Page::Zoom(Pane::Body)),
        ("WALL", Page::Wall),
    ];
    for (line, page) in cases {
        assert_eq!(
            Command::parse(line),
            Some(Command {
                page,
                filter: Vec::new(),
            })
        );
    }
    assert_eq!(Command::parse("  "), None);
}

#[test]
fn find_filters_live_and_enter_keeps_the_query() {
    let (mode, actions) = run(
        idle(),
        &[Key::Char('/'), Key::Char('r'), Key::Char('p'), Key::Backspace, Key::Char('p')],
        &Page::Monitor,
    );
    assert_eq!(
        actions,
        vec![
            Action::Find(String::new()),
            Action::Find(String::from("r")),
            Action::Find(String::from("rp")),
            Action::Find(String::from("r")),
            Action::Find(String::from("rp")),
        ]
    );
    // Letters reserved in idle mode are text while finding.
    let (mode, actions) = run(mode, &[Key::Char('q'), Key::Enter], &Page::Monitor);
    assert_eq!(
        actions,
        vec![Action::Find(String::from("rpq")), Action::None]
    );
    assert_eq!(mode, idle());
}

#[test]
fn key_events_decode() {
    use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};

    let ctrl_c = KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL);
    assert_eq!(Key::from_event(ctrl_c), Some(Key::Interrupt));

    let ctrl_x = KeyEvent::new(KeyCode::Char('x'), KeyModifiers::CONTROL);
    assert_eq!(Key::from_event(ctrl_x), None);

    let mut release = KeyEvent::new(KeyCode::Char('a'), KeyModifiers::NONE);
    release.kind = KeyEventKind::Release;
    assert_eq!(Key::from_event(release), None);

    let shift_a = KeyEvent::new(KeyCode::Char('A'), KeyModifiers::SHIFT);
    assert_eq!(Key::from_event(shift_a), Some(Key::Char('A')));
}
