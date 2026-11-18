//! Allocation budget for dispatching an unchanged after-commit observation.
use lexical_model::*;
use std::{
    alloc::{GlobalAlloc, Layout, System},
    cell::Cell,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

#[derive(Clone, Copy, Debug, Default)]
struct Allocations {
    calls: usize,
    bytes: usize,
    reallocations: usize,
    reallocated_bytes: usize,
}
thread_local! {
    static ENABLED: Cell<bool> = const { Cell::new(false) };
    static COUNTS: Cell<Allocations> = const { Cell::new(Allocations {
        calls: 0, bytes: 0, reallocations: 0, reallocated_bytes: 0,
    }) };
}
struct Counting;
fn record(bytes: usize, reallocating: bool) {
    if ENABLED.try_with(Cell::get).unwrap_or(false) {
        let _ = COUNTS.try_with(|counter| {
            let mut value = counter.get();
            if reallocating {
                value.reallocations += 1;
                value.reallocated_bytes += bytes;
            } else {
                value.calls += 1;
                value.bytes += bytes;
            }
            counter.set(value);
        });
    }
}
// SAFETY: allocation and deallocation delegate unchanged to the system allocator.
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        record(layout.size(), false);
        // SAFETY: the caller supplied this allocation layout.
        unsafe { System.alloc(layout) }
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        record(layout.size(), false);
        // SAFETY: the caller supplied this allocation layout.
        unsafe { System.alloc_zeroed(layout) }
    }
    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        record(size, true);
        // SAFETY: forward the caller's allocation and replacement layout unchanged.
        unsafe { System.realloc(pointer, layout, size) }
    }
    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        // SAFETY: forward the caller's live allocation and layout unchanged.
        unsafe { System.dealloc(pointer, layout) }
    }
}
#[global_allocator]
static ALLOCATOR: Counting = Counting;

fn measured<T>(body: impl FnOnce() -> T) -> (T, Allocations) {
    COUNTS.set(Allocations::default());
    ENABLED.set(true);
    let result = body();
    ENABLED.set(false);
    (result, COUNTS.get())
}
struct Observe(Arc<AtomicUsize>);
impl Plugin for Observe {
    fn name(&self) -> &'static str {
        "allocation-observer"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[]
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        Ok(Handled::No)
    }
    fn after_commit(&self, _: &mut Transaction<'_>, _: &Commit) -> Result<(), Error> {
        self.0.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }
}

#[test]
fn unchanged_hook_dispatch_does_not_allocate_a_commit_copy() -> Result<(), Error> {
    let calls = Arc::new(AtomicUsize::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .plugin(Observe(calls.clone()))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?;
    let text = tx.create_text("unchanged")?;
    tx.append(paragraph.key(), &[text.key()])?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    let main = tx.commit()?;
    let before = editor.state().to_json()?;
    assert!(!main.is_noop());

    // Charge identical transaction/publication work separately. The hook path
    // may additionally snapshot its single registered plugin, but not the commit.
    let (control, baseline) = measured(|| editor.transaction().commit());
    assert!(control?.is_noop());
    let (result, actual) = measured(|| editor.run_after_commit(main));
    eprintln!("after_commit {actual:?}; unchanged transaction {baseline:?}");
    assert_eq!(calls.load(Ordering::Relaxed), 1);
    assert!(result.following.is_empty());
    assert!(result.follow_up_error.is_none());
    assert_eq!(editor.state().to_json()?, before);
    assert!(
        actual.calls <= baseline.calls + 1,
        "{actual:?} vs {baseline:?}"
    );
    assert!(
        actual.bytes <= baseline.bytes + size_of::<Arc<dyn Plugin>>(),
        "{actual:?} vs {baseline:?}"
    );
    assert!(
        actual.reallocations <= baseline.reallocations,
        "{actual:?} vs {baseline:?}"
    );
    assert!(
        actual.reallocated_bytes <= baseline.reallocated_bytes,
        "{actual:?} vs {baseline:?}"
    );
    Ok(())
}
