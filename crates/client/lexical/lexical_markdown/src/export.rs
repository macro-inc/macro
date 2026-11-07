//! Read-only markdown traversal with upstream format-stack sharing.
use crate::util::is_js_whitespace;
use crate::{state::*, util::*, *};
use lexical_model::*;
#[derive(Clone)]
struct OpenTag {
    format: TextFormat,
    tag: String,
}
/// Context passed to block and inline export callbacks.
pub struct ExportCx<'a> {
    state: StateRef<'a>,
    transformers: &'a Transformers,
    opts: &'a MarkdownOptions,
    selection: Option<&'a Selection>,
    unclosed: Vec<OpenTag>,
    unclosable: Vec<OpenTag>,
    in_text_match: bool,
}
impl<'a> ExportCx<'a> {
    /// Pending or committed read view.
    pub fn state(&self) -> StateRef<'a> {
        self.state
    }
    /// Conversion options.
    pub fn options(&self) -> &MarkdownOptions {
        self.opts
    }
    /// Explicit selection, absent for whole-document export.
    pub fn selection(&self) -> Option<&Selection> {
        self.selection
    }
    /// Export children with fresh block stacks or shared inline stacks.
    pub fn export_children(&mut self, element: NodeKey) -> Result<String> {
        if self.in_text_match {
            let previous = self.unclosable.clone();
            self.unclosable.extend(self.unclosed.clone());
            let result = self.children(element);
            self.unclosable = previous;
            result.map(|r| r.0)
        } else {
            let unclosed = std::mem::take(&mut self.unclosed);
            let unclosable = std::mem::take(&mut self.unclosable);
            let result = self.children(element);
            self.unclosed = unclosed;
            self.unclosable = unclosable;
            result.map(|r| r.0)
        }
    }
    /// Export format using the same stacks as the surrounding inline callback.
    pub fn export_format(&mut self, text_node: NodeKey, text_content: &str) -> Result<String> {
        let text = if self.selection.is_some() {
            self.selected_text(text_node)?
        } else {
            text_content.into()
        };
        self.format_text(text_node, &text)
    }
    fn selected_text(&self, node: NodeKey) -> Result<String> {
        if let Some(selection) = self.selection {
            Ok(
                lexical_rich_nodes::selection::slice_selected_text_node_content(
                    self.state, selection, node,
                )?,
            )
        } else {
            Ok(self.state.text_content(node).into_owned())
        }
    }
    fn selected(&self, node: NodeKey) -> bool {
        self.selection
            .is_none_or(|s| self.state.is_selected(node, Some(s)))
    }
    fn extract(&self, node: NodeKey) -> bool {
        self.state
            .extract_with_child(node, node, self.selection, CopyDestination::Html)
    }
    fn top(&mut self, node: NodeKey) -> Result<(Option<String>, bool)> {
        let mut include = self.selected(node);
        let multiline = self.transformers.multiline_element.clone();
        let element = self.transformers.element.clone();
        for transformer in multiline {
            if let Some(result) = transformer.export(self, node)? {
                if !include && self.state.is_element(node) {
                    include = self.children_fresh(node)?.1;
                }
                return Ok((Some(result), include));
            }
        }
        for transformer in element {
            if let Some(result) = transformer.export(self, node)? {
                if !include && self.state.is_element(node) {
                    include = self.children_fresh(node)?.1;
                }
                return Ok((Some(result), include));
            }
        }
        if self.state.is_element(node) {
            let (markdown, sub) = self.children_fresh(node)?;
            Ok((Some(markdown), include || sub))
        } else if self.state.is_decorator(node) {
            Ok((Some(self.state.text_content(node).into_owned()), include))
        } else {
            Ok((None, include))
        }
    }
    fn children_fresh(&mut self, node: NodeKey) -> Result<(String, bool)> {
        let a = std::mem::take(&mut self.unclosed);
        let b = std::mem::take(&mut self.unclosable);
        let result = self.children(node);
        self.unclosed = a;
        self.unclosable = b;
        result
    }
    fn children(&mut self, node: NodeKey) -> Result<(String, bool)> {
        let mut output = String::new();
        let mut any = false;
        for child in self.state.children_keys(node)? {
            let mut include = self.selected(child);
            let mut transformed = None;
            for transformer in self.transformers.text_match.clone() {
                let old = self.in_text_match;
                self.in_text_match = true;
                let result = transformer.export(self, child);
                self.in_text_match = old;
                if let Some(result) = result? {
                    transformed = Some(result);
                    break;
                }
            }
            if let Some(result) = transformed {
                if !include
                    && self.state.is_element(child)
                    && self.state.children(child).any(|k| self.selected(k))
                    && self.extract(child)
                {
                    include = true;
                }
                if include {
                    output.push_str(&result);
                    any = true;
                }
                continue;
            }
            if self.state.is_line_break(child) {
                if include {
                    output.push_str(&self.state.get_state(child, &HARD_LINE_BREAK_STATE)?);
                    output.push('\n');
                    any = true;
                }
            } else if self.state.is_text(child) {
                if include {
                    let text = if self.selection.is_some() {
                        self.selected_text(child)?
                    } else {
                        self.state.text_content(child).into_owned()
                    };
                    output.push_str(&self.format_text(child, &text)?);
                    any = true;
                }
            } else if self.state.is_element(child) {
                let (text, sub) = self.children(child)?;
                if !include && sub && self.extract(child) {
                    include = true;
                }
                if include || sub {
                    output.push_str(&text);
                    any = true;
                }
            } else if self.state.is_decorator(child) && include {
                output.push_str(&self.state.text_content(child));
                any = true;
            }
        }
        Ok((output, any))
    }
    fn has(&self, node: Option<NodeKey>, format: TextFormat) -> bool {
        node.is_some_and(|n| {
            self.state
                .text_data(n)
                .is_ok_and(|d| d.format.contains(format))
        })
    }
    fn check(&self, node: Option<NodeKey>, format: TextFormat) -> bool {
        self.has(node, format)
            && (format == TextFormat::CODE
                || node.is_some_and(|n| {
                    self.state
                        .text_content(n)
                        .encode_utf16()
                        .any(|c| !is_js_whitespace(c))
                }))
    }
    fn format_text(&mut self, node: NodeKey, text: &str) -> Result<String> {
        let code = self.has(Some(node), TextFormat::CODE);
        let mut escaped = String::new();
        for c in text.chars() {
            if !code
                && (matches!(c, '*' | '_' | '`' | '~')
                    || c == '\\' && !self.opts.should_preserve_new_lines)
            {
                escaped.push('\\');
            }
            escaped.push(c);
        }
        let rest = js_trim_start(&escaped);
        let lead = &escaped[..escaped.len() - rest.len()];
        let mid = js_trim_end(rest);
        let trail = &rest[mid.len()..];
        let prev = self
            .state
            .prev_sibling(node)
            .filter(|k| self.state.is_text(*k));
        let next = self
            .state
            .next_sibling(node)
            .filter(|k| self.state.is_text(*k));
        let mut opening = String::new();
        let mut before = String::new();
        let mut after = String::new();
        let mut applied = TextFormat::empty();
        for index in &self.transformers.export_text_format {
            let t = &self.transformers.text_format[*index];
            let format = t.format[0].flag();
            if self.check(Some(node), format) && !applied.contains(format) {
                applied.insert(format);
                if !self.check(prev, format) || !self.unclosed.iter().any(|o| o.tag == t.tag) {
                    self.unclosed.push(OpenTag {
                        format,
                        tag: t.tag.to_string(),
                    });
                    opening.push_str(&t.tag);
                }
            }
        }
        for i in 0..self.unclosed.len() {
            let has = self.has(Some(node), self.unclosed[i].format);
            let next_has = self.has(next, self.unclosed[i].format);
            if has && next_has {
                continue;
            }
            let mut copy = self.unclosed.clone();
            while copy.len() > i {
                if let Some(tag) = copy.pop() {
                    if self.unclosable.iter().any(|o| o.tag == tag.tag) {
                        continue;
                    }
                    if !has {
                        before.push_str(&tag.tag);
                    } else if !next_has {
                        after.push_str(&tag.tag);
                    }
                    self.unclosed.pop();
                }
            }
            break;
        }
        if mid.is_empty() && !code {
            Ok(before + &escaped)
        } else {
            Ok(before + lead + &opening + mid + &after + trail)
        }
    }
}
/// Export a committed state or transaction read view.
pub fn convert_to_markdown_string(
    state: &impl Read,
    transformers: &Transformers,
    node: Option<NodeKey>,
    opts: &MarkdownOptions,
) -> Result<String> {
    export(
        state.view(),
        transformers,
        node.unwrap_or(NodeKey::ROOT),
        opts,
        None,
    )
}
/// Export an explicit selection; absent/collapsed selections produce no markdown.
pub fn convert_selection_to_markdown_string(
    state: &impl Read,
    transformers: &Transformers,
    selection: Option<&Selection>,
    opts: &MarkdownOptions,
) -> Result<String> {
    opts.validate()?;
    if selection.is_none_or(|s| matches!(s,Selection::Range(r) if r.is_collapsed())) {
        return Ok(String::new());
    }
    export(state.view(), transformers, NodeKey::ROOT, opts, selection)
}
fn export(
    state: StateRef<'_>,
    transformers: &Transformers,
    root: NodeKey,
    opts: &MarkdownOptions,
    selection: Option<&Selection>,
) -> Result<String> {
    opts.validate()?;
    let mut cx = ExportCx {
        state,
        transformers,
        opts,
        selection,
        unclosed: Vec::new(),
        unclosable: Vec::new(),
        in_text_match: false,
    };
    let children = state.children_keys(root)?;
    let mut output = Vec::new();
    for (i, &child) in children.iter().enumerate() {
        let (result, include) = cx.top(child)?;
        if include && let Some(mut result) = result {
            if !opts.should_preserve_new_lines
                && i > 0
                && !is_empty_paragraph(state, child)
                && !is_empty_paragraph(state, children[i - 1])
            {
                result.insert(0, '\n');
            }
            output.push(result);
        }
    }
    Ok(output.join("\n"))
}
#[cfg(test)]
mod test;
