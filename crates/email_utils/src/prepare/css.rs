//! CSS sanitization for prepared email bodies, matching the web renderer's
//! `css.ts` policy.
//!
//! Output keeps each surviving token's source text, with comments dropped and
//! whitespace collapsed to single spaces, rather than reprinting a parsed
//! value: equal rendering, not byte equality with the web renderer.

use std::sync::LazyLock;

use cssparser::{
    AtRuleParser, CowRcStr, DeclarationParser, ParseError, Parser, ParserInput, ParserState,
    QualifiedRuleParser, RuleBodyItemParser, RuleBodyParser, StyleSheetParser, Token,
    serialize_identifier, serialize_string,
};
use regex::Regex;

use super::resource_policy::{ImagePolicy, RemoteImages, image_url};

static HOST_SELECTOR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i):host|::slotted|:global").expect("valid regex"));
static UNSAFE_PROPERTY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(?:behavior|-moz-binding|animation|transition)").expect("valid regex")
});
static COLOR_SCHEME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)prefers-color-scheme").expect("valid regex"));

/// Grouping and namespace rules a mounted body may keep.
const ALLOWED_AT_RULES: &[&str] = &[
    "media",
    "supports",
    "layer",
    "scope",
    "namespace",
    "container",
    "page",
];

#[derive(Debug, Clone, Copy, Default)]
pub(super) struct CssOptions {
    /// Drop root-level `@media (prefers-color-scheme)` rules: the reader's
    /// theme policy for head styles.
    pub strip_color_scheme: bool,
}

/// Any construct the policy rejects; the caller drops the enclosing rule or
/// declaration.
type Unsafe = ();
type Failure<'i> = ParseError<'i, Unsafe>;

/// Sanitizes a style sheet (`inline: false`) or a `style` attribute value.
pub(super) fn prepare_css(
    css: &str,
    inline: bool,
    images: &ImagePolicy,
    options: CssOptions,
) -> String {
    let mut input = ParserInput::new(css);
    let mut parser = Parser::new(&mut input);
    let out = if inline {
        declaration_list(&mut parser, images)
    } else {
        let mut rules = Rules {
            images,
            strip_color_scheme: options.strip_color_scheme,
            top_level_source: Some(css),
            scanned_to: 0,
        };
        let mut sheet: String = StyleSheetParser::new(&mut parser, &mut rules)
            .filter_map(Result::ok)
            .flatten()
            .collect();
        sheet.push_str(&rules.markers_before(css.len()));
        sheet
    };
    // Keep style text safe when embedded into HTML, including CSS strings.
    out.replace('<', "\\3c ")
}

/// Rule lists: a style sheet's top level, or a grouping rule's body.
struct Rules<'a> {
    images: &'a ImagePolicy,
    /// Only root-level media rules are theme overrides; nested rules remain part
    /// of the sender's style sheet.
    strip_color_scheme: bool,
    /// The whole style sheet, for top-level rules only.
    top_level_source: Option<&'a str>,
    /// Source offset up to which `<!--` tokens have been accounted for.
    scanned_to: usize,
}

impl Rules<'_> {
    /// The top-level `<!--` and `-->` tokens since the last rule kept.
    ///
    /// Matches the web renderer: css-tree keeps these tokens (Outlook wraps
    /// every style sheet in them) and prints them against the next rule it
    /// keeps, where escaping `<` leaves `\3c !--` in that rule's selector, so
    /// the rule never matches. Browsers skip the tokens and would apply it;
    /// both renderers should change together.
    fn markers_before(&mut self, end: usize) -> String {
        let Some(between) = self
            .top_level_source
            .and_then(|source| source.get(self.scanned_to..end))
        else {
            return String::new();
        };
        self.scanned_to = end;
        let mut input = ParserInput::new(between);
        let mut parser = Parser::new(&mut input);
        let mut markers = String::new();
        while let Ok(token) = parser.next() {
            match token {
                Token::CDO => markers.push_str("<!--"),
                Token::CDC => markers.push_str("-->"),
                _ => {}
            }
        }
        markers
    }
}

