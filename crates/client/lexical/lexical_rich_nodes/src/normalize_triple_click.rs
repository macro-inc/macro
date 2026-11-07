//! Selection-change plugin; triple-click timing and mouse events stay in the view.
use lexical_model::*;
struct NormalizeTripleClick;
impl Plugin for NormalizeTripleClick {
    fn name(&self) -> &'static str {
        "normalize-triple-click"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[CommandRegistration {
            command: CommandKind::SelectionChange,
            priority: CommandPriority::Critical,
            placement: Placement::Before,
        }]
    }
    fn handle(
        &self,
        tx: &mut Transaction<'_>,
        _: &Command,
    ) -> std::result::Result<Handled, lexical_model::Error> {
        if tx
            .selection_change_context()
            .is_some_and(|c| c.triple_click)
        {
            tx.fix_focus_overselection()?;
        }
        Ok(Handled::No)
    }
}
/// Install the critical before-listener; omitting registration disables the behavior.
pub fn register_normalize_triple_click(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(NormalizeTripleClick)
}
#[cfg(test)]
mod test;
