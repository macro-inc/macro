//! Literal ports of custom callbacks defined alongside upstream's111-row table.
use lexical_markdown::{builtin::*, matcher::*, *};
use lexical_model::*;
use lexical_rich_nodes::{code::*, link::*};
use serde_json::Value;
use std::sync::Arc;
pub fn registry(row: &Value, import: bool) -> Transformers {
    let mut list = Vec::new();
    for name in row["custom"].as_array().expect("custom") {
        list.push(match name.as_str().expect("name") {
            "MDX_HTML_TRANSFORMER" => Transformer::MultilineElement(Arc::new(Html {
                start: RegexMatcher::new(r"<(\w+)[^>]*>", "").expect("regex"),
                end: RegexMatcher::new(r"</(\w+)\s*>", "").expect("regex"),
            })),
            "CODE_TAG_COUNTER_EXAMPLE" => Transformer::MultilineElement(Arc::new(Counter {
                start: RegexMatcher::new(r"^[ \t]*```(\w+)?", "").expect("regex"),
                end: RegexMatcher::new(r"[ \t]*```$", "").expect("regex"),
            })),
            "SIMPLE_INLINE_JSX_MATCHER" => Transformer::TextMatch(Arc::new(Jsx {
                pattern: RegexMatcher::new(r"<(MyTag)\s*>", "").expect("regex"),
            })),
            "HIGHLIGHT_TEXT_MATCH_IMPORT" => Transformer::TextMatch(Arc::new(Highlight {
                pattern: RegexMatcher::new(r"\$([^$]+?)\$", "").expect("regex"),
            })),
            _ => panic!("unmapped custom transformer {name}"),
        });
    }
    list.extend(transformers());
    if import {
        list.push(Transformer::TextMatch(Arc::new(Highlight {
            pattern: RegexMatcher::new(r"\$([^$]+?)\$", "").expect("regex"),
        })));
    }
    Transformers::new(list)
}
#[derive(Debug)]
struct Highlight {
    pattern: RegexMatcher,
}
impl TextMatchTransformer for Highlight {
    fn dependencies(&self) -> &[&'static str] {
        &["link"]
    }
    fn reg_exp(&self) -> &dyn Matcher {
        Link.reg_exp()
    }
    fn import_reg_exp(&self) -> Option<&dyn Matcher> {
        Some(&self.pattern)
    }
    fn export(&self, cx: &mut ExportCx<'_>, node: NodeKey) -> Result<Option<String>> {
        Link.export(cx, node)
    }
    fn trigger(&self) -> Option<char> {
        Some(')')
    }
    fn replace(
        &self,
        tx: &mut Transaction<'_>,
        node: NodeKey,
        _: &Match,
    ) -> Result<Option<NodeKey>> {
        tx.text(node)?.toggle_format(TextFormatType::Highlight)?;
        Ok(None)
    }
}
#[derive(Debug)]
struct Jsx {
    pattern: RegexMatcher,
}
impl TextMatchTransformer for Jsx {
    fn dependencies(&self) -> &[&'static str] {
        &["link"]
    }
    fn reg_exp(&self) -> &dyn Matcher {
        &self.pattern
    }
    fn import_reg_exp(&self) -> Option<&dyn Matcher> {
        Some(&self.pattern)
    }
    fn get_end_index(&self, tx: &Transaction<'_>, node: NodeKey, m: &Match) -> EndIndex {
        let units: Vec<_> = tx.text_content(node).encode_utf16().collect();
        let start = m.end().get() as usize;
        let mut opened = 0;
        let mut end = start;
        for i in start..units.len() {
            if units[i] == 60 {
                if units.get(i + 1) == Some(&47) {
                    if opened == 0 {
                        end = i + 8;
                        break;
                    }
                    opened -= 1;
                } else {
                    opened += 1;
                }
            }
        }
        EndIndex::At(Utf16Offset(end as u32))
    }
    fn replace(
        &self,
        tx: &mut Transaction<'_>,
        node: NodeKey,
        m: &Match,
    ) -> Result<Option<NodeKey>> {
        let start = m.end().get() as usize;
        let end = m.index.get() as usize + tx.text_content_size(node).get() as usize - 8;
        let units: Vec<_> = m.input.encode_utf16().collect();
        let text = String::from_utf16_lossy(&units[start..end]);
        let link = create_link_node(tx, "simple-jsx", Default::default())?;
        let child = tx.create_text(&text)?;
        let format = tx.text_data(node)?.format;
        tx.text(child)?.set_format(format)?;
        tx.append(link, &[child.key()])?;
        tx.replace(node, link, false)?;
        Ok(None)
    }
}
#[derive(Debug)]
struct Html {
    start: RegexMatcher,
    end: RegexMatcher,
}
impl MultilineElementTransformer for Html {
    fn dependencies(&self) -> &[&'static str] {
        &["code"]
    }
    fn reg_exp_start(&self) -> &dyn Matcher {
        &self.start
    }
    fn reg_exp_end(&self) -> RegExpEnd<'_> {
        RegExpEnd::Required(&self.end)
    }
    fn export(&self, cx: &mut ExportCx<'_>, node: NodeKey) -> Result<Option<String>> {
        let text = cx.state().text_content(node);
        Ok(text.starts_with("From HTML:").then(|| {
            format!(
                "<MyComponent>{}</MyComponent>",
                text.replacen("From HTML: ", "", 1)
            )
        }))
    }
    fn replace(
        &self,
        tx: &mut Transaction<'_>,
        _: &MarkdownOptions,
        root: NodeKey,
        _: Option<&[NodeKey]>,
        start: &Match,
        _: Option<&Match>,
        lines: Option<Vec<String>>,
        _: bool,
    ) -> Result<ReplaceResult> {
        let Some(lines) = lines.filter(|_| start.get(1) == Some("MyComponent")) else {
            return Ok(ReplaceResult::NotHandled);
        };
        let code = create_code_node(tx, Some("MyComponent"), None)?;
        let text = tx.create_text(&format!("From HTML: {}", lines.join("\n")))?;
        tx.append(code, &[text.key()])?;
        tx.append(root, &[code.key()])?;
        Ok(ReplaceResult::Handled)
    }
}
#[derive(Debug)]
struct Counter {
    start: RegexMatcher,
    end: RegexMatcher,
}
impl MultilineElementTransformer for Counter {
    fn dependencies(&self) -> &[&'static str] {
        &["code"]
    }
    fn reg_exp_start(&self) -> &dyn Matcher {
        Code.reg_exp_start()
    }
    fn export(&self, cx: &mut ExportCx<'_>, node: NodeKey) -> Result<Option<String>> {
        Code.export(cx, node)
    }
    fn replace(
        &self,
        tx: &mut Transaction<'_>,
        opts: &MarkdownOptions,
        root: NodeKey,
        children: Option<&[NodeKey]>,
        start: &Match,
        end: Option<&Match>,
        lines: Option<Vec<String>>,
        import: bool,
    ) -> Result<ReplaceResult> {
        Code.replace(tx, opts, root, children, start, end, lines, import)
    }
    fn handle_import_after_start_match(
        &self,
        tx: &mut Transaction<'_>,
        opts: &MarkdownOptions,
        lines: &[String],
        root: NodeKey,
        start_index: usize,
        start: &Match,
    ) -> Result<AfterStartMatch> {
        let mut opened = 0i32;
        for i in start_index..lines.len() {
            let nested = self.start.exec(&lines[i]);
            let end = self.end.exec(&lines[i]);
            if let Some(nested) = nested {
                if end.as_ref().is_none_or(|end| nested.index < end.index) {
                    opened += 1;
                }
            }
            if end.is_some() {
                opened -= 1;
            }
            let Some(end) =
                end.filter(|end| opened <= 0 && !(i == start_index && end.index == start.index))
            else {
                continue;
            };
            let mut between = Vec::new();
            for (j, line) in lines.iter().enumerate().take(i + 1).skip(start_index) {
                let units: Vec<_> = line.encode_utf16().collect();
                let begin = if j == start_index {
                    start.full_len16() as usize
                } else {
                    0
                };
                let finish = if j == i {
                    units.len().saturating_sub(end.full_len16() as usize)
                } else {
                    units.len()
                };
                between.push(String::from_utf16_lossy(&units[begin..finish]));
            }
            if Code.replace(tx, opts, root, None, start, Some(&end), Some(between), true)?
                == ReplaceResult::Handled
            {
                return Ok(AfterStartMatch::Done {
                    imported: true,
                    last_line: i,
                });
            }
            break;
        }
        Ok(AfterStartMatch::Done {
            imported: false,
            last_line: start_index,
        })
    }
}
