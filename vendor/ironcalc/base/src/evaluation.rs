//! Evaluation of every formula in the workbook.
//!
//! The algorithm in short:
//!
//! * A **pass** is the plain top-down recursion: to evaluate a cell, evaluate
//!   the cells it reads as it meets them. A cell met while it is already being
//!   evaluated closes a cycle. Dynamic array anchors are evaluated first, in a
//!   remembered order, then every cell of every sheet.
//! * A dynamic array writes cells other than its own, and which ones is only
//!   known once it has run. Anything that read one of those positions earlier
//!   in the pass read the wrong thing. So the pass records what formulas saw
//!   at the positions they read, and when an anchor is about to contradict a
//!   record, the pass is **abandoned and started again with that anchor
//!   before the cells that read it**. Each restart is a fact learned about
//!   the sheet, "this anchor runs before that reader"; the driver keeps the
//!   facts and orders the anchors by them. A restart can only happen when
//!   the order breaks a fact not yet known, so there are at most `n²` of
//!   them, and a loop of anchors reading each other's areas shows up as a
//!   cycle among the facts. An anchor whose own inputs read its area is
//!   contradicted by itself wherever it sits: it is circular.
//! * Spill cells left by a previous evaluation are never read as values
//!   before their anchor has run in the current pass; they still block other
//!   arrays, which is how the array that spilled first keeps its cells. The
//!   one thing they cannot do is stand in for the anchor's output: when an
//!   anchor gives them up and only its own inputs were blocked by them, they
//!   were history, not a dependency. They are dropped for the rest of the
//!   evaluation and the pass starts again without them.
//!
//! * The recursion is bounded, in formulas and in stack. When it would go
//!   deeper it **unwinds**: the formulas in progress end without storing
//!   anything but stay on the stack, still `Evaluating`. The outermost one
//!   then **replays** the stack from the top, the deepest cell first, as often
//!   as it takes. A long chain of formulas therefore costs memory and about
//!   one extra run per cell instead of overflowing the stack of the thread.
//!
//! The order of the anchors survives across evaluations, so a sheet that
//! needed restarts once evaluates in a single pass afterwards.
//!
//! Nothing here depends on the order in which cells are visited, only the
//! amount of work does.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use crate::calc_result::CalcResult;
use crate::constants::{LAST_COLUMN, LAST_ROW};
use crate::expressions::token::Error;
use crate::expressions::types::CellReferenceIndex;
use crate::model::Model;
use crate::types::{ArrayKind, Cell};

/// The hasher of the maps the evaluation keeps about positions. Their keys are
/// three small integers and every formula looks several of them up, which
/// made the default hasher, built to resist chosen keys, a fifth of the cost
/// of an evaluation. This one multiplies and rotates, a word at a time.
#[derive(Default, Clone, Copy)]
pub(crate) struct KeyHasher(u64);

impl std::hash::Hasher for KeyHasher {
    fn write(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.write_u32(*byte as u32);
        }
    }

    fn write_u32(&mut self, i: u32) {
        self.0 = (self.0.rotate_left(5) ^ i as u64).wrapping_mul(0x517c_c1b7_2722_0a95);
    }

    fn write_i32(&mut self, i: i32) {
        self.write_u32(i as u32);
    }

    fn finish(&self) -> u64 {
        self.0
    }
}

pub(crate) type KeyBuild = std::hash::BuildHasherDefault<KeyHasher>;

/// `(sheet, row, column)`: a position in the workbook.
pub(crate) type CellKey = (u32, i32, i32);

fn key(cell: CellReferenceIndex) -> CellKey {
    (cell.sheet, cell.row, cell.column)
}

/// What the evaluation needs to know about a formula cell in order to run it
/// and to store its result: everything but its value. A few numbers, copied
/// out of the cell, so that the sheet is not borrowed while the formula runs
/// and the cell does not have to be cloned.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct FormulaCell {
    /// Index of the formula in the parsed formulas of the sheet.
    pub(crate) f: i32,
    /// Style index.
    pub(crate) s: i32,
    /// For the anchor of an array: whether it is dynamic, and the area
    /// `(width, height)` it occupies now.
    pub(crate) array: Option<(bool, (i32, i32))>,
}

impl FormulaCell {
    /// `None` if the cell does not hold a formula.
    pub(crate) fn of(cell: &Cell) -> Option<FormulaCell> {
        match cell {
            Cell::CellFormula { f, s, .. } => Some(FormulaCell {
                f: *f,
                s: *s,
                array: None,
            }),
            Cell::ArrayFormula { f, s, r, kind, .. } => Some(FormulaCell {
                f: *f,
                s: *s,
                array: Some((matches!(kind, ArrayKind::Dynamic), *r)),
            }),
            _ => None,
        }
    }
}

/// The state of a formula cell within the current pass. Absent means it has
/// not been evaluated yet.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum CellState {
    Evaluating,
    Evaluated,
}

/// What a formula found at a position when it read it, as far as spills are
/// concerned. A spill written into a position seen `Empty`, or a spill cell
/// removed from a position seen `Occupied`, contradicts the reader.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Seen {
    Empty,
    Occupied,
}

