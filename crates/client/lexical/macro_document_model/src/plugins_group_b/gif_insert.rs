//! GIF images use the Source picker selection and list-splitting policy.
use super::*;
use crate::nodes::{CreateMedia, create_image_node, js_round};

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct RangeStyle {
    format: u32,
    style: String,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct GifInsert {
    static_file_id: String,
    url: String,
    title: String,
    width: f64,
    height: f64,
    // Captured with the same Source range points and generation envelope.
    #[serde(default)]
    range_style: Option<RangeStyle>,
}

static INSERT: CommandKey<GifInsert> = CommandKey::new("group-b.gif-insert");

pub(super) fn decode(name: &str, json: &str) -> Result<Option<Command>, Error> {
    if name != INSERT.name() {
        return Ok(None);
    }
    let fields: serde_json::Map<String, serde_json::Value> = serde_json::from_str(json)?;
    if fields
        .get("range_style")
        .is_some_and(|value| !value.is_object())
    {
        return Err(Error::Invariant(
            "GIF range typing attributes must be an object",
        ));
    }
    let payload = serde_json::from_value(serde_json::Value::Object(fields))?;
    Ok(Some(Command::Extension(ExtensionCommand::new(
        &INSERT, payload,
    ))))
}

pub(super) fn register(builder: EditorBuilder) -> EditorBuilder {
    builder.plugin(GifInsertion)
}

static COMMANDS: [CommandRegistration; 1] = [CommandRegistration {
    command: CommandKind::Extension(&INSERT),
    priority: CommandPriority::Normal,
    placement: Placement::After,
}];

struct GifInsertion;
impl Plugin for GifInsertion {
    fn name(&self) -> &'static str {
        "group-b.gif-insert"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        let Some(gif) = command.payload(&INSERT) else {
            return Ok(Handled::No);
        };
        if tx.selection().is_none() {
            tx.select_end(NodeKey::ROOT)?;
        }
        if let Some(style) = &gif.range_style
            && tx
                .selection()
                .is_some_and(|selection| selection.as_range().is_some())
        {
            tx.set_selection_format(TextFormat::from_bits_retain(style.format))?;
            tx.set_selection_style(&style.style)?;
        }
        let width = gif.width.min(400.0);
        let height = js_round((width / gif.width) * gif.height);
        let image = create_image_node(
            tx,
            CreateMedia {
                src_type: "sfs".into(),
                id: Some(gif.static_file_id.clone()),
                url: Some(gif.url.clone()),
                width: Some(gif.width),
                height: Some(gif.height),
                constrained_width: Some(width),
                constrained_height: Some(height),
                scale: None,
            },
            Some(gif.title.clone()),
        )?;
        super::list_insert::insert_and_split_list_select_next(tx, &[image.key()])?;
        // Source calls onInserted even when a NodeSelection attaches no image.
        // This completion signal does not prove attachment or file references.
        Ok(Handled::Yes)
    }
}

#[cfg(test)]
#[path = "gif_insert_test.rs"]
mod test;
