#![allow(clippy::unwrap_used)]

// Property test: the state of a workbook must not depend on how it got there.
//
// A `UserModel` (which evaluates after every action, like the UI) goes
// through a random sequence of edits: entering constants and formulas,
// clearing cells, placing CSE array formulas, on two sheets. At the end it is
// compared with a fresh `Model` that receives the *final* contents in one go
// and is evaluated once, and with the same fresh model evaluated twice.
//
// This catches stale spill cells, orphaned spill cells, anchors whose stored
// range disagrees with the sheet, and anything else that survives from a
// previous evaluation.
//
// One thing legitimately survives: which of two contending spills got there
// first, and with it whether an anchor on a cycle through
// its own area is reported circular or blocked. When any state shows a
// #SPILL! or a #CIRC!, the states are allowed to differ. The consistency
// oracle (`oracle`) is checked on every state regardless: every formula
// re-run against the final sheet must give its stored value.

use crate::test::util::new_empty_model;
use crate::Model;
use crate::UserModel;
use std::collections::BTreeMap;

const ROWS: i32 = 5;
const COLS: i32 = 5;
const EDITS: usize = 14;
const SEEDS: u64 = 600;

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

#[derive(Clone, Debug, PartialEq)]
enum Content {
    Input(String),
    // width, height, formula
    Cse(i32, i32, String),
}

#[derive(Clone, Debug)]
enum Edit {
    Set(u32, i32, i32, String),
    Clear(u32, i32, i32),
    Cse(u32, i32, i32, i32, i32, String),
}

fn column_name(column: i32) -> String {
    ((b'A' + (column - 1) as u8) as char).to_string()
}

fn cell_name(row: i32, column: i32) -> String {
    format!("{}{}", column_name(column), row)
}

fn random_position(rng: &mut Rng) -> (i32, i32) {
    (
        1 + rng.below(ROWS as u64) as i32,
        1 + rng.below(COLS as u64) as i32,
    )
}

/// A reference, on the current sheet or on the other one.
fn random_ref(rng: &mut Rng, sheet: u32) -> String {
    let (row, column) = random_position(rng);
    let name = cell_name(row, column);
    if rng.below(4) == 0 {
        let other = if sheet == 0 { "Sheet2" } else { "Sheet1" };
        format!("{other}!{name}")
    } else {
        name
    }
}

fn random_content(rng: &mut Rng, sheet: u32) -> String {
    match rng.below(15) {
        0 | 1 => format!("{}", 1 + rng.below(4)),
        2 => format!("={}+1", random_ref(rng, sheet)),
        3 => format!("={}*2", random_ref(rng, sheet)),
        4 => {
            let (r, c) = random_position(rng);
            let (r2, c2) = random_position(rng);
            format!("=SUM({}:{})", cell_name(r, c), cell_name(r2, c2))
        }
        5 => {
            let (row, column) = random_position(rng);
            format!("={}:{}", cell_name(row, column), cell_name(row + 2, column))
        }
        6 => format!("=SEQUENCE({})", 1 + rng.below(3)),
        7 => format!("=SEQUENCE({})", random_ref(rng, sheet)),
        8 => format!("={}#", random_ref(rng, sheet)),
        9 => format!("=SUM({}#)", random_ref(rng, sheet)),
        10 => format!("=SUM(OFFSET({},1,0,2,1))", random_ref(rng, sheet)),
        11 => format!("={}+{}", random_ref(rng, sheet), random_ref(rng, sheet)),
        12 => format!(
            "=SEQUENCE({}+{})",
            random_ref(rng, sheet),
            random_ref(rng, sheet)
        ),
        13 => format!("=SEQUENCE(1,{})", 1 + rng.below(3)),
        _ => {
            let (r, c) = random_position(rng);
            format!(
                "=SUM({}:{})+{}",
                cell_name(r, c),
                cell_name(r + 1, c + 1),
                random_ref(rng, sheet)
            )
        }
    }
}

fn random_edits(seed: u64) -> Vec<Edit> {
    let mut rng = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
    let mut edits = Vec::new();
    while edits.len() < EDITS {
        let sheet = rng.below(2) as u32;
        let (row, column) = random_position(&mut rng);
        let edit = match rng.below(10) {
            0 | 1 => Edit::Clear(sheet, row, column),
            2 => {
                let (width, height) = if rng.below(2) == 0 { (1, 2) } else { (2, 1) };
                let formula = match rng.below(3) {
                    0 => "=5".to_string(),
                    1 => format!("={}*2", random_ref(&mut rng, sheet)),
                    _ => {
                        let (r, c) = random_position(&mut rng);
                        format!("=SUM({}:{})", cell_name(r, c), cell_name(r + 1, c))
                    }
                };
                Edit::Cse(sheet, row, column, width, height, formula)
            }
            _ => Edit::Set(sheet, row, column, random_content(&mut rng, sheet)),
        };
        edits.push(edit);
    }
    edits
}

