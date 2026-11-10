use super::*;
use crate::*;
use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};
struct FailAfter(Arc<AtomicBool>);
impl Plugin for FailAfter {
    fn name(&self) -> &'static str {
        "reported-error-fixture"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[CommandRegistration {
            command: CommandKind::InsertParagraph,
            priority: CommandPriority::Normal,
            placement: Placement::After,
        }]
    }
    fn handle(&self, tx: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        let paragraph = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok(Handled::Yes)
    }
    fn after_commit(&self, _: &mut Transaction<'_>, _: &Commit) -> Result<(), Error> {
        if self.0.load(Ordering::SeqCst) {
            return Err(Error::Invariant("actual reported failure"));
        }
        Ok(())
    }
}
struct Capture(Mutex<Vec<(usize, Arc<Error>)>>);
impl FollowUpErrorObserver for Capture {
    fn reported(&self, error: &Arc<Error>, effect_index: usize) {
        self.0.lock().unwrap().push((effect_index, error.clone()));
    }
}
#[test]
fn emission_metadata_retains_original_arc_and_exact_effect_without_changing_output() {
    let enabled = Arc::new(AtomicBool::new(false));
    let editor = Editor::builder(EditorMode::Headless)
        .plugin(FailAfter(enabled.clone()))
        .build()
        .unwrap();
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    let capture = Arc::new(Capture(Mutex::new(vec![])));
    core.observe_follow_up_errors(capture.clone());
    enabled.store(true, Ordering::SeqCst);
    let output = core
        .apply(
            Input::Command {
                command: Command::InsertParagraph,
                selection: ViewSelection::KeepModel,
            },
            HistoryTime(1),
        )
        .unwrap();
    let records = capture.0.lock().unwrap();
    assert_eq!(records.len(), 1);
    let reported = output
        .commits
        .iter()
        .find_map(|commit| commit.follow_up_error.as_ref())
        .unwrap();
    assert!(Arc::ptr_eq(&records[0].1, &reported.error));
    assert!(
        matches!(&output.effects[records[0].0], Effect::FollowUpFailed { message, .. } if message.as_ref() == "actual reported failure")
    );
    assert!(!output.diff.ops.is_empty());
    assert_eq!(output.handled, Handled::Yes);
}