struct AtPrelude {
    name: String,
    text: String,
}

impl<'i> QualifiedRuleParser<'i> for Rules<'_> {
    type Prelude = String;
    type QualifiedRule = Option<String>;
    type Error = Unsafe;

    fn parse_prelude<'t>(&mut self, input: &mut Parser<'i, 't>) -> Result<String, Failure<'i>> {
        let prelude = component_text(input)?;
        if HOST_SELECTOR.is_match(&prelude.decoded) {
            return Err(input.new_custom_error(()));
        }
        Ok(prelude.text)
    }

    fn parse_block<'t>(
        &mut self,
        prelude: String,
        start: &ParserState,
        input: &mut Parser<'i, 't>,
    ) -> Result<Option<String>, Failure<'i>> {
        let markers = self.markers_before(start.position().byte_index());
        Ok(Some(format!(
            "{markers}{prelude}{{{}}}",
            declaration_list(input, self.images)
        )))
    }
}

impl<'i> AtRuleParser<'i> for Rules<'_> {
    type Prelude = AtPrelude;
    type AtRule = Option<String>;
    type Error = Unsafe;

    fn parse_prelude<'t>(
        &mut self,
        name: CowRcStr<'i>,
        input: &mut Parser<'i, 't>,
    ) -> Result<AtPrelude, Failure<'i>> {
        let name = name.to_ascii_lowercase();
        if !ALLOWED_AT_RULES.contains(&name.as_str()) {
            return Err(input.new_custom_error(()));
        }
        let prelude = component_text(input)?;
        if (name == "scope" && HOST_SELECTOR.is_match(&prelude.decoded))
            || (name == "media"
                && self.strip_color_scheme
                && COLOR_SCHEME.is_match(&prelude.decoded))
        {
            return Err(input.new_custom_error(()));
        }
        Ok(AtPrelude {
            name,
            text: prelude.text,
        })
    }

    fn rule_without_block(
        &mut self,
        prelude: AtPrelude,
        start: &ParserState,
    ) -> Result<Option<String>, ()> {
        match prelude.name.as_str() {
            "namespace" | "layer" => {
                let markers = self.markers_before(start.position().byte_index());
                Ok(Some(format!("{markers}{};", at_rule_head(&prelude))))
            }
            _ => Err(()),
        }
    }

    fn parse_block<'t>(
        &mut self,
        prelude: AtPrelude,
        start: &ParserState,
        input: &mut Parser<'i, 't>,
    ) -> Result<Option<String>, Failure<'i>> {
        let markers = self.markers_before(start.position().byte_index());
        let body = match prelude.name.as_str() {
            "media" | "supports" | "layer" | "scope" | "container" => {
                let mut nested = Rules {
                    images: self.images,
                    strip_color_scheme: false,
                    top_level_source: None,
                    scanned_to: 0,
                };
                StyleSheetParser::new(input, &mut nested)
                    .filter_map(Result::ok)
                    .flatten()
                    .collect::<String>()
            }
            "page" => declaration_list(input, self.images),
            _ => return Err(input.new_custom_error(())),
        };
        Ok(Some(format!(
            "{markers}{}{{{body}}}",
            at_rule_head(&prelude)
        )))
    }
}

fn at_rule_head(prelude: &AtPrelude) -> String {
    if prelude.text.is_empty() {
        format!("@{}", prelude.name)
    } else {
        format!("@{} {}", prelude.name, prelude.text)
    }
}

/// Declarations only: nested rules and at-rules in a declaration block are
/// dropped, as the web renderer's parser does.
fn declaration_list(input: &mut Parser<'_, '_>, images: &ImagePolicy) -> String {
    let mut declarations = Declarations { images };
    RuleBodyParser::new(input, &mut declarations)
        .filter_map(Result::ok)
        .flatten()
        .collect::<Vec<_>>()
        .join(";")
}

struct Declarations<'a> {
    images: &'a ImagePolicy,
}

