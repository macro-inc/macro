//! Explicit native catalog entries; foreign metadata always takes the JS path.
use lexical_model::{EditorBuilder, Error};
use lexical_rich_nodes::{code, hashtag, heading, link, list, mark, overflow, quote, table};

pub(super) fn register(builder: EditorBuilder, name: &str) -> Result<EditorBuilder, Error> {
    Ok(match name {
        "heading" => builder.node::<heading::HeadingNode>(),
        "quote" => builder.node::<quote::QuoteNode>(),
        "hashtag" => builder.node::<hashtag::HashtagNode>(),
        "overflow" => builder.node::<overflow::OverflowNode>(),
        "list" => builder.node::<list::ListNode>(),
        "listitem" => builder.node::<list::ListItemNode>(),
        "link" => builder.node::<link::LinkNode>(),
        "autolink" => builder.node::<link::AutoLinkNode>(),
        "code" => builder.node::<code::CodeNode>(),
        "code-highlight" => builder.node::<code::CodeHighlightNode>(),
        "mark" => builder.node::<mark::MarkNode>(),
        "table" => builder.node::<table::TableNode>(),
        "tablerow" => builder.node::<table::TableRowNode>(),
        "tablecell" => builder.node::<table::TableCellNode>(),
        _ => return Err(Error::invariant(format!("unknown native node type {name}"))),
    })
}
