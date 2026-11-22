//! Equation creation through the active model selection.
use super::*;
use crate::nodes::{Maybe, create_equation_node};

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct EquationInsert {
    equation: String,
    inline: bool,
}

static INSERT: CommandKey<EquationInsert> = CommandKey::new("group-b.equation-insert");

pub(super) fn decode(name: &str, json: &str) -> Result<Option<Command>, Error> {
    if name != INSERT.name() {
        return Ok(None);
    }
    let fields: serde_json::Map<String, serde_json::Value> = serde_json::from_str(json)?;
    let payload = serde_json::from_value(serde_json::Value::Object(fields))?;
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &INSERT, payload,
    ))))
}

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(EquationInsertion)
}

static COMMANDS: [CommandRegistration; 1] = [CommandRegistration {
    command: CommandKind::Extension(&INSERT),
    priority: CommandPriority::Normal,
    placement: Placement::After,
}];

struct EquationInsertion;
impl Plugin for EquationInsertion {
    fn name(&self) -> &'static str {
        "group-b.equation-insert"
    }

    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }

    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        let Some(payload) = command.payload(&INSERT) else {
            return Ok(Handled::No);
        };
        let node = create_equation_node(
            tx,
            Maybe::Value(payload.equation.clone()),
            Some(payload.inline),
        )?;
        tx.insert_nodes_at_selection(&[node.key()])?;
        Ok(Handled::Yes)
    }
}

#[cfg(test)]
#[path = "equation_insert_test.rs"]
mod test;
