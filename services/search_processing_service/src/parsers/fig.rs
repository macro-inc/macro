//! Searchable text of Figma (`.fig`) designs: one chunk per page. Long
//! pages are capped where chunks are written, as for every file type.

/// A page's searchable text.
#[derive(Debug, PartialEq, Eq)]
pub struct FigPage {
    /// The page's node id in the design (`0:1`), stable across saves, so a
    /// page keeps its chunk when the design is saved again.
    pub node_id: String,
    /// The page name, its frame names, and its text, one per line.
    pub content: String,
}

/// Decodes a design and returns each page's searchable text.
pub fn parse_fig_pages(bytes: &[u8]) -> anyhow::Result<Vec<FigPage>> {
    let doc = fig_engine::Document::open(bytes)
        .map_err(|e| anyhow::anyhow!("unable to decode the design: {e}"))?;
    Ok(fig_engine::describe::text_by_page(&doc)
        .into_iter()
        .map(|page| FigPage {
            node_id: page.id,
            content: page.text,
        })
        .collect())
}

#[cfg(test)]
mod test;
