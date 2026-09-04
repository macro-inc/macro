//! Split the executed SDL into a small card and per-topic slices.
//!
//! The card is what every request pays for: the root query, the input object,
//! and the types every kind shares. Each kind's filter literal and output type
//! are a slice the model fetches with `DescribeSoup` only when it needs them.
//! Together the card and the slices cover the whole schema; a slice never
//! repeats a card type.

use std::collections::{BTreeMap, HashSet};
use std::sync::LazyLock;

use apollo_compiler::schema::ExtendedType;

use crate::schema::input::SoupKind;

/// A schema slice the model can ask for by name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Topic {
    /// One kind's filter literal and output type.
    Kind(SoupKind),
    /// Entity properties: `properties { … }` on items and `propertiesFilter`.
    Properties,
}

impl Topic {
    /// Every topic, kinds first.
    pub(crate) fn all() -> impl Iterator<Item = Topic> {
        SoupKind::ALL
            .into_iter()
            .map(Topic::Kind)
            .chain(std::iter::once(Topic::Properties))
    }

    /// The type names a slice starts from.
    fn roots(self) -> [&'static str; 2] {
        match self {
            Topic::Kind(SoupKind::Document) => ["GraphqlDocumentExpr", "GraphqlSoupDocument"],
            Topic::Kind(SoupKind::Chat) => ["GraphqlChatExpr", "GraphqlSoupChat"],
            Topic::Kind(SoupKind::Project) => ["GraphqlProjectExpr", "GraphqlSoupProject"],
            Topic::Kind(SoupKind::EmailThread) => ["GraphqlEmailExpr", "GraphqlSoupEmailThread"],
            Topic::Kind(SoupKind::Channel) => ["GraphqlChannelExpr", "GraphqlSoupChannel"],
            Topic::Kind(SoupKind::ChannelMessage) => {
                ["GraphqlChannelThreadExpr", "GraphqlSoupChannelMessage"]
            }
            Topic::Kind(SoupKind::Call) => ["GraphqlCallExpr", "GraphqlSoupCall"],
            Topic::Kind(SoupKind::CalendarEvent) => {
                ["GraphqlCalendarEventExpr", "GraphqlSoupCalendarEvent"]
            }
            Topic::Kind(SoupKind::ForeignEntity) => {
                ["GraphqlForeignEntityExpr", "GraphqlSoupForeignEntity"]
            }
            Topic::Properties => ["GraphqlProperty", "GraphqlFilterPropertiesExpr"],
        }
    }
}

/// Types the card starts from beyond `Query`. `GraphqlDateLiteral` is only
/// reachable through kind literals, but every date-bearing kind uses it, so it
/// lives on the card instead of in each slice.
const CARD_EXTRA_ROOTS: [&str; 1] = ["GraphqlDateLiteral"];

/// Definition text of every named type, keyed by name, in SDL order. Taken
/// from async-graphql's own printer so slices keep the compact single-line
/// descriptions the tool card had before.
static DEFINITIONS: LazyLock<BTreeMap<String, (usize, String)>> = LazyLock::new(|| {
    super::compact_sdl()
        .split("\n\n")
        .enumerate()
        .filter_map(|(index, chunk)| {
            let name = definition_name(chunk)?;
            Some((name.to_owned(), (index, chunk.trim().to_owned())))
        })
        .collect()
});

/// Type-reference graph of the executed schema.
static GRAPH: LazyLock<BTreeMap<String, Vec<String>>> = LazyLock::new(|| {
    let schema = apollo_compiler::Schema::parse(super::compact_sdl(), "soup.graphql")
        .unwrap_or_else(|errors| panic!("QuerySoup SDL does not parse: {errors}"));
    schema
        .types
        .iter()
        .filter(|(_, ty)| !ty.is_built_in())
        .map(|(name, ty)| (name.to_string(), references(ty)))
        .collect()
});

