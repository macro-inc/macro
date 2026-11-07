//! JavaScript class helpers and linkedom CSS property semantics.
use crate::HtmlElement;
use lexical_model::{is_js_whitespace, js_trim};
use nom::{
    IResult, Parser,
    bytes::complete::{take_until, take_while},
    character::complete::char,
    combinator::rest,
    multi::separated_list0,
    sequence::separated_pair,
};
use std::sync::LazyLock;
/// Ordered, quote/comment/parenthesis-aware CSS declarations shared with selection styling.
pub fn get_style_object_from_css(css: &str) -> Vec<(String, String)> {
    lexical_model::style_object_from_css(css)
        .into_iter()
        .collect()
}
pub(crate) fn raw_style_pairs(css: &str) -> Vec<(String, String)> {
    let parsed: IResult<&str, Vec<&str>> =
        separated_list0(char(';'), take_while(|ch| ch != ';')).parse(css);
    let mut result: Vec<(String, String)> = Vec::new();
    if let Ok((_, rules)) = parsed {
        for rule in rules {
            let parsed: IResult<&str, (&str, &str)> =
                separated_pair(take_until(":"), char(':'), rest).parse(rule);
            if let Ok((_, (key, value))) = parsed {
                let (key, value) = (js_trim(key), js_trim(value));
                if key.is_empty() || value.is_empty() {
                    continue;
                }
                if let Some((_, previous)) = result.iter_mut().find(|(previous, _)| previous == key)
                {
                    *previous = value.to_owned();
                } else {
                    result.push((key.to_owned(), value.to_owned()));
                }
            }
        }
    }
    result
}
/// Apply declarations, removing the !important suffix because linkedom ignores priority.
pub fn set_dom_style_from_css(element: &mut HtmlElement, css: &str) {
    for (key, value) in get_style_object_from_css(css) {
        let trimmed = js_trim(&value);
        let important = "!important";
        let value = if trimmed
            .get(trimmed.len().saturating_sub(important.len())..)
            .is_some_and(|suffix| suffix.eq_ignore_ascii_case(important))
        {
            js_trim(
                trimmed
                    .get(..trimmed.len() - important.len())
                    .unwrap_or_default(),
            )
        } else {
            &value
        };
        element.style_set_property(&key, value);
    }
}
/// Split class-name arguments on JavaScript whitespace, retaining token order.
pub fn normalize_class_names<'s>(names: impl IntoIterator<Item = Option<&'s str>>) -> Vec<&'s str> {
    names
        .into_iter()
        .flatten()
        .flat_map(|name| name.split(is_js_whitespace))
        .filter(|name| !name.is_empty())
        .collect()
}
/// Add normalized class-name arguments to an element.
pub fn add_class_names(element: &mut HtmlElement, names: &[Option<&str>]) {
    element.class_list_add(normalize_class_names(names.iter().copied()));
}
static HYPHEN: LazyLock<regress::Regex> = LazyLock::new(|| {
    regress::Regex::new("(([A-Z0-9])([A-Z0-9][a-z]))|(([a-z0-9]+)([A-Z]))")
        .expect("validated uhyphen pattern")
});
/// Exact uhyphen casing conversion used by linkedom CSS property access.
pub fn uhyphen(name: &str) -> String {
    let mut output = String::new();
    let mut previous = 0;
    for found in HYPHEN.find_iter(name) {
        output.push_str(name.get(previous..found.start()).unwrap_or_default());
        for group in [2, 5] {
            if let Some(range) = found.group(group) {
                output.push_str(name.get(range).unwrap_or_default());
            }
        }
        output.push('-');
        for group in [3, 6] {
            if let Some(range) = found.group(group) {
                output.push_str(name.get(range).unwrap_or_default());
            }
        }
        previous = found.end();
    }
    output.push_str(name.get(previous..).unwrap_or_default());
    output.to_lowercase()
}
