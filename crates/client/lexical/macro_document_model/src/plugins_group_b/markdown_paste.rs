//! Markdown clipboard import using a registry-only parser and quote-aware insertion.
use super::*;
use crate::{
    NodeClock, NodeHost, NodeRandom,
    transformers::{self, MacroMarkdownOptions},
};
use lexical_markdown::{MarkdownOptions, Transformer, Transformers};
use lexical_rich_nodes::quote::QuoteNode;

pub(super) fn register(builder: EditorBuilder, ty: crate::EditorType) -> EditorBuilder {
    builder.plugin(MarkdownPaste(ty))
}
struct MarkdownPaste(crate::EditorType);
impl Plugin for MarkdownPaste {
    fn name(&self) -> &'static str {
        "group-b.markdown-paste"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[
            CommandRegistration {
                command: CommandKind::Paste,
                priority: CommandPriority::Low,
                placement: Placement::After,
            },
            CommandRegistration {
                command: CommandKind::InsertClipboardNodes,
                priority: CommandPriority::Low,
                placement: Placement::After,
            },
        ]
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        match command {
            Command::Paste(payload) => {
                if super::clipboard::PasteFacts::read(payload)?.plain_only
                    || payload
                        .get("application/x-lexical-editor")
                        .is_some_and(|value| !value.is_empty())
                    || payload
                        .get("text/html")
                        .is_some_and(|value| !value.is_empty())
                {
                    return Ok(Handled::No);
                }
                let Some(text) = payload.get("text/plain").filter(|text| !text.is_empty()) else {
                    return Ok(Handled::No);
                };
                if tx.selection().is_none() {
                    return Ok(Handled::No);
                }
                let mut builder = crate::editor::register_preset_nodes(
                    Editor::builder(EditorMode::Headless),
                    self.0,
                );
                if let Some(clock) = tx.try_extension::<NodeClock>() {
                    builder = builder.extension_state(clock.clone());
                }
                if let Some(random) = tx.try_extension::<NodeRandom>() {
                    builder = builder.extension_state(random.clone());
                }
                if let Some(host) = tx.try_extension::<NodeHost>() {
                    builder = builder.extension_state(host.clone());
                }
                let mut parser = builder.build().map_err(|error| {
                    Error::invariant(format!("Markdown parser registry: {error}"))
                })?;
                let options = MacroMarkdownOptions {
                    app_hostname: tx
                        .try_extension::<NodeHost>()
                        .and_then(|host| host.0.clone()),
                };
                let names = transformers::list_names("all")
                    .ok_or(Error::Invariant("Macro transformer list"))?;
                let mut callbacks = Vec::new();
                let mut preserve = false;
                for name in names {
                    let callback = transformers::transformer(name, &options).map_err(|error| {
                        Error::invariant(format!("Markdown transformer: {error}"))
                    })?;
                    let dependencies = match &callback {
                        Transformer::Element(callback) => callback.dependencies(),
                        Transformer::MultilineElement(callback) => callback.dependencies(),
                        Transformer::TextMatch(callback) => callback.dependencies(),
                        Transformer::TextFormat(_) => &[],
                    };
                    if dependencies
                        .iter()
                        .all(|name| parser.registry().get(name).is_some())
                    {
                        preserve |= *name == "PRESERVE_LINES";
                        callbacks.push(callback);
                    }
                }
                let text = transformers::protect_empty_paragraph_lines(text, preserve);
                let callbacks = Transformers::new(callbacks);
                parser.update(|tx| {
                    lexical_markdown::convert_from_markdown_string(
                        tx,
                        &text,
                        &callbacks,
                        None,
                        &MarkdownOptions {
                            list_indent: 2,
                            ..MarkdownOptions::default()
                        },
                    )
                    .map_err(|error| Error::invariant(format!("Markdown paste: {error}")))
                })?;
                let state = parser.state().to_json()?;
                let children = state
                    .root
                    .get("children")
                    .and_then(serde_json::Value::as_array)
                    .ok_or(Error::Invariant("Markdown parser root"))?;
                let nodes = lexical_rich_nodes::clipboard::generate_nodes_from_serialized_nodes(
                    tx, children,
                )?;
                lexical_rich_nodes::clipboard::insert_generated_nodes(
                    tx,
                    &nodes,
                    SelectionSlot::Active,
                )?;
                Ok(Handled::Yes)
            }
            Command::InsertClipboardNodes { nodes, selection } => {
                quote_insertion(tx, nodes, *selection)
            }
            _ => Ok(Handled::No),
        }
    }
}
fn quote_insertion(
    tx: &mut Transaction<'_>,
    nodes: &[NodeKey],
    selection: SelectionSlot,
) -> Result<Handled, Error> {
    let Some(range) = tx.selection_at(selection)?.and_then(Selection::as_range) else {
        return Ok(Handled::No);
    };
    let in_quote = |key| {
        tx.find_matching_parent(key, |state, key| state.is::<QuoteNode>(key))
            .is_some()
    };
    if !in_quote(range.anchor.key())
        || !in_quote(range.focus.key())
        || range
            .nodes(tx.view())?
            .into_iter()
            .any(|key| !in_quote(key))
    {
        return Ok(Handled::No);
    }
    if !nodes.iter().any(|key| tx.is::<Paragraph>(*key)) {
        return Ok(Handled::No);
    }
    let mut converted = Vec::new();
    for key in nodes {
        if tx.is::<Paragraph>(*key) {
            let json = tx.export_json(*key)?;
            let quote = tx.create(QuoteNode::default())?;
            tx.update_from_json(quote, &json)?;
            let children = tx.children_keys(*key)?;
            tx.append(quote, &children)?;
            converted.push(quote.key());
        } else {
            converted.push(*key);
        }
    }
    tx.insert_nodes_at(selection, &converted)?;
    Ok(Handled::Yes)
}