/// What was seen at one position in the current pass: the root of the
/// recursion that first read it as empty, and the root of the recursion on
/// whose behalf an array was first blocked by it. Both can be set for the
/// same position: a leftover spill cell of the anchor being evaluated is read
/// as empty on its behalf, and then blocks an array evaluated on demand
/// inside it. Keeping only the first record would let the anchor remove the
/// cell without contradicting the blocked array.
#[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
pub(crate) struct SeenRecord {
    pub(crate) empty: Option<CellReferenceIndex>,
    pub(crate) occupied: Option<CellReferenceIndex>,
}

/// A rectangle read as empty on behalf of `root`, in one go. A function that
/// walks a whole column or row visits only the sheet's used area; the rest of
/// the range holds nothing, and the formula depends on it all the same. That
/// remainder is one record, not one per cell, so a whole-column read costs a
/// single entry beyond the cells it visits.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct SeenRange {
    pub(crate) root: CellReferenceIndex,
    pub(crate) sheet: u32,
    pub(crate) row1: i32,
    pub(crate) column1: i32,
    pub(crate) row2: i32,
    pub(crate) column2: i32,
}

impl SeenRange {
    fn contains(&self, (sheet, row, column): CellKey) -> bool {
        sheet == self.sheet
            && (self.row1..=self.row2).contains(&row)
            && (self.column1..=self.column2).contains(&column)
    }
}

/// Why the current pass is abandoned. In every case the pass starts again,
/// after the driver has learned what the restart says about the order.
#[derive(Clone, PartialEq, Eq, Debug)]
pub(crate) enum Restart {
    /// A spill cell of this anchor was read, on behalf of `reader`, before the
    /// anchor had run. The word "stale" means is a leftover from a previous evaluation.
    /// Example:
    /// A1 = SEQUENCE(1,1,5)
    /// B1 = SEQUENCE(3)
    /// The evaluation order in A1, B1, no restarts
    /// Then we switch A1 = SEQUENCE(1,1,B3)
    /// Then A1 reads B3 which is a leftover from the previous evaluation of B1.
    StaleRead {
        anchor: CellReferenceIndex,
        reader: CellReferenceIndex,
    },
    /// What this anchor is about to write contradicts something read on behalf
    /// of `readers`, other cells: the anchor should have run before them.
    /// The same two formulas on a fresh sheet, with nothing spilled yet:
    /// A1 = SEQUENCE(1,1,B3)
    /// B1 = SEQUENCE(3)
    /// While evaluating natural order A1 reads B3 and takes note of that. When B1 evaluates it wants to write
    /// B3 and finds a conflict
    Conflict {
        anchor: CellReferenceIndex,
        readers: Vec<CellReferenceIndex>,
    },
    /// What this anchor is about to write contradicts only reads made on its
    /// own behalf: its inputs depend on its own output. It is circular.
    SelfContradiction(CellReferenceIndex),
    /// The spill cells this anchor is giving up, left by a previous
    /// evaluation, blocked an array evaluated on its own behalf and nothing
    /// else. The anchor's inputs depended on its history, not on its output:
    /// the cells are dropped for the rest of the evaluation.
    /// An example will be:
    ///   A1 = 1
    ///   B2 = IF(A1=1, SEQUENCE(2,2), IF(ISERROR(C1), 5, 7))
    ///   C1 = SEQUENCE(3)
    /// The evaluation order in A1, B2, C1, no restarts. C1 is #SPILL!
    /// Now we set A1 = 0. A2 will read C1 and force it's evaluation that will still be blocked by the stale spill from the previous C1 evaluation.
    /// The evaluation of B2 will want to delete C2 and C3 which are the stale cells.
    StaleCells(CellReferenceIndex, Vec<CellKey>),
}

impl Restart {
    fn anchor(&self) -> CellReferenceIndex {
        match self {
            Restart::StaleRead { anchor, .. }
            | Restart::Conflict { anchor, .. }
            | Restart::SelfContradiction(anchor)
            | Restart::StaleCells(anchor, _) => *anchor,
        }
    }
}

/// The driver's memory of one evaluation: the facts learned about the order,
/// and the anchors marked circular.
///
/// Every pass starts from the same sheet, so a pass is a function of the
/// anchor order and of the circular set. A restart says that some readers
/// read an anchor's area before it ran: a fact, "the anchor runs before each
/// of them", that the current order breaks. The driver records the fact and
/// repairs the order so that every fact holds, moving the anchor and what
/// must precede it to just before the reader (`learn`). Since the order
/// always respects the known facts, every restart adds a fact that was not
/// known; there are at most `n(n-1)` of them. When a fact would close a
/// cycle, the anchors on the cycle read each other's areas and no order can
/// serve them: they are marked circular, at most `n` times.
/// A marked anchor runs no formula and, its stale cells dropped, writes and
/// blocks nothing, so it never restarts again. Stale-cell restarts drop at
/// least one cell each. Hence the loop ends, with no cap needed.
struct RestartLog {
    /// Anchors marked circular so far; passed to every pass.
    circular: Vec<CellKey>,
    /// `(a, r)`: `a` runs before `r`. Learned from restarts; never broken by
    /// the order; acyclic.
    facts: Vec<(CellReferenceIndex, CellReferenceIndex)>,
    /// Every restart of this evaluation.
    restarts: u32,
}

impl RestartLog {
    fn new() -> Self {
        RestartLog {
            circular: Vec::new(),
            facts: Vec::new(),
            restarts: 0,
        }
    }

