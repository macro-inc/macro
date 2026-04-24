//! Formatting utilities
use std::fmt;

use non_empty::NonEmpty;

use crate::Attachable;
use crate::FormattedParts;
use crate::models::TextOrImage;

const INDENT: &str = "  ";

/// Indent
pub struct Indent<T>(pub T);

/// XmlTag
pub struct XmlTag<'a, T: Sized> {
    /// Tag name.
    pub name: &'a str,
    /// Attributes as `(key, value)` pairs. Rendered in order, space-separated,
    /// with double-quoted values. Values are not escaped — callers are
    /// expected to pass attribute-safe text.
    pub attrs: &'a [(&'a str, &'a str)],
    /// Body content. Indented under the opening tag.
    pub body: T,
}

/// An XML tag with no body
pub struct ClosedXmlTag<'a> {
    /// tag name
    pub name: &'a str,
    /// attributes
    pub attrs: &'a [(&'a str, &'a str)],
}

fn format_attrs(attrs: &[(&str, &str)]) -> String {
    attrs
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn open_tag(name: &str, attrs: &[(&str, &str)]) -> String {
    format!("<{name} {}>", format_attrs(attrs))
}

fn close_tag(name: &str) -> String {
    format!("</{name}>")
}

fn self_closing_tag(name: &str, attrs: &[(&str, &str)]) -> String {
    format!("<{name} {}/>", format_attrs(attrs))
}

fn indent_line(line: &str) -> String {
    format!("{INDENT}{line}")
}

impl<'a, T: Attachable> Attachable for XmlTag<'a, T> {
    fn into_formatted_parts(self) -> FormattedParts {
        Indent(self.body)
            .into_formatted_parts()
            .prepend(TextOrImage::Text(open_tag(self.name, self.attrs)))
            .append(TextOrImage::Text(close_tag(self.name)))
    }
}

impl<T: Attachable> Attachable for Indent<T> {
    fn into_formatted_parts(self) -> FormattedParts {
        self.0.into_formatted_parts().map(|p| match p {
            img @ TextOrImage::Image(_) => img,
            TextOrImage::Text(t) => TextOrImage::Text(indent_line(&t)),
        })
    }
}

impl<'a> Attachable for ClosedXmlTag<'a> {
    fn into_formatted_parts(self) -> FormattedParts {
        let tag = self_closing_tag(self.name, self.attrs);
        FormattedParts::new(NonEmpty::new(vec![TextOrImage::Text(tag)]).expect("one tag"))
    }
}

impl<T: fmt::Display> fmt::Display for Indent<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let content = self.0.to_string();
        let mut first = true;
        for line in content.lines() {
            if !first {
                writeln!(f)?;
            }
            write!(f, "{INDENT}{line}")?;
            first = false;
        }
        Ok(())
    }
}

impl<'a, T: fmt::Display> fmt::Display for XmlTag<'a, T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "{}", open_tag(self.name, self.attrs))?;
        writeln!(f, "{}", Indent(&self.body))?;
        write!(f, "{}", close_tag(self.name))
    }
}

impl fmt::Display for ClosedXmlTag<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self_closing_tag(self.name, self.attrs))
    }
}
