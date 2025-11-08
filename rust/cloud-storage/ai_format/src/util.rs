use chrono::{DateTime, Utc};
use std::fmt::Display;

pub fn format_date(date: DateTime<Utc>) -> String {
    date.format("%Y-%m-%d").to_string()
}

pub fn truncate<T: Display>(v: T, limit: usize) -> String {
    let content = v.to_string();
    content
        .char_indices()
        .nth(limit)
        .map(|(i, _)| format!("{}...", &content[..i]))
        .unwrap_or(content)
}

pub struct Indent<T: Sized>(pub T, pub usize);
pub struct Truncate<T: Sized>(pub T, pub usize);
pub struct InsightContextLog<T: Display> {
    pub name: String,
    pub metadata: Vec<(String, String)>,
    pub content: T,
}

impl<T> Display for Indent<T>
where
    T: Display + Sized,
{
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let text = self.0.to_string();
        let mut iter = text.lines().peekable();
        while let Some(line) = iter.next() {
            if iter.peek().is_some() {
                writeln!(f, "{:indent$}{}", "", line, indent = self.1)?;
            } else {
                write!(f, "{:indent$}{}", "", line, indent = self.1)?;
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
        write!(f, "{}", truncate(&self.0, self.1))
    }
}

impl<T> Display for InsightContextLog<T>
where
    T: Display + Sized,
{
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let metadata = self
            .metadata
            .iter()
            .map(|(k, v)| format!("{}: {}", k, v))
            .collect::<Vec<_>>()
            .join(", ");
        writeln!(f, "[{}]", self.name)?;
        if !metadata.is_empty() {
            writeln!(f, "{}", metadata)?;
        }
        writeln!(f, "{}", self.content)?;
        writeln!(f, "[END {}]", self.name)
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_truncate() {
        let truncated = Truncate("123456789", 3).to_string();
        assert_eq!(truncated.as_str(), "123...");
        assert_eq!(
            Truncate("hello world", 5).to_string(),
            "hello...".to_string()
        );
    }

    #[test]
    fn test_indent() {
        let text = "this is text";
        assert_eq!("    this is text".to_string(), Indent(text, 4).to_string());
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
            Indent(text, 4).to_string()
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
            content: Truncate("content that is too long to be useful to ai", 7),
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
            content: Indent(log, 4),
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
