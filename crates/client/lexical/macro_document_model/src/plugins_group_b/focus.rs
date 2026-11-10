//! Atomic exterior-focus policy; browser focus remains with the host.
use super::*;

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct FocusEnd {}
static FOCUS_END: CommandKey<()> = CommandKey::new("group-b.focus-end");

pub(super) fn decode(name: &str, json: &str) -> Result<Option<Command>, Error> {
    if name != FOCUS_END.name() {
        return Ok(None);
    }
    let _: FocusEnd = serde_json::from_str(json)?;
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &FOCUS_END,
        (),
    ))))
}
pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(ExteriorFocus)
}
struct ExteriorFocus;
impl Plugin for ExteriorFocus {
    fn name(&self) -> &'static str {
        "group-b.exterior-focus"
    }
    fn commands(&self) -> &[CommandRegistration] {
        const COMMANDS: &[CommandRegistration] = &[CommandRegistration {
            command: CommandKind::Extension(&FOCUS_END),
            priority: CommandPriority::Editor,
            placement: Placement::After,
        }];
        COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        if !matches!(command, Command::Extension(extension) if extension.payload(&FOCUS_END).is_some())
        {
            return Ok(Handled::No);
        }
        let Some(last) = tx.last_child(NodeKey::ROOT) else {
            return Ok(Handled::Yes);
        };
        if tx.view().type_name(last)? != Paragraph::TYPE || !tx.text_content(last).is_empty() {
            let paragraph = tx.create(Paragraph::default())?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        }
        tx.select_end(NodeKey::ROOT)?;
        Ok(Handled::Yes)
    }
}
#[cfg(test)]
mod test;
