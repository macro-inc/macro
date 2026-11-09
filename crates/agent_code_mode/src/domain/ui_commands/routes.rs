//! The web app's routes agents may open, as the web app ranks them.
//!
//! `navigable_routes.json` is generated from the web app's real route table
//! (`navigableByAgent` on `defineRoute`): every pane route branch in the
//! order the split router tries them, most specific first, and whether
//! agents may open it. A web test fails when the file is stale. The tab
//! checks again against its live table, so this is the first of two gates,
//! never the only one.

use nom::{
    IResult, Parser,
    bytes::complete::{tag, take_while, take_while1},
    combinator::{all_consuming, opt},
    multi::many1,
    sequence::preceded,
};
use serde::Deserialize;

/// The generated table.
const NAVIGABLE_ROUTES: &str = include_str!("navigable_routes.json");

/// Longest path accepted, query included.
const MAX_PATH_BYTES: usize = 2048;

/// Separates panes in a layout path.
const PANE_SEPARATOR: &str = "~";

#[derive(Deserialize)]
struct Table {
    branches: Vec<Branch>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Branch {
    route: String,
    navigable: bool,
    segments: Vec<String>,
}

/// One token of a branch's path.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Token {
    /// This exact segment.
    Literal(String),
    /// Any one segment.
    Param,
    /// One or more remaining segments.
    CatchAll,
}

#[derive(Debug, Clone)]
struct RouteBranch {
    route: String,
    navigable: bool,
    tokens: Vec<Token>,
}

/// The pane routes the web app has, in the order it matches them.
#[derive(Debug, Clone)]
pub struct NavigableRoutes {
    branches: Vec<RouteBranch>,
}

/// A path agents may open: one pane, matched to a navigable route.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppPath {
    path: String,
    route: String,
}

impl AppPath {
    /// The matched route ids, for traces; never the path, whose segments
    /// and query hold ids.
    pub fn route_ids(&self) -> Vec<&str> {
        vec![self.route.as_str()]
    }

    /// The path as sent.
    pub fn into_string(self) -> String {
        self.path
    }
}

impl NavigableRoutes {
    /// The table generated from the web app.
    ///
    /// # Errors
    /// When the generated file does not parse, which its web test prevents.
    pub fn generated() -> Result<Self, serde_json::Error> {
        Self::from_json(NAVIGABLE_ROUTES)
    }

    /// A table in the generated format.
    pub(crate) fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        let table: Table = serde_json::from_str(json)?;
        let branches = table
            .branches
            .into_iter()
            .map(|branch| RouteBranch {
                route: branch.route,
                navigable: branch.navigable,
                tokens: branch.segments.into_iter().map(token).collect(),
            })
            .collect();

        Ok(Self { branches })
    }

    /// The path, when it names one pane on a route agents may open. A path
    /// with an origin, a fragment, several panes, or a route the web app
    /// keeps closed is refused.
    pub fn check(&self, path: &str) -> Option<AppPath> {
        if path.len() > MAX_PATH_BYTES {
            return None;
        }

        let (raw_segments, _query) = parse_path(path)?;
        let segments = raw_segments
            .into_iter()
            .map(|segment| urlencoding::decode(segment).ok().map(|s| s.into_owned()))
            .collect::<Option<Vec<_>>>()?;
        if segments.iter().any(|segment| segment == PANE_SEPARATOR) {
            return None;
        }

        let branch = self
            .branches
            .iter()
            .find(|branch| matches(&branch.tokens, &segments))?;
        if !branch.navigable {
            return None;
        }

        Some(AppPath {
            path: path.to_owned(),
            route: branch.route.clone(),
        })
    }
}

fn token(segment: String) -> Token {
    match segment.as_str() {
        ":" => Token::Param,
        "*" => Token::CatchAll,
        _ => Token::Literal(segment),
    }
}

fn matches(tokens: &[Token], segments: &[String]) -> bool {
    match (tokens.split_first(), segments.split_first()) {
        (None, None) => true,
        (Some((Token::CatchAll, _)), Some(_)) => true,
        (Some((Token::Param, rest_tokens)), Some((_, rest_segments))) => {
            matches(rest_tokens, rest_segments)
        }
        (Some((Token::Literal(literal), rest_tokens)), Some((segment, rest_segments))) => {
            // As the web app matches them: static segments ignore case.
            literal.eq_ignore_ascii_case(segment) && matches(rest_tokens, rest_segments)
        }
        _ => false,
    }
}

/// Characters a path segment may hold: unreserved and percent escapes. No
/// `:` (no scheme can hide in a segment), no `/`, `?`, `#` or `\`.
fn is_segment_char(c: char) -> bool {
    c.is_ascii_alphanumeric()
        || matches!(
            c,
            '-' | '.'
                | '_'
                | '~'
                | '%'
                | '!'
                | '$'
                | '\''
                | '('
                | ')'
                | '*'
                | '+'
                | ','
                | ';'
                | '='
                | '@'
        )
}

/// Characters a query may hold; no `#`, so there is no fragment.
fn is_query_char(c: char) -> bool {
    c.is_ascii_graphic() && c != '#' && c != '\\'
}

/// `/a/b?query`: one or more segments after slashes, then an optional query.
fn path_parts(input: &str) -> IResult<&str, (Vec<&str>, Option<&str>)> {
    (
        many1(preceded(tag("/"), take_while1(is_segment_char))),
        opt(preceded(tag("?"), take_while(is_query_char))),
    )
        .parse(input)
}

fn parse_path(path: &str) -> Option<(Vec<&str>, Option<&str>)> {
    all_consuming(path_parts)
        .parse(path)
        .ok()
        .map(|(_, parts)| parts)
}
