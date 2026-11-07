//! Code block payload and structural hooks.
use lexical_model::*;
use serde::{Deserialize, Serialize};

/// Upstream `CodeNode`; syntax support and DOM state remain in the view.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeNode {
    /// Optional language; absent, null and empty strings import as absent.
    #[serde(
        default,
        deserialize_with = "super::falsy_string_as_none",
        skip_serializing_if = "Option::is_none"
    )]
    pub language: Option<String>,
    /// Optional theme, normalized like language.
    #[serde(
        default,
        deserialize_with = "super::falsy_string_as_none",
        skip_serializing_if = "Option::is_none"
    )]
    pub theme: Option<String>,
}
impl CodeNode {
    /// Stored language label.
    pub fn language(&self) -> Option<&str> {
        self.language.as_deref()
    }
    /// Stored theme label.
    pub fn theme(&self) -> Option<&str> {
        self.theme.as_deref()
    }
    /// Store a language, omitting empty strings.
    pub fn set_language(&mut self, language: Option<&str>) {
        self.language = language
            .filter(|value| !value.is_empty())
            .map(str::to_owned);
    }
    /// Store a theme, omitting empty strings.
    pub fn set_theme(&mut self, theme: Option<&str>) {
        self.theme = theme.filter(|value| !value.is_empty()).map(str::to_owned);
    }
}
impl NodeType for CodeNode {
    const TYPE: &'static str = "code";
    const HAS_LANGUAGE_FIELD: bool = true;
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for CodeNode {
    element_node_base!();
    fn can_indent(&self, _node: ElementView<'_>) -> bool {
        false
    }
    fn insert_new_after(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        selection: SelectionSlot,
        restore_selection: bool,
    ) -> Result<Option<NodeKey>, Error> {
        hooks::insert_new_after(tx, this.key(), selection, restore_selection)
    }
    fn collapse_at_start(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        _selection: SelectionSlot,
    ) -> Result<bool, Error> {
        hooks::collapse_at_start(tx, this.key())
    }
}
/// Create through the registry so configured code replacements apply.
pub fn create_code_node(
    tx: &mut Transaction<'_>,
    language: Option<&str>,
    theme: Option<&str>,
) -> crate::Result<Id<CodeNode>> {
    let mut code = CodeNode::default();
    code.set_language(language);
    code.set_theme(theme);
    Ok(tx.create(code)?)
}
/// Test CodeNode ancestry, including application subclasses.
pub fn is_code_node(state: &impl Read, key: NodeKey) -> bool {
    state.is::<CodeNode>(key)
}
/// Shared bodies for code editing hooks and subclass delegation.
pub mod hooks {
    use super::*;
    /// Leave a code block after two trailing empty lines.
    pub fn exit_code_node_on_enter(
        tx: &mut Transaction<'_>,
        selection: &RangeSelection,
    ) -> Result<Option<NodeKey>, Error> {
        let Point::Element { key, offset } = selection.anchor else {
            return Ok(None);
        };
        let size = tx.children_size(key);
        if !selection.is_collapsed() || !is_code_node(tx, key) || size < 2 || offset.0 != size {
            return Ok(None);
        }
        let children = tx.children_keys(key)?;
        if !children
            .iter()
            .rev()
            .take(2)
            .all(|child| tx.is_line_break(*child))
        {
            return Ok(None);
        }
        let paragraph = tx.create(Paragraph {})?;
        tx.splice(key, ChildIndex(size - 2), 2, &[])?;
        tx.insert_after(key, paragraph, false)?;
        tx.select_start(paragraph)?;
        Ok(Some(paragraph.key()))
    }
    /// Insert a literal line break and copy the current line's indentation.
    pub fn insert_new_after(
        tx: &mut Transaction<'_>,
        _code: NodeKey,
        slot: SelectionSlot,
        _restore_selection: bool,
    ) -> Result<Option<NodeKey>, Error> {
        let selection = tx.range_at(slot)?.clone();
        if let Some(paragraph) = exit_code_node_on_enter(tx, &selection)? {
            return Ok(Some(paragraph));
        }
        let first = if selection.is_backward(tx.view())? {
            selection.focus
        } else {
            selection.anchor
        };
        if tx.is_text(first.key()) {
            let mut cursor = Some(crate::code::first_code_node_of_line(tx, first.key()));
            let mut indentation = Vec::new();
            while let Some(node) = cursor {
                if tx.is::<Tab>(node) {
                    indentation.push(tx.create(Tab {})?.key());
                } else if crate::code::is_code_text(tx, node) {
                    let text = tx.text_content(node);
                    let size = text.len();
                    let spaces = text.bytes().take_while(|byte| *byte == b' ').count();
                    if spaces != 0 {
                        indentation.push(tx.create_text(&" ".repeat(spaces))?.key());
                    }
                    if spaces != size {
                        break;
                    }
                } else {
                    break;
                }
                cursor = tx.next_sibling(node);
            }
            let offset = selection.anchor.offset();
            let split = tx
                .text(first.key())?
                .split_text(&[Utf16Offset(offset)])?
                .first()
                .copied()
                .ok_or(Error::Invariant("code split returned no nodes"))?;
            let index = tx
                .index_within_parent(split)
                .ok_or(Error::NoParent(split))?
                .0
                + u32::from(offset != 0);
            let parent = tx.parent_or_err(first.key())?;
            let line_break = tx.create(LineBreak {})?.key();
            let mut nodes = vec![line_break];
            nodes.extend_from_slice(&indentation);
            tx.splice(parent, ChildIndex(index), 0, &nodes)?;
            if let Some(last) = indentation.last() {
                tx.select_end(*last)?;
            } else if offset == 0 {
                tx.select_previous(split, None, None)?;
            } else {
                tx.select_next(line_break, Some(Utf16Offset::ZERO), Some(Utf16Offset::ZERO))?;
            }
        } else if is_code_node(tx, first.key()) {
            let offset = selection.anchor.offset();
            let line_break = tx.create(LineBreak {})?;
            tx.splice(first.key(), ChildIndex(offset), 0, &[line_break.key()])?;
            let point = Point::element(first.key(), ChildIndex(offset + 1));
            tx.set_point_at(slot, PointRole::Anchor, point)?;
            tx.set_point_at(slot, PointRole::Focus, point)?;
        }
        Ok(None)
    }
    /// Convert a code block to a paragraph, moving every child in order.
    pub fn collapse_at_start(tx: &mut Transaction<'_>, code: NodeKey) -> Result<bool, Error> {
        let paragraph = tx.create(Paragraph {})?;
        let children = tx.children_keys(code)?;
        tx.append(paragraph, &children)?;
        tx.replace(code, paragraph, false)?;
        Ok(true)
    }
}
#[cfg(test)]
mod test;
