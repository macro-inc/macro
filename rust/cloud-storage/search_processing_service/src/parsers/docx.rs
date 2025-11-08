use nom::{
    IResult,
    bytes::complete::{is_not, tag},
};

/// Parses a single w:t tag and returns its content
#[allow(dead_code)]
fn parse_wt_tag(input: &str) -> IResult<&str, String> {
    let (input, _) = tag("<w:t>")(input)?;
    let (input, content) = is_not("<")(input)?;
    let (input, _) = tag("</w:t>")(input)?;
    Ok((input, content.to_string()))
}

/// Takes the document.xml docx string and returns the plain text
#[allow(dead_code)]
pub fn parse_docx(content: &str) -> anyhow::Result<String> {
    tracing::trace!("parsing docx");

    let mut result = Vec::new();
    let mut remaining = content;

    while let Some(pos) = remaining.find("<w:t>") {
        remaining = &remaining[pos..];
        if let Ok((new_remaining, content)) = parse_wt_tag(remaining) {
            result.push(content);
            remaining = new_remaining;
        } else {
            // If parsing failed, skip to next potential tag
            if let Some(skip_pos) = remaining[1..].find("<w:t>") {
                remaining = &remaining[skip_pos + 1..];
            } else {
                break;
            }
        }
    }

    if result.is_empty() {
        anyhow::bail!("No text content found in the document");
    }

    Ok(result.join(" "))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_docx() -> anyhow::Result<()> {
        let content = std::fs::read_to_string("./fixtures/test_docx.xml")?;
        let result = parse_docx(&content)?;
        assert_eq!(
            result,
            "I’m testing a simple document I’m editing the file to update it here bold underline"
        );
        Ok(())
    }
}
