use super::*;
use std::panic::{AssertUnwindSafe, catch_unwind};

#[test]
fn nested_scopes_restore_the_current_input_without_crossing_editors() {
    let scopes = InputDomScopes::default();
    let other = InputDomScopes::default();
    let outer = scopes.enter().unwrap();
    scopes.prevent_default();
    {
        let inner = scopes.enter().unwrap();
        scopes.stop_propagation().unwrap();
        assert_eq!(
            inner.snapshot(),
            InputDomDisposition {
                default_prevented: false,
                propagation_stopped: true,
            }
        );
        assert_eq!(
            outer.snapshot(),
            InputDomDisposition {
                default_prevented: true,
                propagation_stopped: false,
            }
        );
        assert!(other.stop_propagation().is_err());
        other.prevent_default();
    }
    scopes.prevent_default();
    assert_eq!(
        outer.snapshot(),
        InputDomDisposition {
            default_prevented: true,
            propagation_stopped: false,
        }
    );
    drop(outer);
    assert!(scopes.stop_propagation().is_err());
    let next = scopes.enter().unwrap();
    assert_eq!(next.snapshot(), InputDomDisposition::default());
}

#[test]
fn unwind_restores_outer_scope_before_the_outer_setter_resumes() {
    let scopes = InputDomScopes::default();
    let outer = scopes.enter().unwrap();
    let failure = catch_unwind(AssertUnwindSafe(|| {
        let _inner = scopes.enter().unwrap();
        scopes.stop_propagation().unwrap();
        panic!("injected nested callback unwind");
    }));
    assert!(failure.is_err());
    scopes.prevent_default();
    assert_eq!(
        outer.snapshot(),
        InputDomDisposition {
            default_prevented: true,
            propagation_stopped: false,
        }
    );
}

#[test]
fn poisoned_scope_refuses_new_inputs_but_preserves_real_prevention() {
    let scopes = InputDomScopes::default();
    let outer = scopes.enter().unwrap();
    let failure = catch_unwind(AssertUnwindSafe(|| {
        let _lock = scopes.0.lock().unwrap();
        panic!("injected scope lock poison");
    }));
    assert!(failure.is_err());
    assert!(matches!(
        scopes.enter(),
        Err(Error::Invariant("input DOM scope lock poisoned"))
    ));
    scopes.prevent_default();
    assert_eq!(
        outer.snapshot(),
        InputDomDisposition {
            default_prevented: true,
            propagation_stopped: false,
        }
    );
    assert!(matches!(
        scopes.stop_propagation(),
        Err(Error::Invariant("input DOM scope lock poisoned"))
    ));
    drop(outer);
}

#[test]
fn setters_use_the_current_editor_frame_even_after_suspend_resume() {
    let mut editor = crate::Editor::builder(crate::EditorMode::ViewAttached)
        .build()
        .unwrap();
    let mut other = crate::Editor::builder(crate::EditorMode::ViewAttached)
        .build()
        .unwrap();
    let outer = editor.input_dom_scopes.enter().unwrap();
    let mut tx = editor.transaction();
    tx.prevent_default();
    let pending = tx.suspend();
    {
        let inner = editor.input_dom_scopes.enter().unwrap();
        let mut tx = editor.resume(pending).unwrap();
        tx.stop_dom_propagation().unwrap();
        let pending = tx.suspend();
        assert_eq!(
            inner.snapshot(),
            InputDomDisposition {
                default_prevented: false,
                propagation_stopped: true,
            }
        );
        assert!(other.transaction().stop_dom_propagation().is_err());
        drop(inner);
        let mut tx = editor.resume(pending).unwrap();
        tx.prevent_default();
        let pending = tx.suspend();
        assert_eq!(
            outer.snapshot(),
            InputDomDisposition {
                default_prevented: true,
                propagation_stopped: false,
            }
        );
        drop(outer);
        let mut tx = editor.resume(pending).unwrap();
        assert!(tx.stop_dom_propagation().is_err());
        tx.prevent_default();
        // Standalone prevention preserves the exact existing commit path.
        assert!(tx.commit().unwrap().default_prevented);
    }
    let next = editor.input_dom_scopes.enter().unwrap();
    assert_eq!(next.snapshot(), InputDomDisposition::default());
    let independent = other.input_dom_scopes.enter().unwrap();
    other.transaction().stop_dom_propagation().unwrap();
    assert_eq!(
        independent.snapshot(),
        InputDomDisposition {
            default_prevented: false,
            propagation_stopped: true,
        }
    );
    assert_eq!(next.snapshot(), InputDomDisposition::default());
}

#[test]
fn actual_core_entry_rejects_a_previously_poisoned_editor_scope() {
    use crate::*;
    let editor = Editor::builder(EditorMode::ViewAttached).build().unwrap();
    let scopes = editor.input_dom_scopes.clone();
    let failure = catch_unwind(AssertUnwindSafe(|| {
        let _lock = scopes.0.lock().unwrap();
        panic!("injected scope lock poison before Core entry");
    }));
    assert!(failure.is_err());
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    let before = core.state().to_json_string().unwrap();
    let error = core
        .apply(
            Input::Command {
                command: Command::InsertText("not admitted".into()),
                selection: ViewSelection::KeepModel,
            },
            HistoryTime(0),
        )
        .unwrap_err();
    assert!(matches!(
        error.error,
        Error::Invariant("input DOM scope lock poisoned")
    ));
    assert!(error.committed.is_empty());
    assert_eq!(error.dom_disposition, InputDomDisposition::default());
    assert_eq!(core.state().to_json_string().unwrap(), before);
}

#[test]
fn out_of_order_drop_removes_only_its_own_frame_and_releases_the_lock() {
    let scopes = InputDomScopes::default();
    let outer = scopes.enter().unwrap();
    scopes.prevent_default();
    let inner = scopes.enter().unwrap();
    let dropped = catch_unwind(AssertUnwindSafe(|| drop(outer)));
    assert_eq!(dropped.is_err(), cfg!(debug_assertions));
    scopes.stop_propagation().unwrap();
    assert_eq!(
        inner.snapshot(),
        InputDomDisposition {
            default_prevented: false,
            propagation_stopped: true,
        }
    );
    drop(inner);
    assert!(scopes.stop_propagation().is_err());
}
