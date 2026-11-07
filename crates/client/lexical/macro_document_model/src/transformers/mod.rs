//! Source-ordered Macro conversion callbacks over the shared markdown engine.
use lexical_markdown::{builtin::*, matcher::*, *};
use serde::Deserialize;
use std::{
    collections::BTreeMap,
    sync::{Arc, LazyLock},
};
mod auto_link;
mod block;
mod envelope;
mod inline;
mod media;
mod quote;
mod table;
/// Host facts required by external link exports; no browser globals are read.
#[derive(Clone, Debug, Default)]
pub struct MacroMarkdownOptions {
    /// Hostname of the app serving document routes.
    pub app_hostname: Option<Arc<str>>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pattern {
    source: String,
    flags: String,
    #[serde(default)]
    matcher: String,
    #[serde(default)]
    optional: bool,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry<'a> {
    name: &'a str,
    builtin: bool,
    #[serde(rename = "type")]
    kind: &'a str,
    #[serde(borrow)]
    dependencies: Vec<&'a str>,
    reg_exp: Option<Pattern>,
    import_reg_exp: Option<Pattern>,
    reg_exp_start: Option<Pattern>,
    reg_exp_end: Option<Pattern>,
    conversion_only: bool,
    trigger_on_enter: bool,
    trigger: Option<char>,
    has_replace: bool,
}
#[derive(Deserialize)]
struct Catalog<'a> {
    #[serde(borrow)]
    catalog: Vec<Entry<'a>>,
    #[serde(borrow)]
    lists: BTreeMap<&'a str, Vec<&'a str>>,
}
static CATALOG: LazyLock<Catalog<'static>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("catalog.json"))
        .expect("generated source transformer metadata")
});
#[derive(Debug)]
struct Callback {
    entry: &'static Entry<'static>,
    pattern: Box<dyn Matcher>,
    import: Option<Box<dyn Matcher>>,
    end: Option<Box<dyn Matcher>>,
    options: MacroMarkdownOptions,
}
fn compile(pattern: &Pattern) -> Result<Box<dyn Matcher>> {
    match pattern.matcher.as_str() {
        "AutoLinkRegExp" => Ok(Box::new(auto_link::AutoLinkMatcher::new(false)?)),
        "EscapedAutoLinkRegExp" => Ok(Box::new(auto_link::AutoLinkMatcher::new(true)?)),
        _ => Ok(Box::new(RegexMatcher::new(
            &pattern.source,
            &pattern.flags,
        )?)),
    }
}
/// Exact source object names in one of the `internal`, `external`, `all`, or `custom` lists.
pub fn list_names(name: &str) -> Option<&'static [&'static str]> {
    CATALOG.lists.get(name).map(Vec::as_slice)
}
/// Whether the source object owns the `conversionOnly` property.
pub fn is_conversion_only(name: &str) -> bool {
    CATALOG
        .catalog
        .iter()
        .any(|entry| entry.name == name && entry.conversion_only)
}
/// Resolve a named source object, including the two unlisted conversion helpers.
pub fn transformer(name: &str, options: &MacroMarkdownOptions) -> Result<Transformer> {
    let entry = CATALOG
        .catalog
        .iter()
        .find(|e| e.name == name)
        .ok_or(Error::InvalidArgument("unknown Macro transformer"))?;
    if entry.builtin {
        return builtin(entry.name);
    }
    let pattern = entry
        .reg_exp
        .as_ref()
        .or(entry.reg_exp_start.as_ref())
        .ok_or(Error::InvalidArgument("transformer has no matcher"))?;
    let callback = Arc::new(Callback {
        entry,
        pattern: compile(pattern)?,
        import: entry.import_reg_exp.as_ref().map(compile).transpose()?,
        end: entry.reg_exp_end.as_ref().map(compile).transpose()?,
        options: options.clone(),
    });
    match entry.kind {
        "element" => Ok(Transformer::Element(callback)),
        "text-match" => Ok(Transformer::TextMatch(callback)),
        "multiline-element" => Ok(Transformer::MultilineElement(callback)),
        _ => Err(Error::InvalidArgument("unknown Macro transformer kind")),
    }
}
/// Build an exact ordered source list, retaining distinct image callbacks.
pub fn transformers(name: &str, options: &MacroMarkdownOptions) -> Result<Transformers> {
    let names = list_names(name).ok_or(Error::InvalidArgument("unknown Macro transformer list"))?;
    Ok(Transformers::new(
        names
            .iter()
            .map(|name| transformer(name, options))
            .collect::<Result<Vec<_>>>()?,
    ))
}
fn builtin(name: &str) -> Result<Transformer> {
    Ok(match name {
        "HEADING" => Transformer::Element(Arc::new(Heading)),
        "QUOTE" => Transformer::Element(Arc::new(Quote)),
        "CODE" => Transformer::MultilineElement(Arc::new(Code)),
        "LINK" => Transformer::TextMatch(Arc::new(Link)),
        "INLINE_CODE" => Transformer::TextFormat(INLINE_CODE.clone()),
        "HIGHLIGHT" => Transformer::TextFormat(HIGHLIGHT.clone()),
        "BOLD_ITALIC_STAR" => Transformer::TextFormat(BOLD_ITALIC_STAR.clone()),
        "BOLD_ITALIC_UNDERSCORE" => Transformer::TextFormat(BOLD_ITALIC_UNDERSCORE.clone()),
        "BOLD_STAR" => Transformer::TextFormat(BOLD_STAR.clone()),
        "BOLD_UNDERSCORE" => Transformer::TextFormat(BOLD_UNDERSCORE.clone()),
        "STRIKETHROUGH" => Transformer::TextFormat(STRIKETHROUGH.clone()),
        "ITALIC_STAR" => Transformer::TextFormat(ITALIC_STAR.clone()),
        "ITALIC_UNDERSCORE" => Transformer::TextFormat(ITALIC_UNDERSCORE.clone()),
        _ => return Err(Error::InvalidArgument("unknown builtin transformer")),
    })
}
/// Resolve a recorder's source export path to its concrete transformer instance.
pub fn from_source_reference(
    reference: &str,
    options: &MacroMarkdownOptions,
) -> Result<Transformer> {
    let path = reference
        .strip_prefix("@macro-inc/lexical-core/transformers.")
        .ok_or(Error::InvalidArgument("unknown Macro transformer source"))?;
    let parts: Vec<_> = path.split('.').collect();
    let name = match parts.as_slice() {
        ["INTERNAL_TRANSFORMERS", index] => list_entry("internal", index)?,
        ["EXTERNAL_TRANSFORMERS", index] => list_entry("external", index)?,
        ["ALL_TRANSFORMERS", index] => list_entry("all", index)?,
        ["CUSTOM_TRANSFORMERS", index] => list_entry("custom", index)?,
        [name] => name,
        _ => {
            return Err(Error::InvalidArgument(
                "unknown Macro transformer export path",
            ));
        }
    };
    transformer(name, options)
}
fn list_entry(list: &str, index: &str) -> Result<&'static str> {
    let index = index
        .parse::<usize>()
        .map_err(|_| Error::InvalidArgument("invalid transformer index"))?;
    list_names(list)
        .and_then(|names| names.get(index))
        .copied()
        .ok_or(Error::InvalidArgument("invalid transformer index"))
}
/// Preserve explicitly authored empty-paragraph lines outside backtick fences.
pub fn protect_empty_paragraph_lines(markdown: &str, has_preserve_lines: bool) -> String {
    if !has_preserve_lines {
        return markdown.into();
    }
    let mut fence: Option<usize> = None;
    markdown
        .split('\n')
        .map(|line| {
            let trimmed = line.trim_end_matches(lexical_model::is_js_whitespace);
            let content = trimmed.trim_start_matches([' ', '\t']);
            if let Some(length) = fence {
                if content.len() >= length && content.bytes().all(|b| b == b'`') {
                    fence = None;
                }
            } else {
                let length = content.bytes().take_while(|b| *b == b'`').count();
                if length >= 3 {
                    let rest = &content[length..];
                    if rest.chars().rev().take_while(|c| *c == '`').count() < length {
                        fence = Some(length);
                    }
                } else if line == " " {
                    return "\u{200b}";
                }
            }
            line
        })
        .collect::<Vec<_>>()
        .join("\n")
}
