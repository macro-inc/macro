use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

#[test]
fn ordinary_core_forwarders_register_dispatch_and_cleanup_without_state_mutation() {
    let editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    let before = core.state().clone();
    let calls = Arc::new(AtomicUsize::new(0));
    let observed = calls.clone();
    let callback = callback(move |_| {
        observed.fetch_add(1, Ordering::SeqCst);
        Ok(Handled::Yes)
    });
    let id = core.register_command_listener(NORMAL, callback.clone());
    assert!(core.has_command_listener(&id));
    assert!(core.state().same_snapshot(&before));
    let duplicate = core.register_command_listener(NORMAL, callback);
    assert_eq!(id, duplicate);
    let output = core
        .apply(
            Input::Command {
                command: ENTER.clone(),
                selection: ViewSelection::KeepModel,
            },
            HistoryTime(1),
        )
        .unwrap();
    assert_eq!(output.handled, Handled::Yes);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    core.unregister_command_listener(&id);
    core.unregister_command_listener(&duplicate);
    assert!(!core.has_command_listener(&id));
    let output = core
        .apply(
            Input::Command {
                command: ENTER.clone(),
                selection: ViewSelection::KeepModel,
            },
            HistoryTime(2),
        )
        .unwrap();
    assert_eq!(output.handled, Handled::No);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}