    /// Records a restart: learns its facts, marks what it proves circular and
    /// reorders `order` to respect the facts. Returns the anchors newly
    /// marked circular.
    fn record(
        &mut self,
        restart: &Restart,
        order: &mut Vec<CellReferenceIndex>,
    ) -> Vec<CellReferenceIndex> {
        self.restarts += 1;
        let anchor = restart.anchor();
        let readers: Vec<CellReferenceIndex> = match restart {
            Restart::StaleRead { reader, .. } => vec![*reader],
            Restart::Conflict { readers, .. } => readers.clone(),
            Restart::SelfContradiction(_) => vec![],
            Restart::StaleCells(..) => return Vec::new(),
        };
        let mut newly_circular: Vec<CellReferenceIndex> = Vec::new();
        if let Restart::SelfContradiction(_) = restart {
            self.mark(anchor, &mut newly_circular);
        }
        for reader in readers {
            if self.circular.contains(&key(anchor)) {
                break;
            }
            if self.circular.contains(&key(reader)) {
                // Marked while an earlier reader was learned: on a loop,
                // nothing to order it against.
                continue;
            }
            self.learn(anchor, reader, order, &mut newly_circular);
        }
        newly_circular
    }

    /// Learns that `anchor` runs before `reader`, one restart's fact. If the
    /// facts already place `reader` before `anchor`, the two are on a loop of
    /// anchors reading each other's areas, with everything the facts place
    /// between them: all of it is marked. Otherwise the fact is kept and the
    /// order repaired: `anchor`, and whatever the facts place before it, move
    /// from behind `reader` to just before it, in their present order.
    fn learn(
        &mut self,
        anchor: CellReferenceIndex,
        reader: CellReferenceIndex,
        order: &mut Vec<CellReferenceIndex>,
        newly_circular: &mut Vec<CellReferenceIndex>,
    ) {
        if reader == anchor {
            return;
        }
        let before_anchor = self.reachable(anchor, |a, r| (r, a));
        if before_anchor.contains(&reader) {
            let after_reader = self.reachable(reader, |a, r| (a, r));
            for cell in before_anchor {
                if after_reader.contains(&cell) {
                    self.mark(cell, newly_circular);
                }
            }
            return;
        }
        self.facts.push((anchor, reader));
        let Some(reader_position) = order.iter().position(|c| *c == reader) else {
            return;
        };
        let moved: Vec<CellReferenceIndex> = order[reader_position + 1..]
            .iter()
            .copied()
            .filter(|cell| before_anchor.contains(cell))
            .collect();
        order.retain(|cell| !moved.contains(cell));
        order.splice(reader_position..reader_position, moved);
    }

    /// Marks an anchor circular. A marked anchor neither writes nor reads:
    /// its facts are spent.
    fn mark(&mut self, cell: CellReferenceIndex, newly_circular: &mut Vec<CellReferenceIndex>) {
        if self.circular.contains(&key(cell)) {
            return;
        }
        self.circular.push(key(cell));
        newly_circular.push(cell);
        self.facts.retain(|(a, r)| *a != cell && *r != cell);
    }

    /// Everything reachable from `start` along the facts, `start` included,
    /// with `edge` giving the direction to follow.
    fn reachable(
        &self,
        start: CellReferenceIndex,
        edge: fn(
            CellReferenceIndex,
            CellReferenceIndex,
        ) -> (CellReferenceIndex, CellReferenceIndex),
    ) -> Vec<CellReferenceIndex> {
        let mut seen = vec![start];
        let mut todo = vec![start];
        while let Some(cell) = todo.pop() {
            for (a, r) in &self.facts {
                let (from, to) = edge(*a, *r);
                if from == cell && !seen.contains(&to) {
                    seen.push(to);
                    todo.push(to);
                }
            }
        }
        seen
    }
}

/// Everything the evaluation needs besides the workbook itself.
pub(crate) struct Evaluation {
    /// The dynamic anchors, in the order in which they are evaluated. Kept
    /// across evaluations: the order the restarts arrived at stays, so the
    /// next evaluation needs no restart. New anchors are appended in natural
    /// `(sheet, row, column)` order.
    pub(crate) anchor_order: Vec<CellReferenceIndex>,
    /// Formula cells touched in the current pass, and their state.
    pub(crate) cells: HashMap<CellKey, CellState, KeyBuild>,
    /// Cells being evaluated, innermost last.
    pub(crate) stack: Vec<CellReferenceIndex>,
    /// The cell the driver is evaluating: the root of the current recursion,
    /// on whose behalf every read of the pass is recorded.
    pub(crate) root: Option<CellReferenceIndex>,
    /// Cells known to be circular. Marked on the stack when a read closes a
    /// loop, or by the driver when an anchor's spill contradicts its own inputs;
    /// the latter survive restarts within one evaluation.
    pub(crate) circular: HashSet<CellKey, KeyBuild>,
    /// What formulas saw at the positions they read in the current pass, and
    /// the root of the recursion the read was made in (the cell the driver was
    /// evaluating at the time), one record per kind.
    pub(crate) seen: HashMap<CellKey, SeenRecord, KeyBuild>,
    /// Rectangles read as empty in one go, with their root (`SeenRange`).
    pub(crate) seen_ranges: Vec<SeenRange>,
    /// Set when the current pass must be abandoned. Every evaluation in
    /// progress then returns without storing anything.
    pub(crate) restart: Option<Restart>,
    /// True while `evaluate()` is running a pass. Outside a pass (conditional
    /// formatting at load time, formula helpers) there is no driver to restart
    /// anything, so cells are simply evaluated on demand.
    pub(crate) in_pass: bool,
    /// Number of restarts the last `evaluate()` needed. For tests and tuning.
    pub(crate) restarts_in_last_evaluation: u32,
    /// Number of formulas running right now, that is the depth of the
    /// recursion. It can be smaller than `stack.len()`: see `unwinding`.
    pub(crate) depth: usize,
    /// The deepest the recursion is allowed to go, in formulas.
    pub(crate) max_depth: usize,
    /// The most stack the recursion is allowed to use, in bytes, measured from
    /// the outermost formula. How much one formula needs varies a lot, with
    /// the formula and with the build, so a number of formulas alone does not
    /// bound the stack.
    pub(crate) max_stack: usize,
    /// Where the stack was when the outermost formula started.
    pub(crate) stack_base: usize,
    /// Set when the recursion got too deep. Like a pending restart, every
    /// evaluation in progress then returns without storing anything; unlike a
    /// restart, the cells stay on `stack`, still `Evaluating`, to be run again
    /// from the top once the recursion has unwound.
    pub(crate) unwinding: bool,
}

