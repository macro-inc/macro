//! Searchable text of Illustrator (`.ai`) documents: the layer and object
//! names and the characters of text objects, one per line, as one chunk.
//! Long text is capped where chunks are written, as for every file type.

/// Reads an Illustrator document and returns its searchable text. Files the
/// engine does not open (those saved by Illustrator 8 and earlier, which are
/// PostScript rather than PDF, and encrypted or damaged files) are errors.
pub fn parse_ai_text(bytes: &[u8]) -> anyhow::Result<String> {
    let opened = ai_engine::build::open(bytes)
        .map_err(|e| anyhow::anyhow!("unable to read the Illustrator document: {e}"))?;
    Ok(ai_engine::describe::text(&opened.document))
}

#[cfg(test)]
mod test;
