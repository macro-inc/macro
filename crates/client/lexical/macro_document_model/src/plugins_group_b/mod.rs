//! Structure, list, table, media, clipboard and link model plugins.
use lexical_model::*;

mod structure;

/// Surface block conversion supported by the node-transform plugin.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BlockKind {
    /// Plain paragraph.
    Paragraph,
    /// First heading level.
    Heading1,
    /// Second heading level.
    Heading2,
    /// Third heading level.
    Heading3,
    /// Block quote.
    Quote,
    /// Source code block, respecting the preset replacement.
    Code,
    /// Bullet list.
    Bullet,
    /// Numbered list.
    Number,
    /// Checklist.
    Check,
}
/// Convert the active forward-normalized range without changing its direction.
pub static NODE_TRANSFORM: CommandKey<BlockKind> = CommandKey::new("group-b.node-transform");

/// Register Group B policy for a surface; registry-only editors stay unchanged.
pub fn register(builder: EditorBuilder, ty: crate::EditorType) -> EditorBuilder {
    if ty == crate::EditorType::Title {
        return structure::single_line(builder);
    }
    if ty == crate::EditorType::PlainText {
        return builder;
    }
    let builder = lexical_rich_nodes::list::register_list(
        builder,
        lexical_rich_nodes::list::RegisterListOptions::default(),
    );
    let builder =
        lexical_rich_nodes::normalize_triple_click::register_normalize_triple_click(builder);
    structure::register(builder)
}

#[cfg(test)]
mod test;