impl<'i> DeclarationParser<'i> for Declarations<'_> {
    type Declaration = Option<String>;
    type Error = Unsafe;

    fn parse_value<'t>(
        &mut self,
        name: CowRcStr<'i>,
        input: &mut Parser<'i, 't>,
    ) -> Result<Option<String>, Failure<'i>> {
        if UNSAFE_PROPERTY.is_match(&name) {
            return Err(input.new_custom_error(()));
        }
        let mut value = String::new();
        write_value(input, self.images, false, &mut value)?;
        if value.is_empty() {
            return Err(input.new_custom_error(()));
        }
        let mut property = String::new();
        serialize_identifier(&name, &mut property).map_err(|_| input.new_custom_error(()))?;
        Ok(Some(format!("{property}:{value}")))
    }
}

impl<'i> QualifiedRuleParser<'i> for Declarations<'_> {
    type Prelude = ();
    type QualifiedRule = Option<String>;
    type Error = Unsafe;
}

impl<'i> AtRuleParser<'i> for Declarations<'_> {
    type Prelude = ();
    type AtRule = Option<String>;
    type Error = Unsafe;
}

impl<'i> RuleBodyItemParser<'i, Option<String>, Unsafe> for Declarations<'_> {
    fn parse_declarations(&self) -> bool {
        true
    }

    fn parse_qualified(&self) -> bool {
        false
    }
}

/// Writes a declaration value: source text per token, rewritten resource URLs,
/// and a failure for anything the policy rejects.
fn write_value<'i>(
    input: &mut Parser<'i, '_>,
    images: &ImagePolicy,
    in_image_set: bool,
    out: &mut String,
) -> Result<(), Failure<'i>> {
    let css_images = images.without_proxy();
    let mut space = false;
    loop {
        let start = input.position();
        let token = match input.next_including_whitespace() {
            Ok(token) => token.clone(),
            Err(_) => return Ok(()),
        };
        if let Token::WhiteSpace(_) = token {
            space = true;
            continue;
        }
        if space && !out.is_empty() {
            out.push(' ');
        }
        space = false;
        match token {
            Token::UnquotedUrl(url) => {
                write_url(&url, &css_images, out).map_err(|()| input.new_custom_error(()))?
            }
            Token::Function(name) => {
                let source = input.slice_from(start);
                let function = name.to_ascii_lowercase();
                if function == "url" {
                    // `url("…")`. An escaped name (`u\72l(`) is a function the
                    // web renderer cannot normalize as a URL, so it is rejected.
                    if !source.eq_ignore_ascii_case("url(") {
                        return Err(input.new_custom_error(()));
                    }
                    let url = input.parse_nested_block(|nested| {
                        let url = nested.expect_string()?.as_ref().to_owned();
                        nested.expect_exhausted()?;
                        Ok::<_, Failure<'i>>(url)
                    })?;
                    write_url(&url, &css_images, out).map_err(|()| input.new_custom_error(()))?;
                    continue;
                }
                if function == "expression" {
                    return Err(input.new_custom_error(()));
                }
                let image_set = function == "image-set" || function == "-webkit-image-set";
                // Functions such as var() can expand strings into URLs; the
                // blocked policy cannot evaluate them, so it excludes them.
                if images.remote == RemoteImages::Block && (image_set || function == "var") {
                    return Err(input.new_custom_error(()));
                }
                serialize_identifier(&name, out).map_err(|_| input.new_custom_error(()))?;
                out.push('(');
                input.parse_nested_block(|nested| write_value(nested, images, image_set, out))?;
                out.push(')');
            }
            Token::ParenthesisBlock => {
                out.push('(');
                input.parse_nested_block(|nested| write_value(nested, images, false, out))?;
                out.push(')');
            }
            Token::SquareBracketBlock => {
                out.push('[');
                input.parse_nested_block(|nested| write_value(nested, images, false, out))?;
                out.push(']');
            }
            // image-set() also accepts bare strings as URLs, which can load.
            Token::QuotedString(candidate) if in_image_set => {
                let url = image_url(&candidate, &css_images)
                    .filter(|url| !is_cid(url))
                    .ok_or_else(|| input.new_custom_error(()))?;
                serialize_string(&url, out).map_err(|_| input.new_custom_error(()))?;
            }
            Token::Delim('!') => {
                input.skip_whitespace();
                let important = matches!(
                    input.next(),
                    Ok(Token::Ident(word)) if word.eq_ignore_ascii_case("important")
                );
                if !important || input.expect_exhausted().is_err() {
                    return Err(input.new_custom_error(()));
                }
                out.push_str("!important");
                return Ok(());
            }
            Token::CurlyBracketBlock
            | Token::BadUrl(_)
            | Token::BadString(_)
            | Token::CloseParenthesis
            | Token::CloseSquareBracket
            | Token::CloseCurlyBracket => return Err(input.new_custom_error(())),
            _ => out.push_str(input.slice_from(start)),
        }
    }
}

