//! Model half of ClickAfterLastBlockExtension; geometry and editability stay in the view.
use lexical_model::*;
/// Default predicate: decorators and shadow-root elements permit a trailing paragraph.
pub fn default_should_insert_after(view: StateRef<'_>, key: NodeKey) -> bool {
    view.is_decorator(key) || (view.is_element(key) && view.is_shadow_root(key))
}
/// Per-editor predicate, staged with other extension state.
#[derive(Clone, Copy, Debug)]
pub struct ClickAfterLastBlockConfig {
    /// Test the root's current last child when the command executes.
    pub should_insert_after: fn(StateRef<'_>, NodeKey) -> bool,
}
impl Default for ClickAfterLastBlockConfig {
    fn default() -> Self {
        Self {
            should_insert_after: default_should_insert_after,
        }
    }
}
/// Dispatched after the view claims a click below the last block.
pub static INSERT_AFTER_LAST_BLOCK: CommandKey<()> =
    CommandKey::new("click_after_last_block.insert");
static COMMANDS: [CommandRegistration; 1] = [CommandRegistration {
    command: CommandKind::Extension(&INSERT_AFTER_LAST_BLOCK),
    priority: CommandPriority::Editor,
    placement: Placement::After,
}];
struct ClickAfterLastBlock;
impl Plugin for ClickAfterLastBlock {
    fn name(&self) -> &'static str {
        "click-after-last-block"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }
    fn handle(
        &self,
        tx: &mut Transaction<'_>,
        command: &Command,
    ) -> std::result::Result<Handled, lexical_model::Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        if command.payload(&INSERT_AFTER_LAST_BLOCK).is_none() {
            return Ok(Handled::No);
        }
        let Some(last) = tx.last_child(NodeKey::ROOT) else {
            return Ok(Handled::No);
        };
        let predicate = tx
            .extension::<ClickAfterLastBlockConfig>()?
            .should_insert_after;
        if !predicate(tx.view(), last) {
            return Ok(Handled::No);
        }
        let paragraph = tx.create(Paragraph {})?;
        tx.insert_after(last, paragraph, true)?;
        tx.select_start(paragraph)?;
        Ok(Handled::Yes)
    }
}
/// Register predicate state and the typed command listener.
pub fn register_click_after_last_block(
    builder: EditorBuilder,
    config: ClickAfterLastBlockConfig,
) -> EditorBuilder {
    builder.extension_state(config).plugin(ClickAfterLastBlock)
}
#[cfg(test)]
mod test;
