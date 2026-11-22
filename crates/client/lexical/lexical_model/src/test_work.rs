//! Test-only work counts scoped to actual cache reconciliation, diffs and splices.
use std::cell::Cell;
use std::marker::PhantomData;
use std::rc::Rc;

use crate::NodeKey;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Phase {
    ModelCaches,
    Diff,
    Splice,
}

/// Child-order work in one phase, split between root and non-root parents.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct ChildWork {
    /// Keys collected into child lists of the root.
    pub(crate) root_keys: usize,
    /// Keys collected into child lists of other parents.
    pub(crate) other_keys: usize,
    /// Sibling links followed for the root (walks and lazy order compares).
    pub(crate) root_steps: usize,
    /// Sibling links followed for other parents.
    pub(crate) other_steps: usize,
}

#[derive(Clone, Copy, Default)]
struct Counts {
    generation: u64,
    phase: Option<Phase>,
    text_visits: usize,
    slot_lookups: usize,
    diff: ChildWork,
    splice: ChildWork,
    /// Child work outside the diff and splice phases.
    unscoped: ChildWork,
}

thread_local! {
    static NEXT_GENERATION: Cell<u64> = const { Cell::new(0) };
    static COUNTS: Cell<Option<Counts>> = const { Cell::new(None) };
}

pub(crate) struct Measurement(PhantomData<Rc<()>>);

impl Measurement {
    pub(crate) fn start() -> Self {
        COUNTS.with(|counts| {
            assert!(counts.get().is_none(), "nested cache work measurement");
            let generation = NEXT_GENERATION.with(|next| {
                let generation = next
                    .get()
                    .checked_add(1)
                    .expect("measurement generation overflow");
                next.set(generation);
                generation
            });
            counts.set(Some(Counts {
                generation,
                ..Counts::default()
            }));
        });
        Self(PhantomData)
    }

    pub(crate) fn slot_lookups(&self) -> usize {
        COUNTS.with(|counts| counts.get().expect("active measurement").slot_lookups)
    }

    pub(crate) fn text_visits(&self) -> usize {
        COUNTS.with(|counts| counts.get().expect("active measurement").text_visits)
    }

    /// Child work in `phase` (`Diff` or `Splice`), or outside both for `None`.
    pub(crate) fn children(&self, phase: Option<Phase>) -> ChildWork {
        COUNTS.with(|counts| {
            let counts = counts.get().expect("active measurement");
            match phase {
                Some(Phase::Diff) => counts.diff,
                Some(Phase::Splice) => counts.splice,
                Some(Phase::ModelCaches) | None => counts.unscoped,
            }
        })
    }
}

impl Drop for Measurement {
    fn drop(&mut self) {
        COUNTS.with(|counts| counts.set(None));
    }
}

#[derive(Clone, Copy)]
enum SavedPhase {
    Unmeasured,
    Outside(u64),
    Inside(u64, Phase),
}

pub(crate) struct PhaseScope {
    previous: SavedPhase,
    _thread: PhantomData<Rc<()>>,
}

pub(crate) fn enter(phase: Phase) -> PhaseScope {
    let previous = COUNTS.with(|counts| {
        let Some(mut value) = counts.get() else {
            return SavedPhase::Unmeasured;
        };
        let previous = match value.phase {
            Some(phase) => SavedPhase::Inside(value.generation, phase),
            None => SavedPhase::Outside(value.generation),
        };
        value.phase = Some(phase);
        counts.set(Some(value));
        previous
    });
    PhaseScope {
        previous,
        _thread: PhantomData,
    }
}

impl Drop for PhaseScope {
    fn drop(&mut self) {
        let (generation, previous) = match self.previous {
            SavedPhase::Unmeasured => return,
            SavedPhase::Outside(generation) => (generation, None),
            SavedPhase::Inside(generation, phase) => (generation, Some(phase)),
        };
        COUNTS.with(|counts| {
            if let Some(mut value) = counts.get()
                && value.generation == generation
            {
                value.phase = previous;
                counts.set(Some(value));
            }
        });
    }
}

pub(crate) fn record_text_visit() {
    COUNTS.with(|counts| {
        if let Some(mut value) = counts.get()
            && value.phase == Some(Phase::ModelCaches)
        {
            value.text_visits = value
                .text_visits
                .checked_add(1)
                .expect("work count overflow");
            counts.set(Some(value));
        }
    });
}

fn record_child_work(parent: NodeKey, keys: usize, steps: usize) {
    COUNTS.with(|counts| {
        if let Some(mut value) = counts.get() {
            let work = match value.phase {
                Some(Phase::Diff) => &mut value.diff,
                Some(Phase::Splice) => &mut value.splice,
                Some(Phase::ModelCaches) | None => &mut value.unscoped,
            };
            let (key_count, step_count) = if parent == NodeKey::ROOT {
                (&mut work.root_keys, &mut work.root_steps)
            } else {
                (&mut work.other_keys, &mut work.other_steps)
            };
            *key_count = key_count.checked_add(keys).expect("work count overflow");
            *step_count = step_count.checked_add(steps).expect("work count overflow");
            counts.set(Some(value));
        }
    });
}

/// Keys collected into one child list of `parent`, attributed to the innermost phase.
pub(crate) fn record_children_keys(parent: NodeKey, len: usize) {
    record_child_work(parent, len, 0);
}

/// One sibling link followed for `parent`, attributed to the innermost phase.
pub(crate) fn record_link_step(parent: NodeKey) {
    record_child_work(parent, 0, 1);
}

thread_local! {
    static FORCE_GENERAL_SPLICE: Cell<bool> = const { Cell::new(false) };
}

/// While alive, `splice_children` takes its general path, as a differential control.
pub(crate) struct GeneralSplice {
    previous: bool,
    _thread: PhantomData<Rc<()>>,
}

pub(crate) fn force_general_splice() -> GeneralSplice {
    GeneralSplice {
        previous: FORCE_GENERAL_SPLICE.with(|force| force.replace(true)),
        _thread: PhantomData,
    }
}

pub(crate) fn general_splice_forced() -> bool {
    FORCE_GENERAL_SPLICE.with(Cell::get)
}

impl Drop for GeneralSplice {
    fn drop(&mut self) {
        FORCE_GENERAL_SPLICE.with(|force| force.set(self.previous));
    }
}

// Count every graph lookup for the entire measurement, not only a chosen phase.
pub(crate) fn record_slot_lookup() {
    COUNTS.with(|counts| {
        if let Some(mut value) = counts.get() {
            value.slot_lookups = value
                .slot_lookups
                .checked_add(1)
                .expect("work count overflow");
            counts.set(Some(value));
        }
    });
}

thread_local! {
    static LEGACY_SELECTION_ORDER: Cell<bool> = const { Cell::new(false) };
}

pub(crate) fn legacy_selection_order() -> bool {
    LEGACY_SELECTION_ORDER.with(Cell::get)
}

pub(crate) struct LegacySelectionOrder(bool);

pub(crate) fn force_legacy_selection_order() -> LegacySelectionOrder {
    LegacySelectionOrder(LEGACY_SELECTION_ORDER.with(|value| value.replace(true)))
}

impl Drop for LegacySelectionOrder {
    fn drop(&mut self) {
        LEGACY_SELECTION_ORDER.with(|value| value.set(self.0));
    }
}

mod test;
