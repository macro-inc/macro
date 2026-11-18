//! Source pinnedPropertiesPlugin: pinned property IDs stored on the root.
use super::*;
use serde_json::{Value, json};
use std::sync::Arc;

/// Source `createState('pinnedPropertyIds')`: string array entries only.
/// Each parsed value is a fresh array, so only an absent key equals the
/// default under Lexical's `Object.is` export comparison.
static PINNED_PROPERTY_IDS: StateKey<Arc<[String]>> =
    StateKey::new("pinnedPropertyIds", |value| match value {
        Some(Value::Array(ids)) => ids
            .iter()
            .filter_map(|id| id.as_str().map(str::to_owned))
            .collect(),
        _ => Arc::from([]),
    });

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Operation {
    id: String,
    pin: bool,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    operations: Vec<Operation>,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {}

static UPDATE: CommandKey<Input> = CommandKey::new("group-b.pinned-properties");

pub(super) fn decode(name: &str, json: &str) -> Result<Option<Command>, Error> {
    if name != UPDATE.name() {
        return Ok(None);
    }
    let value: Value = serde_json::from_str(json)?;
    if !value.is_object() {
        return Err(Error::Invariant("pinned properties object payload"));
    }
    // Serde also accepts positional sequences for structs; admit objects only.
    let entries = value.get("operations").and_then(Value::as_array);
    if !entries.is_some_and(|entries| entries.iter().all(Value::is_object)) {
        return Err(Error::Invariant(
            "pinned property operations must be objects",
        ));
    }
    let input: Input = serde_json::from_value(value)?;
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &UPDATE, input,
    ))))
}

/// Read the stored pins: `null` while the root has never stored the key.
pub(super) fn query(name: &str, data: &Value, state: &EditorState) -> Result<Option<Value>, Error> {
    if name != UPDATE.name() {
        return Ok(None);
    }
    if !data.is_object() {
        return Err(Error::Invariant(
            "pinned properties request must be an object",
        ));
    }
    let _: Request = serde_json::from_value(data.clone())?;
    let ids = state
        .view()
        .get_state(NodeKey::ROOT, &PINNED_PROPERTY_IDS)?;
    let stored = !PINNED_PROPERTY_IDS.is_equal(&ids, PINNED_PROPERTY_IDS.default_value());
    Ok(Some(json!({ "ids": stored.then(|| ids.to_vec()) })))
}

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(PinnedProperties)
}

struct PinnedProperties;

impl Plugin for PinnedProperties {
    fn name(&self) -> &'static str {
        "group-b.pinned-properties"
    }

    fn commands(&self) -> &[CommandRegistration] {
        const COMMANDS: &[CommandRegistration] = &[CommandRegistration {
            command: CommandKind::Extension(&UPDATE),
            priority: CommandPriority::Editor,
            placement: Placement::After,
        }];
        COMMANDS
    }

    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(extension) = command else {
            return Ok(Handled::No);
        };
        let Some(input) = extension.payload(&UPDATE) else {
            return Ok(Handled::No);
        };
        // Source ADD/REMOVE_PINNED_PROPERTY_COMMAND, dispatched in order inside
        // one update: add skips a present ID, remove always stores a new array.
        for Operation { id, pin } in &input.operations {
            let current = tx.get_state(NodeKey::ROOT, &PINNED_PROPERTY_IDS)?;
            if *pin {
                if current.contains(id) {
                    continue;
                }
                let next: Arc<[String]> = current.iter().chain([id]).cloned().collect();
                tx.set_state(NodeKey::ROOT, &PINNED_PROPERTY_IDS, next)?;
            } else {
                let next: Arc<[String]> =
                    current.iter().filter(|kept| *kept != id).cloned().collect();
                tx.set_state(NodeKey::ROOT, &PINNED_PROPERTY_IDS, next)?;
            }
        }
        Ok(Handled::Yes)
    }
}

#[cfg(test)]
mod test;
