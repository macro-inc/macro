//! The OData query options the email code sends: `$select`, `$top`,
//! `$skip`, `$orderby`, `$filter` and `$expand`. Anything else answers 400,
//! as Graph does for an option it does not support, so a new query never
//! silently reads unfiltered data.

use nom::branch::alt;
use nom::bytes::complete::{tag, tag_no_case, take_while1};
use nom::character::complete::{char, multispace0, multispace1};
use nom::combinator::{all_consuming, map, value};
use nom::multi::{many0, separated_list1};
use nom::sequence::{delimited, preceded, separated_pair, terminated};
use nom::{IResult, Parser};
use serde_json::Value;

use crate::error::GraphError;

#[cfg(test)]
mod test;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Literal {
    Text(String),
    Bool(bool),
}

/// A `$filter` the emulator understands.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Filter {
    /// `categories/any(c:c eq 'name')`
    Category(String),
    /// `singleValueExtendedProperties/any(p:p/id eq '…' and p/value eq '…')`
    Property { id: String, value: String },
    /// `field eq literal`
    Field { name: String, value: Literal },
}

/// The query options of one request.
#[derive(Clone, Debug, Default)]
pub(crate) struct Query {
    pub(crate) select: Option<Vec<String>>,
    pub(crate) top: Option<usize>,
    pub(crate) skip: usize,
    /// The property to order by, and whether descending.
    pub(crate) order_by: Option<(String, bool)>,
    pub(crate) filter: Option<Filter>,
    /// The extended property ids `$expand` asks for.
    pub(crate) properties: Vec<String>,
    pub(crate) skip_token: Option<String>,
    pub(crate) delta_token: Option<String>,
}

impl Query {
    pub(crate) fn parse(pairs: &[(String, String)]) -> Result<Self, GraphError> {
        let mut query = Self::default();
        for (name, value) in pairs {
            match name.to_ascii_lowercase().as_str() {
                "$select" => {
                    let names = value.split(',').map(|name| name.trim().to_string());
                    query.select = Some(names.filter(|name| !name.is_empty()).collect());
                }
                "$top" => query.top = Some(count(name, value)?),
                "$skip" => query.skip = count(name, value)?,
                "$orderby" => query.order_by = Some(order_by(value)?),
                "$filter" => query.filter = Some(filter(value)?),
                "$expand" => query.properties = expand(value)?,
                "$skiptoken" => query.skip_token = Some(value.clone()),
                "$deltatoken" => query.delta_token = Some(value.clone()),
                "$count" => {}
                option if option.starts_with('$') => {
                    return Err(GraphError::bad_request(&format!(
                        "Query option '{name}' is not supported by the emulator."
                    )));
                }
                _ => {}
            }
        }
        Ok(query)
    }

    /// The `$select` as it was sent, for a delta round to carry.
    pub(crate) fn select_text(&self) -> Option<String> {
        self.select.as_ref().map(|names| names.join(","))
    }
}

fn count(name: &str, text: &str) -> Result<usize, GraphError> {
    text.parse().map_err(|_| {
        GraphError::bad_request(&format!(
            "Invalid value '{text}' for {name} query option found. The {name} query option \
             requires a non-negative integer value."
        ))
    })
}

fn order_by(text: &str) -> Result<(String, bool), GraphError> {
    let mut words = text.split_whitespace();
    let property = words.next().unwrap_or_default().to_string();
    let descending = match words.next() {
        None | Some("asc") => false,
        Some("desc") => true,
        Some(_) => return Err(GraphError::bad_request("Invalid $orderby clause.")),
    };
    if property.is_empty() || words.next().is_some() {
        return Err(GraphError::bad_request("Invalid $orderby clause."));
    }
    Ok((property, descending))
}

fn identifier(input: &str) -> IResult<&str, &str> {
    take_while1(|c: char| c.is_ascii_alphanumeric() || c == '_').parse(input)
}

/// A single-quoted string, in which `''` is a quote.
fn quoted(input: &str) -> IResult<&str, String> {
    let piece = alt((
        map(take_while1(|c| c != '\''), str::to_string),
        value("'".to_string(), tag("''")),
    ));
    delimited(
        char('\''),
        map(many0(piece), |pieces| pieces.concat()),
        char('\''),
    )
    .parse(input)
}

fn literal(input: &str) -> IResult<&str, Literal> {
    alt((
        map(quoted, Literal::Text),
        value(Literal::Bool(true), tag("true")),
        value(Literal::Bool(false), tag("false")),
    ))
    .parse(input)
}

