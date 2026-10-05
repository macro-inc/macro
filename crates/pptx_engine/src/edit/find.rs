//! Find and replace across the text of slide shapes, group members, and
//! table cells.
//!
//! Matching works on paragraph text as the text operations count it (a line
//! break is one character, a field its displayed text), so match positions
//! are valid [`super::TextPos`] offsets. Matches never span paragraphs.

use super::ops::CellRef;
use super::text;
use crate::error::{Error, Result};
use crate::model::presentation::Presentation;
use crate::model::shape::{c_nv_pr, sp_tree, tree_children};
use crate::xml::{NodeId, Ns, XmlDoc};
use serde::{Deserialize, Serialize};

/// How [`Presentation::find_text`] and `replaceText` match text.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct FindOptions {
    /// Match upper and lower case exactly (default: ignore case).
    pub match_case: bool,
    /// Only match whole words (no letter, digit, or `_` on either side).
    pub whole_word: bool,
}

/// One occurrence of searched text.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextMatch {
    /// Slide id.
    pub slide: u32,
    /// Shape id (the table's graphic frame for text in a cell).
    pub shape: u32,
    /// The table cell, for text in a table.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cell: Option<CellRef>,
    /// Paragraph index.
    pub paragraph: usize,
    /// Offset of the first matched character in the paragraph.
    pub start: usize,
    /// Offset just past the match.
    pub end: usize,
}

/// A text body of a slide: a shape's or a table cell's.
struct Body {
    shape: u32,
    cell: Option<CellRef>,
    body: NodeId,
}

/// Every text body of a slide part, back to front (group members in place).
fn bodies(doc: &XmlDoc) -> Vec<Body> {
    let mut out = Vec::new();
    if let Some(tree) = sp_tree(doc) {
        collect(doc, tree, &mut out);
    }
    out
}

