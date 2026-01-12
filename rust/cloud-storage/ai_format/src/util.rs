use chrono::{DateTime, Utc};
use std::fmt::Display;

pub fn truncate<T: Display>(v: T, limit: usize) -> String {
    let content = v.to_string();
    content
        .char_indices()
        .nth(limit)
        .map(|(i, _)| format!("{}...", &content[..i]))
        .unwrap_or(content)
}

pub struct Date(pub DateTime<Utc>);
pub struct Indent<T: Sized>(pub usize, pub T);
pub struct Truncate<T: Sized>(pub usize, pub T);

impl Display for Date {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0.to_rfc2822())
    }
}

impl<T> Display for Indent<T>
where
    T: Display + Sized,
{
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let text = self.1.to_string();
        let mut iter = text.lines().peekable();
        while let Some(line) = iter.next() {
            if iter.peek().is_some() {
                writeln!(f, "{:indent$}{}", "", line, indent = self.0)?;
            } else {
                write!(f, "{:indent$}{}", "", line, indent = self.0)?;
            }
        }
        Ok(())
    }
}

impl<T> Display for Truncate<T>
where
    T: Display + Sized,
{
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", truncate(&self.1, self.0))
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::insight_context_log::InsightContextLog;

    #[test]
    fn test_truncate() {
        let truncated = Truncate(3, "123456789").to_string();
        assert_eq!(truncated.as_str(), "123...");
        assert_eq!(
            Truncate(5, "hello world").to_string(),
            "hello...".to_string()
        );
    }

    #[test]
    fn test_indent() {
        let text = "this is text";
        assert_eq!("    this is text".to_string(), Indent(4, text).to_string());
        let text = r#"multi
line
text
    here"#;
        assert_eq!(
            r#"    multi
    line
    text
        here"#
                .to_string(),
            Indent(4, text).to_string()
        );
    }

    #[test]
    fn test_log() {
        let log = InsightContextLog {
            content: "content",
            metadata: vec![("key".to_string(), "value".to_string())],
            name: "test".to_string(),
        };
        let text = log.to_string();
        assert_eq!(
            r#"[test]
key: value
content
[END test]
"#,
            text.as_str()
        );

        let log = InsightContextLog {
            content: Truncate(7, "content that is too long to be useful to ai"),
            metadata: vec![],
            name: "long test".to_string(),
        };
        assert_eq!(
            log.to_string(),
            r#"[long test]
content...
[END long test]
"#
            .to_string()
        );

        let nested_log = InsightContextLog {
            content: Indent(4, log),
            metadata: vec![("swag".to_string(), "true".to_string())],
            name: "nested test".to_string(),
        };

        assert_eq!(
            r#"[nested test]
swag: true
    [long test]
    content...
    [END long test]
[END nested test]
"#
            .to_string(),
            nested_log.to_string()
        )
    }
}