/// How deep the recursion may go when nobody has said otherwise, in formulas
/// and in bytes of stack. Measured on a chain of `=A2+1`: a formula takes about
/// 3 KB of stack in a release build and 16 KB in a debug build, and three to
/// four times that when it nests a few functions. The limits are far below
/// what the smallest common stacks hold (1 MB in WebAssembly, 2 MB for a
/// thread) and cost nothing to workbooks that never reach them.
const DEFAULT_MAX_DEPTH: usize = 64;
const DEFAULT_MAX_STACK: usize = 256 * 1024;

/// Roughly where the stack is: the address of a local.
#[inline(never)]
fn stack_address() -> usize {
    let marker = 0u8;
    std::hint::black_box(&marker) as *const u8 as usize
}

/// The limit a new model starts with. Under test it can be set from outside,
/// `IRONCALC_MAX_DEPTH=1 cargo test`, so that every test of the crate runs
/// through the unwind and the replay.
fn default_max_depth() -> usize {
    #[cfg(test)]
    if let Some(max_depth) = std::env::var("IRONCALC_MAX_DEPTH")
        .ok()
        .and_then(|value| value.parse().ok())
    {
        return max_depth;
    }
    DEFAULT_MAX_DEPTH
}

impl Default for Evaluation {
    fn default() -> Self {
        Evaluation {
            anchor_order: Vec::new(),
            cells: HashMap::default(),
            stack: Vec::new(),
            root: None,
            circular: HashSet::default(),
            seen: HashMap::default(),
            seen_ranges: Vec::new(),
            restart: None,
            in_pass: false,
            restarts_in_last_evaluation: 0,
            depth: 0,
            max_depth: default_max_depth(),
            max_stack: DEFAULT_MAX_STACK,
            stack_base: 0,
            unwinding: false,
        }
    }
}

impl<'a> Model<'a> {
    /// Evaluates every formula in the workbook.
    ///
    /// Runs passes until one completes without a restart. `RestartLog` learns
    /// from each restart, reorders the anchors and marks what it proves
    /// circular; see there for why the loop ends. A marked anchor stores
    /// `#CIRC!` and keeps no spill cells: its stale cells are dropped when it
    /// is marked, so there is nothing of it to read or to contradict.
    pub fn evaluate(&mut self) {
        self.sync_anchor_order();
        // Every pass starts from the same sheet: what an abandoned pass wrote
        // is undone. This is what makes a pass a function of the anchor order.
        // The only changes to that sheet within an evaluation are the dropping
        // of stale spill cells: an anchor's own when it gave them up, a marked
        // anchor's when it is marked.
        let mut spills_before = self.dynamic_spills();
        let mut log = RestartLog::new();
        while let Some(restart) = self.run_pass(&log.circular) {
            let marked = log.record(&restart, &mut self.evaluation.anchor_order);
            spills_before.retain(|(position, cell)| {
                let dropped = match &restart {
                    Restart::StaleCells(_, cells) => cells.contains(&key(*position)),
                    _ => false,
                };
                let of_marked = match cell {
                    Cell::SpillCell { a, .. } => marked
                        .iter()
                        .any(|m| m.sheet == position.sheet && (m.row, m.column) == *a),
                    _ => false,
                };
                !dropped && !of_marked
            });
            self.restore_dynamic_spills(&spills_before);
        }
        self.evaluation.restarts_in_last_evaluation = log.restarts;
        self.evaluate_conditional_formatting();
    }

    /// Sets how many formulas deep the evaluation may recurse. A formula that
    /// reads a formula that reads a formula, and so on, uses the stack of the
    /// thread for every step. Beyond this limit the evaluation unwinds and
    /// carries on from where it stopped instead of going deeper, so the limit
    /// bounds the stack used and never changes a result. Lower it where the
    /// stack is small. The least it can be is 1. See also
    /// `set_max_evaluation_stack`: whichever limit is reached first applies.
    pub fn set_max_evaluation_depth(&mut self, max_depth: usize) {
        self.evaluation.max_depth = max_depth.max(1);
    }

    /// The limit set by `set_max_evaluation_depth`.
    pub fn get_max_evaluation_depth(&self) -> usize {
        self.evaluation.max_depth
    }