fn collect(doc: &XmlDoc, parent: NodeId, out: &mut Vec<Body>) {
    for n in tree_children(doc, parent) {
        let id = c_nv_pr(doc, n)
            .and_then(|c| doc.attr_i64(c, "id"))
            .and_then(|id| u32::try_from(id).ok());
        match doc.local(n) {
            "grpSp" => collect(doc, n, out),
            "sp" => {
                if let (Some(shape), Some(body)) =
                    (id, doc.children(n).find(|&c| doc.local(c) == "txBody"))
                {
                    out.push(Body {
                        shape,
                        cell: None,
                        body,
                    });
                }
            }
            "graphicFrame" => {
                let (Some(shape), Some(tbl)) =
                    (id, doc.path(n, Ns::A, &["graphic", "graphicData", "tbl"]))
                else {
                    continue;
                };
                for (row, tr) in doc.children_named(tbl, Ns::A, "tr").enumerate() {
                    for (col, tc) in doc.children_named(tr, Ns::A, "tc").enumerate() {
                        // Cells merged into another show nothing.
                        let merged = ["hMerge", "vMerge"]
                            .iter()
                            .any(|a| doc.attr_bool(tc, a).unwrap_or(false));
                        if let Some(body) = doc.child(tc, Ns::A, "txBody")
                            && !merged
                        {
                            out.push(Body {
                                shape,
                                cell: Some(CellRef { row, col }),
                                body,
                            });
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

/// A character as compared without case (single-character lower case only,
/// so match lengths stay equal to the query's).
fn fold(c: char) -> char {
    let mut lower = c.to_lowercase();
    match (lower.next(), lower.next()) {
        (Some(l), None) => l,
        _ => c,
    }
}

fn is_word(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Non-overlapping occurrences of `query` in `text`, left to right.
fn occurrences(text: &[char], query: &[char], options: FindOptions) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    if query.is_empty() || query.len() > text.len() {
        return out;
    }
    let same = |a: char, b: char| {
        if options.match_case {
            a == b
        } else {
            fold(a) == fold(b)
        }
    };
    let mut i = 0;
    while i + query.len() <= text.len() {
        let end = i + query.len();
        let hit = text[i..end].iter().zip(query).all(|(&a, &b)| same(a, b))
            && (!options.whole_word
                || (i == 0 || !is_word(text[i - 1])) && text.get(end).is_none_or(|&c| !is_word(c)));
        if hit {
            out.push((i, end));
            i = end;
        } else {
            i += 1;
        }
    }
    out
}

/// The matches of one paragraph: its index and the `(start, end)` ranges.
type ParagraphMatches = (usize, Vec<(usize, usize)>);

/// The matches in each paragraph of a body.
fn body_matches(
    doc: &XmlDoc,
    body: NodeId,
    query: &[char],
    options: FindOptions,
) -> Vec<ParagraphMatches> {
    text::paragraphs(doc, body)
        .iter()
        .enumerate()
        .filter_map(|(i, &p)| {
            let chars: Vec<char> = text::para_text(doc, p).chars().collect();
            let hits = occurrences(&chars, query, options);
            (!hits.is_empty()).then_some((i, hits))
        })
        .collect()
}

impl Presentation {
    /// Every occurrence of `query` in the text of slide shapes, group members,
    /// and table cells, in slide order and back to front within a slide.
    pub fn find_text(&mut self, query: &str, options: FindOptions) -> Result<Vec<TextMatch>> {
        let query: Vec<char> = query.chars().collect();
        let mut out = Vec::new();
        if query.is_empty() {
            return Ok(out);
        }
        for entry in self.slides.clone() {
            let doc = self.xml(&entry.part)?;
            for b in bodies(&doc) {
                for (paragraph, hits) in body_matches(&doc, b.body, &query, options) {
                    out.extend(hits.into_iter().map(|(start, end)| TextMatch {
                        slide: entry.id,
                        shape: b.shape,
                        cell: b.cell,
                        paragraph,
                        start,
                        end,
                    }));
                }
            }
        }
        Ok(out)
    }
}

/// Replaces every occurrence of `query` on one slide (or all); returns the
/// number of replacements. Shapes whose text changed are queued for refit.
pub(super) fn replace_text(
    pres: &mut Presentation,
    query: &str,
    replacement: &str,
    options: FindOptions,
    slide: Option<u32>,
    refit: &mut Vec<(String, u32)>,
) -> Result<usize> {
    if query.is_empty() {
        return Err(Error::InvalidEdit("the text to find is empty".into()));
    }
    if query.contains('\n') {
        return Err(Error::InvalidEdit(
            "the text to find cannot span paragraphs".into(),
        ));
    }
    if replacement.contains(['\n', '\u{b}']) {
        return Err(Error::InvalidEdit(
            "the replacement cannot contain paragraph or line breaks".into(),
        ));
    }
    let query: Vec<char> = query.chars().collect();
    let parts: Vec<String> = match slide {
        Some(id) => vec![pres.slide_part(id)?],
        None => pres.slides.iter().map(|s| s.part.clone()).collect(),
    };
    let mut count = 0;
    for part in parts {
        let doc = pres.xml(&part)?;
        let plan: Vec<(Body, Vec<ParagraphMatches>)> = bodies(&doc)
            .into_iter()
            .filter_map(|b| {
                let hits = body_matches(&doc, b.body, &query, options);
                (!hits.is_empty()).then_some((b, hits))
            })
            .collect();
        if plan.is_empty() {
            continue;
        }
        let doc = pres.xml_mut(&part)?;
        for (b, hits) in plan {
            let paragraphs = text::paragraphs(doc, b.body);
            for (i, ranges) in hits {
                // Back to front, so earlier offsets stay valid.
                for (start, end) in ranges.into_iter().rev() {
                    if text::replace_range(doc, paragraphs[i], start, end, replacement) {
                        count += 1;
                    }
                }
            }
            if b.cell.is_none() {
                refit.push((part.clone(), b.shape));
            }
        }
    }
    Ok(count)
}

#[cfg(test)]
mod test;
