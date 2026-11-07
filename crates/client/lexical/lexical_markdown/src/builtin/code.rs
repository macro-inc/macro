//! Upstream fenced-code transformer; code content stays plain and un-tokenized.
use crate::{matcher::*, patterns, state::*, util::*, *};
use lexical_model::*;
use lexical_rich_nodes::code::*;
/// Fenced code block transformer.
#[derive(Debug)]
pub struct Code;
/// Shared fenced code block transformer.
pub static CODE: Code = Code;
impl MultilineElementTransformer for Code {
    fn dependencies(&self) -> &[&'static str] {
        &["code"]
    }
    fn reg_exp_start(&self) -> &dyn Matcher {
        &*patterns::CODE_START
    }
    fn reg_exp_end(&self) -> RegExpEnd<'_> {
        RegExpEnd::Optional(&*patterns::CODE_END)
    }
    fn export(&self, cx: &mut ExportCx<'_>, node: NodeKey) -> Result<Option<String>> {
        let Some(code) = cx.state().get::<CodeNode>(node).cloned() else {
            return Ok(None);
        };
        let text = cx.state().text_content(node);
        let mut fence = cx.state().get_state(node, &CODE_FENCE_STATE)?;
        if text.contains(&fence) {
            let longest = text.split(|c| c != '`').map(str::len).max().unwrap_or(0);
            if longest >= 3 {
                fence = "`".repeat(longest + 1);
            }
        }
        Ok(Some(format!(
            "{fence}{}{}\n{fence}",
            code.language().unwrap_or(""),
            if text.is_empty() {
                String::new()
            } else {
                format!("\n{text}")
            }
        )))
    }
    fn handle_import_after_start_match(
        &self,
        tx: &mut Transaction<'_>,
        opts: &MarkdownOptions,
        lines: &[String],
        root: NodeKey,
        start_line_index: usize,
        start_match: &Match,
    ) -> Result<AfterStartMatch> {
        let line = lines
            .get(start_line_index)
            .ok_or(crate::Error::InvalidArgument("code start line"))?;
        let fence = start_match.get(1).unwrap_or("```");
        let fence_length = len(js_trim(fence));
        let after = slice(
            line,
            start_match.index.get() as usize + len(fence),
            len(line),
        );
        let trailing = after.bytes().rev().take_while(|c| *c == b'`').count();
        if trailing >= fence_length {
            let content = slice(&after, 0, len(&after) - trailing);
            let mut fake = start_match.clone();
            fake.set(2, Some(String::new()));
            let end = Match::new(
                Utf16Offset((len(&after) - trailing) as u32),
                after.as_str(),
                vec![Some("`".repeat(trailing))],
            )?;
            self.replace(
                tx,
                opts,
                root,
                None,
                &fake,
                Some(&end),
                Some(vec![content]),
                true,
            )?;
            return Ok(AfterStartMatch::Done {
                imported: true,
                last_line: start_line_index,
            });
        }
        for (i, end_line) in lines.iter().enumerate().skip(start_line_index + 1) {
            let ticks = end_line.trim_start_matches([' ', '\t']);
            if ticks.len() >= fence_length && ticks.bytes().all(|b| b == b'`') {
                let mut between = lines[start_line_index + 1..i].to_vec();
                let after_full = slice(line, start_match.full_len16() as usize, len(line));
                if !after_full.is_empty() {
                    between.insert(0, after_full);
                }
                let end = Match::new(
                    Utf16Offset::ZERO,
                    end_line.as_str(),
                    vec![Some(end_line.clone())],
                )?;
                self.replace(
                    tx,
                    opts,
                    root,
                    None,
                    start_match,
                    Some(&end),
                    Some(between),
                    true,
                )?;
                return Ok(AfterStartMatch::Done {
                    imported: true,
                    last_line: i,
                });
            }
        }
        let mut between = lines[start_line_index + 1..].to_vec();
        let after_full = slice(line, start_match.full_len16() as usize, len(line));
        if !after_full.is_empty() {
            between.insert(0, after_full);
        }
        self.replace(tx, opts, root, None, start_match, None, Some(between), true)?;
        Ok(AfterStartMatch::Done {
            imported: true,
            last_line: lines.len() - 1,
        })
    }
    fn replace(
        &self,
        tx: &mut Transaction<'_>,
        _: &MarkdownOptions,
        root: NodeKey,
        children: Option<&[NodeKey]>,
        start: &Match,
        end: Option<&Match>,
        lines: Option<Vec<String>>,
        is_import: bool,
    ) -> Result<ReplaceResult> {
        let language = start.get(2).filter(|s| !s.is_empty());
        if let Some(children) = children {
            let code = create_code_node(tx, language, None)?;
            return super::block::create_block(tx, code.key(), root, children, is_import);
        }
        if let Some(mut lines) = lines {
            let code = create_code_node(tx, language, None)?;
            let text = if lines.len() == 1 {
                if end.is_none() {
                    lines[0].strip_prefix(' ').unwrap_or(&lines[0]).to_owned()
                } else {
                    lines[0].clone()
                }
            } else {
                if let Some(first) = lines.first() {
                    if js_trim(first).is_empty() {
                        lines.remove(0);
                    } else if let Some(stripped) = first.strip_prefix(' ') {
                        lines[0] = stripped.into();
                    }
                }
                while lines.last().is_some_and(|s| s.is_empty()) {
                    lines.pop();
                }
                lines.join("\n")
            };
            tx.set_state(
                code,
                &CODE_FENCE_STATE,
                js_trim(start.get(1).unwrap_or("```")).to_owned(),
            )?;
            let text = tx.create_text(&text)?;
            tx.append(code, &[text.key()])?;
            tx.append(root, &[code.key()])?;
        }
        Ok(ReplaceResult::Handled)
    }
}
#[cfg(test)]
mod test;
