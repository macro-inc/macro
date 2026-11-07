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
