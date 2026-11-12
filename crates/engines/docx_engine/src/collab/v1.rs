//! Reading the first collaborative format: the body's top-level elements
//! as XML strings keyed by the previous engine's paragraph ids, with every
//! other part verbatim (`docxBlocks`, `docxOrder`, `docxParts`).

use crate::document::Document;
use crate::error::{Error, Result};
use crate::model::block::{Block, BlockId, IdGen, Story};
use pptx_engine::zip::{WriteData, Writer};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Where the first format's shell holds the body's blocks.
pub const V1_PLACEHOLDER: &str = "<!--macro-docx-blocks-->";

/// The previous engine's namespace for its paragraph ids.
const POWERTOOLS_NS: &str = "http://powertools.codeplex.com/2011";

/// A document in the first collaborative format.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct V1State {
    /// Block ids in document order.
    pub order: Vec<String>,
    /// Block id → element XML.
    pub blocks: BTreeMap<String, String>,
    /// Part name (no leading slash) → content (`b64:` for binary parts).
    pub parts: BTreeMap<String, String>,
}

/// Removes attributes (and declarations) of the namespace `uri` from every
/// start tag of `xml`.
fn strip_namespace(xml: &str, uri: &str) -> String {
    // Prefixes bound to the namespace anywhere in the text.
    let mut prefixes: Vec<String> = Vec::new();
    let needle = format!("=\"{uri}\"");
    let mut search = 0;
    while let Some(i) = xml[search..].find(&needle) {
        let at = search + i;
        if let Some(start) = xml[..at].rfind("xmlns:") {
            let p = &xml[start + 6..at];
            if !p.is_empty()
                && p.chars()
                    .all(|c| c.is_alphanumeric() || c == '_' || c == '-' || c == '.')
                && !prefixes.iter().any(|x| x == p)
            {
                prefixes.push(p.to_owned());
            }
        }
        search = at + needle.len();
    }
    if prefixes.is_empty() {
        return xml.to_owned();
    }
    let mut out = String::with_capacity(xml.len());
    let bytes = xml.as_bytes();
    let mut i = 0;
    while i < xml.len() {
        // Copy text up to the next tag unchanged.
        let Some(lt) = xml[i..].find('<').map(|k| i + k) else {
            out.push_str(&xml[i..]);
            break;
        };
        out.push_str(&xml[i..lt]);
        // Comments, CDATA and declarations pass through.
        if xml[lt..].starts_with("<!--")
            || xml[lt..].starts_with("<![CDATA[")
            || xml[lt..].starts_with("<?")
            || xml[lt..].starts_with("</")
        {
            let end = if xml[lt..].starts_with("<!--") {
                xml[lt..].find("-->").map(|k| lt + k + 3)
            } else if xml[lt..].starts_with("<![CDATA[") {
                xml[lt..].find("]]>").map(|k| lt + k + 3)
            } else {
                xml[lt..].find('>').map(|k| lt + k + 1)
            }
            .unwrap_or(xml.len());
            out.push_str(&xml[lt..end]);
            i = end;
            continue;
        }
        // A start tag: copy it attribute by attribute.
        let mut j = lt + 1;
        while j < xml.len()
            && !bytes[j].is_ascii_whitespace()
            && bytes[j] != b'>'
            && bytes[j] != b'/'
        {
            j += 1;
        }
        out.push_str(&xml[lt..j]);
        loop {
            let ws_start = j;
            while j < xml.len() && bytes[j].is_ascii_whitespace() {
                j += 1;
            }
            if j >= xml.len() || bytes[j] == b'>' || bytes[j] == b'/' {
                out.push_str(&xml[ws_start..j]);
                break;
            }
            let name_start = j;
            while j < xml.len()
                && bytes[j] != b'='
                && !bytes[j].is_ascii_whitespace()
                && bytes[j] != b'>'
            {
                j += 1;
            }
            let name = &xml[name_start..j];
            while j < xml.len() && bytes[j] != b'"' && bytes[j] != b'\'' && bytes[j] != b'>' {
                j += 1;
            }
            if j >= xml.len() || bytes[j] == b'>' {
                out.push_str(&xml[ws_start..j]);
                break;
            }
            let quote = bytes[j];
            let mut k = j + 1;
            while k < xml.len() && bytes[k] != quote {
                k += 1;
            }
            let end = (k + 1).min(xml.len());
            let drop = prefixes.iter().any(|p| {
                name == format!("xmlns:{p}")
                    || name
                        .strip_prefix(p.as_str())
                        .is_some_and(|r| r.starts_with(':'))
            });
            if name.ends_with(":Ignorable") && end > j + 1 {
                // A prefix listed as ignorable must stay declared.
                let value = &xml[j + 1..end - 1];
                let kept: Vec<&str> = value
                    .split_whitespace()
                    .filter(|t| !prefixes.iter().any(|p| p == t))
                    .collect();
                if !kept.is_empty() {
                    out.push_str(&xml[ws_start..=j]);
                    out.push_str(&kept.join(" "));
                    out.push(quote as char);
                }
            } else if !drop {
                out.push_str(&xml[ws_start..end]);
            }
            j = end;
        }
        let close = xml[j..].find('>').map_or(xml.len(), |k| j + k + 1);
        out.push_str(&xml[j..close]);
        i = close;
    }
    // Prefixes named in mc:Ignorable lists stay harmless; leave them.
    out
}