    /// Sets how many bytes of stack the evaluation may use before it unwinds,
    /// counted from the first formula of the recursion. The evaluation can
    /// overshoot by what one formula needs, so leave room: a quarter of the
    /// stack is a reasonable value.
    pub fn set_max_evaluation_stack(&mut self, bytes: usize) {
        self.evaluation.max_stack = bytes;
    }

    /// The limit set by `set_max_evaluation_stack`.
    pub fn get_max_evaluation_stack(&self) -> usize {
        self.evaluation.max_stack
    }

    /// Every position that holds a cell, in natural `(sheet, row, column)` order.
    fn all_positions(&self) -> Vec<CellReferenceIndex> {
        self.get_all_cells()
            .into_iter()
            .map(|index| CellReferenceIndex {
                sheet: index.index,
                row: index.row,
                column: index.column,
            })
            .collect()
    }

    /// Every dynamic anchor and every spill cell of a dynamic anchor, as they
    /// are now, in natural order, which is the order the sheets give their
    /// cells in.
    fn dynamic_spills(&self) -> Vec<(CellReferenceIndex, Cell)> {
        let mut found = Vec::new();
        for (sheet, worksheet) in self.workbook.worksheets.iter().enumerate() {
            for (row, column, cell) in worksheet.sheet_data.cells() {
                if !matches!(cell, Cell::ArrayFormula { .. } | Cell::SpillCell { .. }) {
                    continue;
                }
                let position = CellReferenceIndex {
                    sheet: sheet as u32,
                    row,
                    column,
                };
                if self.belongs_to_a_dynamic_array(position, cell) {
                    found.push((position, cell.clone()));
                }
            }
        }
        found
    }

    /// Puts the dynamic anchors and their spill cells back to `snapshot`,
    /// removing the spill cells written since.
    fn restore_dynamic_spills(&mut self, snapshot: &[(CellReferenceIndex, Cell)]) {
        let written_since: Vec<CellReferenceIndex> = self
            .dynamic_spills()
            .into_iter()
            .filter(|(_, cell)| matches!(cell, Cell::SpillCell { .. }))
            .map(|(position, _)| position)
            .collect();
        for position in written_since {
            if let Ok(worksheet) = self.workbook.worksheet_mut(position.sheet) {
                let _ = worksheet.cell_clear_contents(position.row, position.column);
            }
        }
        for (position, cell) in snapshot {
            if let Ok(worksheet) = self.workbook.worksheet_mut(position.sheet) {
                let _ = worksheet.update_cell(position.row, position.column, cell.clone());
            }
        }
    }

    fn belongs_to_a_dynamic_array(&self, position: CellReferenceIndex, cell: &Cell) -> bool {
        match cell {
            Cell::ArrayFormula {
                kind: ArrayKind::Dynamic,
                ..
            } => true,
            Cell::SpillCell { a, .. } => matches!(
                self.fetch_cell(CellReferenceIndex {
                    sheet: position.sheet,
                    row: a.0,
                    column: a.1,
                }),
                Some(Cell::ArrayFormula {
                    kind: ArrayKind::Dynamic,
                    ..
                })
            ),
            _ => false,
        }
    }

    /// Brings `anchor_order` in line with the dynamic anchors that exist now:
    /// anchors that are gone are dropped, new ones are appended in natural
    /// order, the rest keep their relative order.
    fn sync_anchor_order(&mut self) {
        let current = self.dynamic_anchors_in_natural_order();
        let current_set: HashSet<CellReferenceIndex> = current.iter().copied().collect();
        let order = &mut self.evaluation.anchor_order;
        order.retain(|anchor| current_set.contains(anchor));
        let known: HashSet<CellReferenceIndex> = order.iter().copied().collect();
        order.extend(current.into_iter().filter(|a| !known.contains(a)));
    }

    fn dynamic_anchors_in_natural_order(&self) -> Vec<CellReferenceIndex> {
        let mut found = Vec::new();
        for (sheet, worksheet) in self.workbook.worksheets.iter().enumerate() {
            for (row, column, cell) in worksheet.sheet_data.cells() {
                if matches!(
                    cell,
                    Cell::ArrayFormula {
                        kind: ArrayKind::Dynamic,
                        ..
                    }
                ) {
                    found.push(CellReferenceIndex {
                        sheet: sheet as u32,
                        row,
                        column,
                    });
                }
            }
        }
        found
    }

    /// One pass over the workbook: anchors first, then every cell. Returns the
    /// reason the pass had to be abandoned, if any.
    fn run_pass(&mut self, circular_anchors: &[CellKey]) -> Option<Restart> {
        let state = &mut self.evaluation;
        state.cells.clear();
        state.stack.clear();
        state.seen.clear();
        state.seen_ranges.clear();
        state.restart = None;
        state.depth = 0;
        state.unwinding = false;
        state.circular = circular_anchors.iter().copied().collect();
        state.in_pass = true;
        // dynamic links (HYPERLINK) are rebuilt on every evaluation
        self.links.clear();
        self.clear_variable_stack();
        self.clear_lambdas();

        let anchors = self.evaluation.anchor_order.clone();
        let everything = self.all_positions();
        let mut restart = None;
        for cell in anchors.into_iter().chain(everything) {
            self.evaluation.root = Some(cell);
            self.evaluate_cell(cell);
            if self.evaluation.restart.is_some() {
                restart = self.evaluation.restart.take();
                break;
            }
        }
        self.evaluation.in_pass = false;
        self.evaluation.root = None;
        restart
    }

