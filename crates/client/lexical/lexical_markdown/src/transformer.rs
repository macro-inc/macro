//! Four upstream transformer contracts and their ordered registry.
use crate::{matcher::*, *};
use lexical_model::*;
use std::{borrow::Cow, sync::Arc};
/// Only explicit false declines an upstream replacement.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReplaceResult {
    /// void or true.
    Handled,
    /// false.
    NotHandled,
}
/// Block transformer.
pub trait ElementTransformer: Send + Sync + std::fmt::Debug {
    /// Required registered TYPE names.
    fn dependencies(&self) -> &[&'static str];
    /// Return None to try the next transformer.
    fn export(&self, cx: &mut ExportCx<'_>, node: NodeKey) -> Result<Option<String>>;
    /// Original line prefix matcher.
    fn reg_exp(&self) -> &dyn Matcher;
    /// Replace a paragraph and its children.
    fn replace(
        &self,
        tx: &mut Transaction<'_>,
        opts: &MarkdownOptions,
        parent: NodeKey,
        children: &[NodeKey],
        m: &Match,
        is_import: bool,
    ) -> Result<ReplaceResult>;
    /// Whether Enter may trigger this block.
    fn trigger_on_enter(&self) -> bool {
        false
    }
}
/// Multiline terminator semantics.
pub enum RegExpEnd<'a> {
    /// Absent, runs to document end.
    None,
    /// Must find a terminator.
    Required(&'a dyn Matcher),
    /// End may be omitted.
    Optional(&'a dyn Matcher),
}
/// Custom import hook result.
pub enum AfterStartMatch {
    /// Use normal end search.
    Default,
    /// Try the next transformer.
    Skip,
    /// Import result and last consumed line.
    Done {
        /// Whether consumed.
        imported: bool,
        /// Final line index.
        last_line: usize,
    },
}
/// Multiline block transformer.
pub trait MultilineElementTransformer: Send + Sync + std::fmt::Debug {
    /// Required registered TYPE names.
    fn dependencies(&self) -> &[&'static str];
    /// Optional block export.
    fn export(&self, _cx: &mut ExportCx<'_>, _node: NodeKey) -> Result<Option<String>> {
        Ok(None)
    }
    /// Custom start-match handling.
    fn handle_import_after_start_match(
        &self,
        _tx: &mut Transaction<'_>,
        _opts: &MarkdownOptions,
        _lines: &[String],
        _root: NodeKey,
        _start_line_index: usize,
        _start_match: &Match,
    ) -> Result<AfterStartMatch> {
        Ok(AfterStartMatch::Default)
    }
    /// Start matcher.
    fn reg_exp_start(&self) -> &dyn Matcher;
    /// End matcher, with required/optional semantics.
    fn reg_exp_end(&self) -> RegExpEnd<'_> {
        RegExpEnd::None
    }
    /// Import has lines and no children; shortcuts have children and no lines.
    #[expect(
        clippy::too_many_arguments,
        reason = "Pinned upstream multiline transformer callback signature"
    )]
    fn replace(
        &self,
        tx: &mut Transaction<'_>,
        opts: &MarkdownOptions,
        root: NodeKey,
        children: Option<&[NodeKey]>,
        start_match: &Match,
        end_match: Option<&Match>,
        lines_in_between: Option<Vec<String>>,
        is_import: bool,
    ) -> Result<ReplaceResult>;
}
/// Delimited inline text formats, in toggle order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TextFormatTransformer {
    /// Ordered format bits.
    pub format: Cow<'static, [TextFormatType]>,
    /// Delimiter string.
    pub tag: Cow<'static, str>,
    /// Default true, matching undefined upstream.
    pub intraword: bool,
}
/// Custom end of a text match.
pub enum EndIndex {
    /// Use full match length.
    Default,
    /// Explicit UTF-16 end.
    At(Utf16Offset),
    /// Reject this match.
    Reject,
}
/// Inline structural transformer.
pub trait TextMatchTransformer: Send + Sync + std::fmt::Debug {
    /// Required registered TYPE names.
    fn dependencies(&self) -> &[&'static str];
    /// Optional export before ordinary children.
    fn export(&self, _cx: &mut ExportCx<'_>, _node: NodeKey) -> Result<Option<String>> {
        Ok(None)
    }
    /// Absent matcher skips import.
    fn import_reg_exp(&self) -> Option<&dyn Matcher> {
        None
    }
    /// Shortcut matcher.
    fn reg_exp(&self) -> &dyn Matcher;
    /// Whether a replacement callback exists.
    fn has_replace(&self) -> bool {
        true
    }
    /// Return the text to recursively process, if any.
    fn replace(
        &self,
        tx: &mut Transaction<'_>,
        node: NodeKey,
        m: &Match,
    ) -> Result<Option<NodeKey>>;
    /// Optional custom match end.
    fn get_end_index(&self, _tx: &Transaction<'_>, _node: NodeKey, _m: &Match) -> EndIndex {
        EndIndex::Default
    }
    /// Shortcut trigger, a single BMP character.
    fn trigger(&self) -> Option<char> {
        None
    }
}
/// One ordered transformer registration.
#[derive(Clone, Debug)]
pub enum Transformer {
    /// Block.
    Element(Arc<dyn ElementTransformer>),
    /// Multiline block.
    MultilineElement(Arc<dyn MultilineElementTransformer>),
    /// Delimited format.
    TextFormat(TextFormatTransformer),
    /// Structural inline.
    TextMatch(Arc<dyn TextMatchTransformer>),
}
/// Immutable registry; indexes preserve JavaScript insertion order.
#[derive(Clone, Debug)]
pub struct Transformers {
    pub(crate) element: Vec<Arc<dyn ElementTransformer>>,
    pub(crate) multiline_element: Vec<Arc<dyn MultilineElementTransformer>>,
    pub(crate) text_format: Vec<TextFormatTransformer>,
    pub(crate) text_match: Vec<Arc<dyn TextMatchTransformer>>,
    pub(crate) format_by_tag: Vec<(String, usize)>,
    pub(crate) export_text_format: Vec<usize>,
    element_for_enter: Vec<usize>,
    format_by_trigger: Vec<(u16, Vec<usize>)>,
    match_by_trigger: Vec<(u16, Vec<usize>)>,
    composition_end_triggers: Vec<u16>,
}
impl Transformers {
    /// Build reusable indexes; a duplicate tag replaces its value in place.
    pub fn new(list: impl IntoIterator<Item = Transformer>) -> Self {
        let mut result = Self {
            element: Vec::new(),
            multiline_element: Vec::new(),
            text_format: Vec::new(),
            text_match: Vec::new(),
            format_by_tag: Vec::new(),
            export_text_format: Vec::new(),
            element_for_enter: Vec::new(),
            format_by_trigger: Vec::new(),
            match_by_trigger: Vec::new(),
            composition_end_triggers: vec![32],
        };
        for t in list {
            match t {
                Transformer::Element(t) => result.element.push(t),
                Transformer::MultilineElement(t) => result.multiline_element.push(t),
                Transformer::TextMatch(t) => result.text_match.push(t),
                Transformer::TextFormat(t) => {
                    let index = result.text_format.len();
                    if let Some((_, value)) = result
                        .format_by_tag
                        .iter_mut()
                        .find(|(tag, _)| tag == t.tag.as_ref())
                    {
                        *value = index;
                    } else {
                        result.format_by_tag.push((t.tag.to_string(), index));
                    }
                    result.text_format.push(t);
                }
            }
        }
        result.export_text_format = (0..result.text_format.len())
            .filter(|i| result.text_format[*i].format.len() == 1)
            .collect();
        result.export_text_format.sort_by_key(|i| {
            result.text_format[*i]
                .format
                .contains(&TextFormatType::Code)
        });
        result.element_for_enter = result
            .element
            .iter()
            .enumerate()
            .filter_map(|(i, t)| t.trigger_on_enter().then_some(i))
            .collect();
        for (i, t) in result.text_format.iter().enumerate() {
            if let Some(trigger) = t.tag.encode_utf16().last() {
                if let Some((_, indices)) = result
                    .format_by_trigger
                    .iter_mut()
                    .find(|(c, _)| *c == trigger)
                {
                    indices.push(i);
                } else {
                    result.format_by_trigger.push((trigger, vec![i]));
                }
                if !result.composition_end_triggers.contains(&trigger) {
                    result.composition_end_triggers.push(trigger);
                }
            }
        }
        for (i, t) in result.text_match.iter().enumerate() {
            if let Some(trigger) = t.trigger().and_then(|c| u16::try_from(c as u32).ok()) {
                if let Some((_, indices)) = result
                    .match_by_trigger
                    .iter_mut()
                    .find(|(c, _)| *c == trigger)
                {
                    indices.push(i);
                } else {
                    result.match_by_trigger.push((trigger, vec![i]));
                }
                if !result.composition_end_triggers.contains(&trigger) {
                    result.composition_end_triggers.push(trigger);
                }
            }
        }
        result
    }
    /// Element callbacks triggered by Enter, in registration order.
    pub fn element_for_enter(&self) -> impl Iterator<Item = &Arc<dyn ElementTransformer>> {
        self.element_for_enter.iter().map(|i| &self.element[*i])
    }
    /// Text formats indexed by the final UTF-16 delimiter unit.
    pub fn formats_for_trigger(
        &self,
        trigger: u16,
    ) -> impl Iterator<Item = &TextFormatTransformer> {
        self.format_by_trigger
            .iter()
            .find(|(c, _)| *c == trigger)
            .into_iter()
            .flat_map(|(_, indices)| indices)
            .map(|i| &self.text_format[*i])
    }
    /// Structural inline callbacks indexed by their trigger.
    pub fn matches_for_trigger(
        &self,
        trigger: u16,
    ) -> impl Iterator<Item = &Arc<dyn TextMatchTransformer>> {
        self.match_by_trigger
            .iter()
            .find(|(c, _)| *c == trigger)
            .into_iter()
            .flat_map(|(_, indices)| indices)
            .map(|i| &self.text_match[*i])
    }
    /// Ordered distinct composition-end trigger units, beginning with space.
    pub fn composition_end_triggers(&self) -> &[u16] {
        &self.composition_end_triggers
    }
    /// Validate every structural transformer's dependency, without panics.
    pub fn check_dependencies(&self, editor: &Editor) -> Result<()> {
        for dep in self
            .element
            .iter()
            .flat_map(|t| t.dependencies())
            .chain(self.multiline_element.iter().flat_map(|t| t.dependencies()))
            .chain(self.text_match.iter().flat_map(|t| t.dependencies()))
        {
            if editor.registry().get(dep).is_none() {
                return Err(crate::Error::MissingNode { type_name: dep });
            }
        }
        Ok(())
    }
    /// Element transformers in registration order.
    pub fn element(&self) -> &[Arc<dyn ElementTransformer>] {
        &self.element
    }
    /// Multiline transformers in registration order.
    pub fn multiline_element(&self) -> &[Arc<dyn MultilineElementTransformer>] {
        &self.multiline_element
    }
    /// Text formats in registration order.
    pub fn text_format(&self) -> &[TextFormatTransformer] {
        &self.text_format
    }
    /// Text matches in registration order.
    pub fn text_match(&self) -> &[Arc<dyn TextMatchTransformer>] {
        &self.text_match
    }
}
#[cfg(test)]
mod test;

impl Default for Transformers {
    fn default() -> Self {
        Self::new([])
    }
}