fn equals(input: &str) -> IResult<&str, ()> {
    value((), (multispace1, tag_no_case("eq"), multispace1)).parse(input)
}

/// A property path, such as `p/id`, and the literal it is compared with.
type Comparison<'a> = (Vec<&'a str>, Literal);

/// `name eq literal`, where the name may be a path such as `p/id`.
fn comparison(input: &str) -> IResult<&str, Comparison<'_>> {
    separated_pair(separated_list1(char('/'), identifier), equals, literal).parse(input)
}

/// `collection/any(variable: comparison and comparison …)`
fn any(input: &str) -> IResult<&str, (&str, &str, Vec<Comparison<'_>>)> {
    let (rest, collection) = terminated(identifier, char('/')).parse(input)?;
    let (rest, _) = tag_no_case("any").parse(rest)?;
    let (rest, variable) =
        preceded(char('('), terminated(identifier, (char(':'), multispace0))).parse(rest)?;
    let and = (multispace1, tag_no_case("and"), multispace1);
    let (rest, terms) = terminated(separated_list1(and, comparison), char(')')).parse(rest)?;
    Ok((rest, (collection, variable, terms)))
}

fn invalid_filter() -> GraphError {
    GraphError::bad_request("Invalid filter clause: the emulator does not support this $filter.")
}

fn text(literal: &Literal) -> Result<String, GraphError> {
    match literal {
        Literal::Text(text) => Ok(text.clone()),
        Literal::Bool(_) => Err(invalid_filter()),
    }
}

fn filter(input: &str) -> Result<Filter, GraphError> {
    let input = input.trim();
    if let Ok((_, (collection, variable, terms))) = all_consuming(any).parse(input) {
        // Every term must read the lambda variable.
        fn field<'a>(path: &[&'a str], variable: &str) -> Option<&'a str> {
            match path {
                [first] if *first == variable => Some(""),
                [first, field] if *first == variable => Some(*field),
                _ => None,
            }
        }
        let term = |wanted: &str| {
            terms
                .iter()
                .find(|(path, _)| field(path, variable) == Some(wanted))
                .map(|(_, literal)| literal)
        };
        return match (collection, terms.len()) {
            ("categories", 1) => Ok(Filter::Category(text(
                term("").ok_or_else(invalid_filter)?,
            )?)),
            ("singleValueExtendedProperties", 2) => Ok(Filter::Property {
                id: text(term("id").ok_or_else(invalid_filter)?)?,
                value: text(term("value").ok_or_else(invalid_filter)?)?,
            }),
            _ => Err(invalid_filter()),
        };
    }

    match all_consuming(comparison).parse(input) {
        Ok((_, (path, value))) if path.len() == 1 => Ok(Filter::Field {
            name: path[0].to_string(),
            value,
        }),
        _ => Err(invalid_filter()),
    }
}

/// `singleValueExtendedProperties($filter=id eq 'A' or id eq 'B')`
fn expand(input: &str) -> Result<Vec<String>, GraphError> {
    let id = preceded((tag("id"), equals), quoted);
    let or = (multispace1, tag_no_case("or"), multispace1);
    let mut parser = all_consuming(delimited(
        tag("singleValueExtendedProperties($filter="),
        separated_list1(or, id),
        char(')'),
    ));
    let parsed: IResult<&str, Vec<String>> = parser.parse(input.trim());
    parsed.map(|(_, ids)| ids).map_err(|_| {
        GraphError::bad_request(
            "Invalid $expand: the emulator expands only singleValueExtendedProperties($filter=id eq '…').",
        )
    })
}

/// Keeps the selected properties of a resource. `id` and the `@odata`
/// annotations always stay; a derived-type path such as
/// `microsoft.graph.fileAttachment/contentId` selects its last segment.
/// Graph answers 400 for a property the type does not have.
pub(crate) fn select(
    mut resource: Value,
    select: Option<&[String]>,
    type_name: &str,
) -> Result<Value, GraphError> {
    let (Some(select), Some(object)) = (select, resource.as_object_mut()) else {
        return Ok(resource);
    };
    let mut wanted = Vec::new();
    for name in select {
        let property = name.rsplit('/').next().unwrap_or(name);
        if !object.contains_key(property) {
            return Err(GraphError::bad_request(&format!(
                "Could not find a property named '{property}' on type '{type_name}'."
            )));
        }
        wanted.push(property);
    }
    object.retain(|key, _| key == "id" || key.starts_with('@') || wanted.contains(&key.as_str()));
    Ok(resource)
}