    /// The value of a cell, evaluating it first if it is a formula that has
    /// not been evaluated in this pass. Reads are performed on behalf of the
    /// cell on top of the stack.
    pub(crate) fn evaluate_cell(&mut self, cell_reference: CellReferenceIndex) -> CalcResult {
        if self.evaluation.restart.is_some() || self.evaluation.unwinding {
            // The pass is being abandoned, or the recursion is unwinding;
            // nothing computed now is kept. This comes before anything is put
            // on record: a read that was not made is nobody's dependency.
            return CalcResult::EmptyCell;
        }
        // The cell is looked at, not cloned: what is needed of it is copied
        // out, and the sheet is free again before anything else is evaluated.
        let cell = match self.fetch_cell(cell_reference) {
            None | Some(Cell::EmptyCell { .. }) => {
                self.record_seen(cell_reference, Seen::Empty);
                return CalcResult::EmptyCell;
            }
            Some(cell) => cell,
        };
        if let Cell::SpillCell { a, .. } = cell {
            let anchor = *a;
            return self.evaluate_spill_cell(cell_reference, anchor);
        }
        match FormulaCell::of(cell) {
            Some(formula_cell) => self.evaluate_formula_cell(cell_reference, formula_cell),
            // A constant.
            None => self.get_cell_value(cell, cell_reference),
        }
    }

    /// A spill cell holds what its anchor wrote. Only a value written by the
    /// anchor in the current pass is a value; anything else is either the
    /// anchor's business (a CSE area is fixed and forwards to its anchor) or a
    /// leftover of a previous evaluation, which is read as empty or triggers a
    /// restart so that the anchor runs first.
    fn evaluate_spill_cell(
        &mut self,
        cell_reference: CellReferenceIndex,
        anchor: (i32, i32),
    ) -> CalcResult {
        let anchor_reference = CellReferenceIndex {
            sheet: cell_reference.sheet,
            row: anchor.0,
            column: anchor.1,
        };
        let kind = match self.fetch_cell(anchor_reference) {
            Some(Cell::ArrayFormula { kind, .. }) => kind.clone(),
            _ => {
                // An orphan: its anchor is gone. Nothing will ever write it again.
                self.record_seen(cell_reference, Seen::Empty);
                return CalcResult::EmptyCell;
            }
        };
        let anchor_state = self.evaluation.cells.get(&key(anchor_reference)).copied();
        match (kind, anchor_state) {
            // Written by the anchor in this pass.
            (_, Some(CellState::Evaluated)) => self.stored_value(cell_reference),
            // A CSE area is fixed: its anchor is evaluated first and the cell
            // holds what it wrote. If the anchor is running, this read closes a
            // cycle, which `evaluate_cell` reports.
            (ArrayKind::Cse, Some(CellState::Evaluating)) => self.evaluate_cell(anchor_reference),
            (ArrayKind::Cse, None) => {
                self.evaluate_cell(anchor_reference);
                self.stored_value(cell_reference)
            }
            // The anchor is running and this read is on its behalf: the area
            // counts as empty until the anchor commits. If the anchor then
            // writes this position, its inputs depended on its own output.
            (ArrayKind::Dynamic, Some(CellState::Evaluating)) => {
                self.record_seen(cell_reference, Seen::Empty);
                CalcResult::EmptyCell
            }
            // Left over from a previous evaluation: the anchor should have run
            // before anyone read its cells. Restart with it before the reader.
            // Outside a pass there is no driver, so the anchor is simply
            // evaluated now.
            (ArrayKind::Dynamic, None) => {
                if self.evaluation.in_pass {
                    // Inside a pass the driver has always set the root.
                    let reader = self.evaluation.root.unwrap_or(anchor_reference);
                    self.evaluation.restart = Some(Restart::StaleRead {
                        anchor: anchor_reference,
                        reader,
                    });
                    CalcResult::EmptyCell
                } else {
                    self.evaluate_cell(anchor_reference);
                    self.stored_value(cell_reference)
                }
            }
        }
    }

    fn evaluate_formula_cell(
        &mut self,
        cell_reference: CellReferenceIndex,
        cell: FormulaCell,
    ) -> CalcResult {
        let key = key(cell_reference);
        match self.evaluation.cells.get(&key) {
            Some(CellState::Evaluating) => {
                self.mark_cycle(cell_reference);
                return circular_reference(cell_reference);
            }
            Some(CellState::Evaluated) => return self.stored_value(cell_reference),
            None => {}
        }
        self.evaluation.cells.insert(key, CellState::Evaluating);
        // Everything above this length is this cell and what it needs.
        let base = self.evaluation.stack.len();
        self.evaluation.stack.push(cell_reference);
        if self.too_deep() {
            // Too deep. The cell is not run: it stays on the stack, still
            // `Evaluating`, and so will every cell above it as the recursion
            // unwinds. They are run again from the top once it has.
            self.evaluation.unwinding = true;
            return CalcResult::EmptyCell;
        }
        let result = self.run_top(cell_reference, cell);
        if self.evaluation.depth > 0 || !self.evaluation.unwinding {
            return result;
        }
        // This is the outermost formula and the recursion below it got too
        // deep. It has unwound: nothing is running, and the stack holds this
        // cell and the cells it is waiting for, the deepest on top, none of
        // them evaluated. Run them from the top. A cell that completes leaves
        // the stack and the one below finds it evaluated. A cell that reads
        // further down than the limit allows unwinds again, with more cells on
        // the stack, and the replay carries on from the new top. Every cell is
        // pushed once in a pass, so this ends.
        self.replay(base);
        if self.evaluation.restart.is_some() {
            return CalcResult::EmptyCell;
        }
        self.stored_value(cell_reference)
    }