fn references(ty: &ExtendedType) -> Vec<String> {
    let mut out = Vec::new();
    match ty {
        ExtendedType::Object(object) => {
            out.extend(object.implements_interfaces.iter().map(|i| i.to_string()));
            for field in object.fields.values() {
                out.push(field.ty.inner_named_type().to_string());
                out.extend(
                    field
                        .arguments
                        .iter()
                        .map(|arg| arg.ty.inner_named_type().to_string()),
                );
            }
        }
        ExtendedType::Interface(interface) => {
            for field in interface.fields.values() {
                out.push(field.ty.inner_named_type().to_string());
            }
        }
        ExtendedType::InputObject(input) => {
            out.extend(
                input
                    .fields
                    .values()
                    .map(|field| field.ty.inner_named_type().to_string()),
            );
        }
        ExtendedType::Union(union) => out.extend(union.members.iter().map(|m| m.to_string())),
        ExtendedType::Scalar(_) | ExtendedType::Enum(_) => {}
    }
    out
}

/// The first type keyword line of an SDL chunk, e.g. `input Foo @oneOf {` → `Foo`.
fn definition_name(chunk: &str) -> Option<&str> {
    const KEYWORDS: [&str; 6] = [
        "type ",
        "input ",
        "enum ",
        "interface ",
        "union ",
        "scalar ",
    ];
    chunk.lines().find_map(|line| {
        let rest = KEYWORDS
            .iter()
            .find_map(|keyword| line.strip_prefix(keyword))?;
        let name = rest
            .split(|c: char| c.is_whitespace() || c == '{' || c == '=' || c == '@')
            .next()?;
        (!name.is_empty()).then_some(name)
    })
}

/// Names reachable from `roots` without expanding into or including `stop`.
fn reachable(roots: &[&str], stop: &HashSet<&str>) -> HashSet<String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut queue: Vec<String> = roots.iter().map(|root| root.to_string()).collect();
    while let Some(name) = queue.pop() {
        // Built-in scalars have no definition to print and are not in the graph.
        let Some(edges) = GRAPH.get(&name) else {
            continue;
        };
        if stop.contains(name.as_str()) || !seen.insert(name.clone()) {
            continue;
        }
        queue.extend(edges.iter().cloned());
    }
    seen
}

fn all_topic_roots() -> HashSet<&'static str> {
    Topic::all().flat_map(|topic| topic.roots()).collect()
}

fn card_names() -> HashSet<String> {
    let roots: Vec<&str> = std::iter::once("Query").chain(CARD_EXTRA_ROOTS).collect();
    reachable(&roots, &all_topic_roots())
}

/// Print the definitions in `names`, in schema order.
fn render(names: &HashSet<String>) -> String {
    let mut chunks: Vec<&(usize, String)> = names
        .iter()
        .filter_map(|name| DEFINITIONS.get(name))
        .collect();
    chunks.sort_by_key(|(index, _)| *index);
    chunks
        .into_iter()
        .map(|(_, text)| text.as_str())
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// The always-advertised part of the schema.
pub(crate) fn card_sdl() -> &'static str {
    static CARD: LazyLock<String> = LazyLock::new(|| render(&card_names()));
    &CARD
}

/// One topic's slice: everything it needs that the card does not already show.
pub(crate) fn topic_sdl(topic: Topic) -> String {
    let card = card_names();
    let mut stop: HashSet<&str> = card.iter().map(String::as_str).collect();
    let properties_roots = Topic::Properties.roots();
    if topic != Topic::Properties {
        stop.extend(properties_roots);
    }
    render(&reachable(&topic.roots(), &stop))
}

/// Every named type in the executed schema, for coverage tests.
#[cfg(test)]
pub(crate) fn all_type_names() -> HashSet<String> {
    GRAPH.keys().cloned().collect()
}

/// Names on the card, for coverage tests.
#[cfg(test)]
pub(crate) fn card_type_names() -> HashSet<String> {
    card_names()
}

/// Names in one slice, for coverage tests.
#[cfg(test)]
pub(crate) fn topic_type_names(topic: Topic) -> HashSet<String> {
    let card = card_names();
    let mut stop: HashSet<&str> = card.iter().map(String::as_str).collect();
    if topic != Topic::Properties {
        stop.extend(Topic::Properties.roots());
    }
    reachable(&topic.roots(), &stop)
}
