//! Host model-selection command for headless sessions; it changes no document content.
use lexical_model::*;

pub(crate) static MODEL_SELECTION: CommandKey<RangeSelection> =
    CommandKey::new("sim-model-selection");
pub(crate) const LOCAL_COMMANDS: &[CommandKind] = &[CommandKind::Extension(&MODEL_SELECTION)];
struct ModelSelection;
impl Plugin for ModelSelection {
    fn name(&self) -> &'static str {
        "sim-model-selection"
    }
    fn commands(&self) -> &[CommandRegistration] {
        static COMMANDS: [CommandRegistration; 1] = [CommandRegistration {
            command: CommandKind::Extension(&MODEL_SELECTION),
            priority: CommandPriority::Critical,
            placement: Placement::Before,
        }];
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        let Some(range) = command.payload(&MODEL_SELECTION) else {
            return Ok(Handled::No);
        };
        tx.set_selection(Some(Selection::Range(range.clone())))?;
        Ok(Handled::Yes)
    }
}
pub(crate) fn builder(mode: EditorMode, peer: u64) -> EditorBuilder {
    document_session::default_editor_builder(mode, peer).plugin(ModelSelection)
}