    /// Whether the recursion has gone as deep as it is allowed to, in formulas
    /// or in stack. Never true for the outermost formula, which has to run.
    fn too_deep(&mut self) -> bool {
        let here = stack_address();
        if self.evaluation.depth == 0 {
            self.evaluation.stack_base = here;
            return false;
        }
        self.evaluation.depth >= self.evaluation.max_depth
            || self.evaluation.stack_base.abs_diff(here) >= self.evaluation.max_stack
    }

    /// Runs the cells left on the stack above `base` by an unwind, from the
    /// top, until they are all evaluated or the pass is abandoned.
    fn replay(&mut self, base: usize) {
        while self.evaluation.unwinding {
            self.evaluation.unwinding = false;
            while self.evaluation.stack.len() > base
                && !self.evaluation.unwinding
                && self.evaluation.restart.is_none()
            {
                let Some(&top) = self.evaluation.stack.last() else {
                    break;
                };
                match self.fetch_cell(top).and_then(FormulaCell::of) {
                    Some(cell) => {
                        self.run_top(top, cell);
                    }
                    None => {
                        // Not expected: nothing replaces a formula during a
                        // pass. Let go of it rather than loop on it.
                        self.evaluation.stack.pop();
                        self.evaluation.cells.insert(key(top), CellState::Evaluated);
                    }
                }
            }
        }
    }

    /// Runs the formula of the cell on top of the stack, stores the result and
    /// takes the cell off the stack. If the pass is being abandoned nothing is
    /// stored. If the recursion is unwinding nothing is stored either, and the
    /// cell stays on the stack, `Evaluating`: it has not been evaluated yet.
    /// A read that closes a loop through it is then still a cycle.
    fn run_top(&mut self, cell_reference: CellReferenceIndex, cell: FormulaCell) -> CalcResult {
        let key = key(cell_reference);
        // A formula can attach a link to its cell as it runs (HYPERLINK). A
        // run that was abandoned to an unwind may have attached one on the
        // strength of values it never really read; this run decides afresh.
        if !self.links.is_empty() {
            self.links.remove(&key);
        }
        self.evaluation.depth += 1;
        let result = if self.evaluation.circular.contains(&key) {
            circular_reference(cell_reference)
        } else {
            self.compute_formula(cell_reference, cell.f)
        };
        self.evaluation.depth -= 1;
        if self.evaluation.unwinding {
            return CalcResult::EmptyCell;
        }
        // The cell may have been found on a cycle while it ran.
        let result = if self.evaluation.circular.contains(&key) {
            circular_reference(cell_reference)
        } else {
            result
        };
        let stored = if self.evaluation.restart.is_some() {
            // Abandoned pass: store nothing.
            Ok(())
        } else {
            self.set_cells_with_result(cell_reference, cell, &result)
        };
        self.evaluation.stack.pop();
        if let Err(message) = stored {
            // Not expected to happen; keep the cell from being evaluated again.
            self.evaluation.cells.insert(key, CellState::Evaluated);
            return CalcResult::new_error(Error::ERROR, cell_reference, message);
        }
        if self.evaluation.restart.is_some() {
            return CalcResult::EmptyCell;
        }
        self.evaluation.cells.insert(key, CellState::Evaluated);
        // Return what was stored, so that a dependent evaluated in this pass
        // sees the same value it would read from the sheet later: the first
        // element of a spilled array, or the error the result was turned into.
        self.stored_value(cell_reference)
    }

    /// Runs the parsed formula and turns a reference into a value or an array.
    fn compute_formula(&mut self, cell_reference: CellReferenceIndex, formula: i32) -> CalcResult {
        // Shares the formula, it does not copy it.
        let node =
            Arc::clone(&self.parsed_formulas[cell_reference.sheet as usize][formula as usize].0);
        match self.evaluate_node_in_context(&node, cell_reference) {
            CalcResult::Range { left, right } => {
                if left == right {
                    self.evaluate_cell(left)
                } else {
                    let height = right.row - left.row + 1;
                    let width = right.column - left.column + 1;
                    if cell_reference.row + height - 1 > LAST_ROW
                        || cell_reference.column + width - 1 > LAST_COLUMN
                    {
                        CalcResult::new_error(
                            Error::SPILL,
                            cell_reference,
                            "Spill would exceed worksheet bounds".to_string(),
                        )
                    } else {
                        CalcResult::Array(self.evaluate_range(left, right))
                    }
                }
            }
            CalcResult::Lambda(_) => CalcResult::new_error(
                Error::CALC,
                cell_reference,
                "A LAMBDA was returned but not called".to_string(),
            ),
            result => result,
        }
    }

    /// The value currently stored at a position, empty if there is no cell.
    fn stored_value(&self, cell_reference: CellReferenceIndex) -> CalcResult {
        match self.fetch_cell(cell_reference) {
            Some(cell) => self.get_cell_value(cell, cell_reference),
            None => CalcResult::EmptyCell,
        }
    }

