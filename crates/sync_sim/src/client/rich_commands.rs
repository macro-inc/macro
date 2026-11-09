//! Application commands call the portable rich-node operations inside real transactions.
use crate::EditorOp;
use lexical_model::*;
use lexical_rich_nodes::{code, heading, quote, selection, table};

pub(crate) static RICH_EDIT: CommandKey<EditorOp> = CommandKey::new("sim-rich-edit");
pub(crate) struct RichEdits;
impl Plugin for RichEdits {
    fn name(&self) -> &'static str {
        "sim-rich-edit"
    }
    fn commands(&self) -> &[CommandRegistration] {
        static COMMANDS: [CommandRegistration; 1] = [CommandRegistration {
            command: CommandKind::Extension(&RICH_EDIT),
            priority: CommandPriority::Editor,
            placement: Placement::After,
        }];
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        let Some(op) = command.payload(&RICH_EDIT) else {
            return Ok(Handled::No);
        };
        match op {
            EditorOp::SetBlock { kind, .. } => {
                let selection = tx.selection().cloned();
                selection::set_blocks_type_default(tx, selection.as_ref(), |tx| match kind % 6 {
                    0 => Ok(tx.create(Paragraph::default())?.key()),
                    1..=3 => {
                        let tag = match kind % 6 {
                            1 => heading::HeadingTagType::H1,
                            2 => heading::HeadingTagType::H2,
                            _ => heading::HeadingTagType::H3,
                        };
                        heading::create_heading_node(tx, tag)
                            .map(|node| node.key())
                            .map_err(model_error)
                    }
                    4 => quote::create_quote_node(tx)
                        .map(|node| node.key())
                        .map_err(model_error),
                    _ => code::create_code_node(tx, None, None)
                        .map(|node| node.key())
                        .map_err(model_error),
                })?;
                Ok(Handled::Yes)
            }
            EditorOp::PasteMarkdown { snippet, .. } => {
                let selection = tx.selection().cloned();
                let scratch = tx.create(Paragraph::default())?.key();
                let transformers =
                    macro_document_model::transformers::transformers("all", &Default::default())
                        .map_err(|error| Error::Extension(Box::new(error)))?;
                lexical_markdown::convert_from_markdown_string(
                    tx,
                    crate::markdown_snippet(*snippet),
                    &transformers,
                    Some(scratch),
                    &lexical_markdown::MarkdownOptions {
                        list_indent: 2,
                        ..Default::default()
                    },
                )
                .map_err(|error| Error::Extension(Box::new(error)))?;
                let nodes = tx.children_keys(scratch)?;
                tx.set_selection(selection)?;
                tx.insert_nodes(&nodes)?;
                Ok(Handled::Yes)
            }
            EditorOp::InsertTable { rows, cols, .. } => {
                let handled = table::commands::insert_table(
                    tx,
                    &table::commands::InsertTablePayload {
                        rows: u32::from(rows % 4 + 1),
                        columns: u32::from(cols % 4 + 1),
                        include_headers: table::IncludeHeaders::All(true),
                    },
                    false,
                )?;
                Ok(if handled { Handled::Yes } else { Handled::No })
            }
            _ => Ok(Handled::No),
        }
    }
}
fn model_error(error: lexical_rich_nodes::Error) -> Error {
    let lexical_rich_nodes::Error::Model(error) = error;
    error
}
