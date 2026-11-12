//! Test-only work counts scoped to actual cache reconciliation.
use std::cell::Cell;
use std::marker::PhantomData;
use std::rc::Rc;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Phase {
    ModelCaches,
}

#[derive(Clone, Copy, Default)]
struct Counts {
    generation: u64,
    phase: Option<Phase>,
    text_visits: usize,
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

    pub(crate) fn text_visits(&self) -> usize {
        COUNTS.with(|counts| counts.get().expect("active measurement").text_visits)
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

mod test;