    /// A read closed a loop at `from`: every cell on the stack from `from` to the
    /// top is on the loop. They all store `#CIRC!`, whatever their formula would
    /// have made of the error, so that the verdict does not depend on where the
    /// recursion entered the loop.
    fn mark_cycle(&mut self, from: CellReferenceIndex) {
        let Some(start) = self.evaluation.stack.iter().rposition(|c| *c == from) else {
            return;
        };
        for cell in &self.evaluation.stack[start..] {
            self.evaluation.circular.insert(key(*cell));
        }
    }

    /// Records what the formula being evaluated found at a position, together
    /// with the root of the current recursion, the cell the driver is
    /// evaluating. The first record of each kind is kept. Reads made outside
    /// a pass are nobody's dependency.
    pub(crate) fn record_seen(&mut self, position: CellReferenceIndex, seen: Seen) {
        if !self.evaluation.in_pass {
            return;
        }
        if let Some(root) = self.evaluation.root {
            let record = self.evaluation.seen.entry(key(position)).or_default();
            let slot = match seen {
                Seen::Empty => &mut record.empty,
                Seen::Occupied => &mut record.occupied,
            };
            if slot.is_none() {
                *slot = Some(root);
            }
        }
    }

    /// Records that the formula being evaluated depends on every position of a
    /// rectangle and found them all empty, on behalf of the root. Used for the
    /// part of a whole-column or whole-row range that a walk skips because it
    /// lies outside the sheet's used area (`clip_to_used_area`).
    pub(crate) fn record_seen_empty_range(
        &mut self,
        sheet: u32,
        row1: i32,
        column1: i32,
        row2: i32,
        column2: i32,
    ) {
        if !self.evaluation.in_pass || row1 > row2 || column1 > column2 {
            return;
        }
        if let Some(root) = self.evaluation.root {
            self.evaluation.seen_ranges.push(SeenRange {
                root,
                sheet,
                row1,
                column1,
                row2,
                column2,
            });
        }
    }

    /// Clips a whole-column or whole-row range to the sheet's used area, so
    /// that a function walking it visits only the cells that can hold
    /// something. Returns the bottom-right corner to walk to. The cells the
    /// walk will skip are put on record as read empty first: the formula
    /// depends on them, and a spill into them must restart the pass, however
    /// the used area changes while the walk runs.
    pub(crate) fn clip_to_used_area(
        &mut self,
        sheet: u32,
        row1: i32,
        column1: i32,
        row2: i32,
        column2: i32,
    ) -> Result<(i32, i32), String> {
        let whole_rows = row1 == 1 && row2 == LAST_ROW;
        let whole_columns = column1 == 1 && column2 == LAST_COLUMN;
        if !whole_rows && !whole_columns {
            return Ok((row2, column2));
        }
        let dimension = self
            .workbook
            .worksheet(sheet)
            .map_err(|_| format!("Invalid worksheet index: '{sheet}'"))?
            .dimension();
        let last_row = if whole_rows { dimension.max_row } else { row2 };
        let last_column = if whole_columns {
            dimension.max_column
        } else {
            column2
        };
        // The remainder: the rows below the used area over the whole width,
        // and the columns beyond it within the rows that are walked.
        self.record_seen_empty_range(sheet, last_row + 1, column1, row2, column2);
        self.record_seen_empty_range(sheet, row1, last_column + 1, last_row, column2);
        Ok((last_row, last_column))
    }

    /// Checks, on behalf of the dynamic anchor about to commit, whether writing
    /// spill cells at `writes` and removing its own spill cells at `clears` would
    /// contradict what a formula read earlier in this pass. If so, the pass is
    /// abandoned so that it can start again with the anchor first, and `true`
    /// is returned: the anchor must not write anything. When every contradicted
    /// read was made on the anchor's own behalf, the anchor is circular, unless
    /// only the removals contradict: then the cells were stale, and they go.
    pub(crate) fn spill_contradicts_a_read(
        &mut self,
        anchor: CellReferenceIndex,
        writes: &[CellKey],
        clears: &[CellKey],
    ) -> bool {
        if !self.evaluation.in_pass {
            return false;
        }
        let seen = &self.evaluation.seen;
        let ranges = &self.evaluation.seen_ranges;
        let contradicted_by_writes: Vec<CellReferenceIndex> = writes
            .iter()
            .filter_map(|p| seen.get(p).and_then(|record| record.empty))
            .chain(writes.iter().flat_map(|p| {
                ranges
                    .iter()
                    .filter(move |range| range.contains(*p))
                    .map(|range| range.root)
            }))
            .collect();
        let contradicted_by_clears: Vec<CellReferenceIndex> = clears
            .iter()
            .filter_map(|p| seen.get(p).and_then(|record| record.occupied))
            .collect();
        if contradicted_by_writes.is_empty() && contradicted_by_clears.is_empty() {
            return false;
        }
        let mut readers: Vec<CellReferenceIndex> = Vec::new();
        for root in contradicted_by_writes.iter().chain(&contradicted_by_clears) {
            if *root != anchor && !readers.contains(root) {
                readers.push(*root);
            }
        }
        self.evaluation.restart = Some(if !readers.is_empty() {
            Restart::Conflict { anchor, readers }
        } else if contradicted_by_writes.is_empty() {
            Restart::StaleCells(anchor, clears.to_vec())
        } else {
            Restart::SelfContradiction(anchor)
        });
        true
    }
}

fn circular_reference(cell_reference: CellReferenceIndex) -> CalcResult {
    CalcResult::new_error(
        Error::CIRC,
        cell_reference,
        "Circular reference detected".to_string(),
    )
}