/// Applies an edit to the user model. Returns the change to the intended
/// contents if the edit was accepted (writing into a CSE area, or placing a
/// CSE area over one, is refused).
fn apply(model: &mut UserModel, edit: &Edit) -> Option<((u32, i32, i32), Option<Content>)> {
    match edit {
        Edit::Set(sheet, row, column, value) => model
            .set_user_input(*sheet, *row, *column, value)
            .ok()
            .map(|_| ((*sheet, *row, *column), Some(Content::Input(value.clone())))),
        Edit::Clear(sheet, row, column) => model
            .set_user_input(*sheet, *row, *column, "")
            .ok()
            .map(|_| ((*sheet, *row, *column), None)),
        Edit::Cse(sheet, row, column, width, height, formula) => model
            .set_user_array_formula(*sheet, *row, *column, *width, *height, formula)
            .ok()
            .map(|_| {
                (
                    (*sheet, *row, *column),
                    Some(Content::Cse(*width, *height, formula.clone())),
                )
            }),
    }
}

fn fresh(contents: &BTreeMap<(u32, i32, i32), Content>) -> Model<'static> {
    let mut model = new_empty_model();
    model.add_sheet("Sheet2").unwrap();
    // CSE areas first: an input that lands inside one is refused by the user
    // model too, so it is never in `contents`.
    for ((sheet, row, column), content) in contents {
        if let Content::Cse(width, height, formula) = content {
            model
                .set_user_array_formula(*sheet, *row, *column, *width, *height, formula)
                .unwrap();
        }
    }
    for ((sheet, row, column), content) in contents {
        if let Content::Input(value) = content {
            model
                .set_user_input(*sheet, *row, *column, value.clone())
                .unwrap();
        }
    }
    model
}

fn snapshot(model: &Model) -> Vec<String> {
    let mut lines = Vec::new();
    for sheet in 0..2 {
        for row in 1..=(ROWS + 6) {
            for column in 1..=(COLS + 6) {
                let text = model._get_text_at(sheet, row, column);
                if !text.is_empty() {
                    lines.push(format!("{sheet}:{}: {text}", cell_name(row, column)));
                }
            }
        }
    }
    lines
}

fn describe(edits: &[Edit], accepted: &[bool]) -> String {
    edits
        .iter()
        .zip(accepted)
        .map(|(e, ok)| format!("  {e:?}{}", if *ok { "" } else { "  (refused)" }))
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn edit_histories_end_in_the_same_state_as_a_fresh_model() {
    let mut failures = Vec::new();
    for seed in 1..=SEEDS {
        let edits = random_edits(seed);
        let mut model = UserModel::new_empty("model", "en", "UTC", "en").unwrap();
        model.new_sheet().unwrap();
        let mut contents: BTreeMap<(u32, i32, i32), Content> = BTreeMap::new();
        let mut accepted = Vec::new();
        for edit in &edits {
            match apply(&mut model, edit) {
                Some((key, Some(content))) => {
                    // A CSE area overwrites whatever the user had entered there.
                    if let Content::Cse(width, height, _) = &content {
                        let (sheet, row, column) = key;
                        for r in row..row + height {
                            for c in column..column + width {
                                if (r, c) != (row, column) {
                                    contents.remove(&(sheet, r, c));
                                }
                            }
                        }
                    }
                    contents.insert(key, content);
                    accepted.push(true);
                }
                Some((key, None)) => {
                    contents.remove(&key);
                    accepted.push(true);
                }
                None => accepted.push(false),
            }
        }
        let history = snapshot(&model.model);
        let mut inconsistencies = super::oracle::violations(&mut model.model);

        // The user model already evaluated after the last edit; one more
        // evaluation must not change anything.
        model.evaluate();
        let history_again = snapshot(&model.model);

        let mut expected = fresh(&contents);
        expected.evaluate();
        let fresh_once = snapshot(&expected);
        inconsistencies.extend(super::oracle::violations(&mut expected));
        expected.evaluate();
        let fresh_twice = snapshot(&expected);

        let history_dependent = history
            .iter()
            .chain(history_again.iter())
            .chain(fresh_once.iter())
            .chain(fresh_twice.iter())
            .any(|l| l.ends_with("#SPILL!") || l.ends_with("#CIRC!"));
        let same_state = history_dependent
            || (history == fresh_once && history == history_again && fresh_once == fresh_twice);
        if !same_state || !inconsistencies.is_empty() {
            failures.push(format!(
                "seed {seed}\n{}\nafter the edits:\n  {}\nafter one more evaluation:\n  {}\nfresh model:\n  {}\nfresh model evaluated twice:\n  {}\ninconsistencies:\n  {}",
                describe(&edits, &accepted),
                history.join("\n  "),
                history_again.join("\n  "),
                fresh_once.join("\n  "),
                fresh_twice.join("\n  "),
                inconsistencies.join("\n  "),
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {SEEDS} edit histories failed:\n\n{}",
        failures.len(),
        failures.join("\n\n")
    );
}