impl V1State {
    /// The package the state describes.
    fn package(&self) -> Result<Vec<u8>> {
        let shell = self
            .parts
            .get("word/document.xml")
            .ok_or_else(|| Error::Collab("the shared document has no body".into()))?;
        let body: String = self
            .order
            .iter()
            .filter_map(|id| self.blocks.get(id))
            .map(String::as_str)
            .collect();
        let document = strip_namespace(&shell.replacen(V1_PLACEHOLDER, &body, 1), POWERTOOLS_NS);
        let mut files: Vec<(String, Vec<u8>)> = Vec::new();
        for (name, value) in &self.parts {
            let bytes = if name == "word/document.xml" {
                document.clone().into_bytes()
            } else {
                match value.strip_prefix("b64:") {
                    Some(data) => {
                        use base64::Engine;
                        base64::engine::general_purpose::STANDARD
                            .decode(data)
                            .unwrap_or_default()
                    }
                    None => value.as_bytes().to_vec(),
                }
            };
            files.push((name.clone(), bytes));
        }
        // Content types first, as Office expects.
        files.sort_by_key(|(n, _)| n != "[Content_Types].xml");
        let mut w = Writer::new();
        for (name, data) in &files {
            w.add(
                name,
                WriteData::Fresh {
                    data,
                    compress: false,
                },
            )?;
        }
        Ok(w.finish()?)
    }
}

/// Renames the top-level blocks of `story` to `ids` (in order), keeping
/// sequential ids where the counts disagree.
fn adopt_ids(story: &Story, ids: &[String]) -> Story {
    let top: Vec<BlockId> = story.children(None).to_vec();
    if top.len() != ids.len() {
        return story.clone();
    }
    let rename: std::collections::HashMap<BlockId, BlockId> = top
        .iter()
        .zip(ids)
        .map(|(old, new)| (old.clone(), BlockId::new(new)))
        .collect();
    let mut out = Story::new();
    let mut blocks: Vec<Block> = story.blocks().cloned().collect();
    blocks.sort_by(|a, b| a.id.cmp(&b.id));
    for mut b in blocks {
        if let Some(n) = rename.get(&b.id) {
            b.id = n.clone();
        }
        if let Some(p) = b.parent.as_ref().and_then(|p| rename.get(p)) {
            b.parent = Some(p.clone());
        }
        out.insert(b);
    }
    out
}

impl Document {
    /// Opens a document stored in the first collaborative format. Top-level
    /// blocks keep their ids (comments are anchored to them); the previous
    /// engine's id attributes are dropped.
    pub fn from_v1(state: &V1State) -> Result<Document> {
        let bytes = state.package()?;
        let mut doc = Document::open_with_ids(bytes, IdGen::sequential())?;
        doc.body = adopt_ids(&doc.body, &state.order);
        doc.body_dirty = true;
        Ok(doc)
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn strips_the_previous_engines_ids() {
        let xml = r#"<w:p xmlns:pt14="http://powertools.codeplex.com/2011" mc:Ignorable="w14 pt14" pt14:Unid="abc" w:rsidR="1"><w:r pt14:Unid='d'><w:t>a > b</w:t></w:r><!-- pt14:Unid="x" --></w:p>"#;
        assert_eq!(
            strip_namespace(xml, POWERTOOLS_NS),
            r#"<w:p mc:Ignorable="w14" w:rsidR="1"><w:r><w:t>a > b</w:t></w:r><!-- pt14:Unid="x" --></w:p>"#
        );
    }

    #[test]
    fn opens_the_first_format_with_its_ids() {
        let ns = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main""#;
        let pt = r#"xmlns:pt14="http://powertools.codeplex.com/2011""#;
        let mut parts = BTreeMap::new();
        parts.insert(
            "[Content_Types].xml".to_owned(),
            r#"<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#.to_owned(),
        );
        parts.insert(
            "_rels/.rels".to_owned(),
            r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#.to_owned(),
        );
        parts.insert(
            "word/document.xml".to_owned(),
            format!(r#"<?xml version="1.0"?><w:document {ns} {pt}><w:body><!--macro-docx-blocks--><w:sectPr/></w:body></w:document>"#),
        );
        let mut blocks = BTreeMap::new();
        blocks.insert(
            "AAA".to_owned(),
            format!(
                r#"<w:p {ns} {pt} pt14:Unid="AAA"><w:r pt14:Unid="r1"><w:t>First</w:t></w:r></w:p>"#
            ),
        );
        blocks.insert(
            "BBB".to_owned(),
            format!(r#"<w:tbl {ns}><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"#),
        );
        let state = V1State {
            order: vec!["AAA".into(), "BBB".into()],
            blocks,
            parts,
        };
        let doc = Document::from_v1(&state).unwrap();
        let top: Vec<&str> = doc
            .body()
            .children(None)
            .iter()
            .map(|b| b.as_str())
            .collect();
        assert_eq!(top, vec!["AAA", "BBB"]);
        let first = doc.body().get(&BlockId::new("AAA")).unwrap();
        assert_eq!(first.content.text(), "First");
        assert!(!first.attrs.contains("Unid"));
        assert!(
            first.content.spans()[0]
                .attrs
                .iter()
                .all(|(k, _)| !k.contains("Unid"))
        );
        // The table's rows are its children under the adopted id.
        let rows = doc.body().children(Some(&BlockId::new("BBB")));
        assert_eq!(rows.len(), 1);
        assert!(!doc.document_xml().contains("powertools"));
    }
}