fn is_cid(url: &str) -> bool {
    url.get(..4)
        .is_some_and(|scheme| scheme.eq_ignore_ascii_case("cid:"))
}

fn write_url(url: &str, images: &ImagePolicy, out: &mut String) -> Result<(), ()> {
    let url = image_url(url, images)
        .filter(|url| !is_cid(url))
        .ok_or(())?;
    out.push_str("url(");
    serialize_string(&url, out).map_err(|_| ())?;
    out.push(')');
    Ok(())
}

/// A rule prelude: its source text, and a decoded form for policy matching.
struct Prelude {
    text: String,
    decoded: String,
}

fn component_text<'i>(input: &mut Parser<'i, '_>) -> Result<Prelude, Failure<'i>> {
    let mut prelude = Prelude {
        text: String::new(),
        decoded: String::new(),
    };
    write_components(input, &mut prelude)?;
    Ok(prelude)
}

fn write_components<'i>(
    input: &mut Parser<'i, '_>,
    prelude: &mut Prelude,
) -> Result<(), Failure<'i>> {
    let mut space = false;
    loop {
        let start = input.position();
        let token = match input.next_including_whitespace() {
            Ok(token) => token.clone(),
            Err(_) => return Ok(()),
        };
        if let Token::WhiteSpace(_) = token {
            space = true;
            continue;
        }
        if space && !prelude.text.is_empty() {
            prelude.text.push(' ');
            prelude.decoded.push(' ');
        }
        space = false;
        let close = match token {
            Token::Function(ref name) => {
                serialize_identifier(name, &mut prelude.text)
                    .map_err(|_| input.new_custom_error(()))?;
                prelude.text.push('(');
                prelude.decoded.push_str(name);
                prelude.decoded.push('(');
                ')'
            }
            Token::ParenthesisBlock => {
                prelude.text.push('(');
                prelude.decoded.push('(');
                ')'
            }
            Token::SquareBracketBlock => {
                prelude.text.push('[');
                prelude.decoded.push('[');
                ']'
            }
            Token::CurlyBracketBlock
            | Token::BadUrl(_)
            | Token::BadString(_)
            | Token::CloseParenthesis
            | Token::CloseSquareBracket
            | Token::CloseCurlyBracket => return Err(input.new_custom_error(())),
            ref other => {
                let source = input.slice_from(start);
                prelude.text.push_str(source);
                prelude.decoded.push_str(&decoded(other, source));
                continue;
            }
        };
        input.parse_nested_block(|nested| write_components(nested, prelude))?;
        prelude.text.push(close);
        prelude.decoded.push(close);
    }
}

/// A token's text with CSS escapes decoded, for matching selector names.
fn decoded(token: &Token<'_>, source: &str) -> String {
    match token {
        Token::Ident(value) | Token::QuotedString(value) | Token::UnquotedUrl(value) => {
            value.to_string()
        }
        Token::AtKeyword(value) => format!("@{value}"),
        Token::Hash(value) | Token::IDHash(value) => format!("#{value}"),
        Token::Colon => ":".to_string(),
        Token::Delim(c) => c.to_string(),
        _ => source.to_string(),
    }
}
