//! Builds the list of entry points, one module per kind.

use std::collections::BTreeSet;
use std::path::Path;

use rootcause::prelude::*;

use crate::repo::{Loc, Repo};
use crate::row::{self, Kind, Providers, Row};
use crate::sources::{ElsewhereSource, ProvidersOverride, SOURCES_PATH, Sources};

mod background;
mod graphql;
mod http;
mod lambda;
mod provider;
mod queue;
mod tool;
mod webhook;
mod wire;

#[cfg(test)]
mod test;

/// Ends an `[[applies]]` key that covers every key with that prefix.
const KEY_PREFIX_MARK: char = '*';

/// An entry point as a kind's module finds it, before its kind and providers
/// are attached.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Entry {
    pub(crate) key: String,
    pub(crate) matcher: String,
    pub(crate) loc: Loc,
}

/// Lists every entry point of the repository at `repo_root`, sorted by kind
/// and key, as configured by its `sources.toml`.
///
/// Fails, naming the `file:line`, on anything it cannot resolve.
pub fn generate(repo_root: &Path) -> Result<Vec<Row>, Report> {
    let sources = Sources::load(repo_root)?;
    generate_from(repo_root, &sources)
}

/// [`generate`] with the configuration already read.
pub fn generate_from(repo_root: &Path, sources: &Sources) -> Result<Vec<Row>, Report> {
    let repo = Repo::new(repo_root);
    let mut found: Vec<(Kind, Entry)> = Vec::new();
    let mut add = |kind: Kind, entries: Vec<Entry>| {
        found.extend(entries.into_iter().map(|entry| (kind, entry)));
    };

    add(Kind::Http, http::list(&repo, &sources.http)?);
    for webhook in &sources.webhook {
        add(Kind::Webhook, webhook::list(&repo, webhook)?);
    }
    add(
        Kind::Graphql,
        graphql::list(&repo, &sources.graphql, &sources.graphql_type)?,
    );
    add(
        Kind::Queue,
        queue::list(&repo, &sources.queue_workers, &sources.queue)?,
    );
    for kafka in &sources.kafka {
        let events = wire::messages(&repo, &kafka.message, "")?;
        add(Kind::Kafka, named(&kafka.topic, events));
    }
    for gateway in &sources.gateway {
        let events = wire::messages(&repo, &gateway.message, "")?;
        add(Kind::Gateway, named(&gateway.name, events));
    }
    for tool in &sources.tool {
        add(Kind::Tool, tool::list(&repo, tool)?);
    }
    for lambda in &sources.lambda {
        add(Kind::Lambda, lambda::list(&repo, lambda)?);
    }
    for provider in &sources.provider {
        add(Kind::Provider, provider::list(&repo, provider)?);
    }
    for background in &sources.loops {
        add(Kind::Loop, background::list(&repo, background)?);
    }

    for elsewhere in &sources.elsewhere {
        add(Kind::Elsewhere, routes_elsewhere(repo_root, elsewhere)?);
    }

    let mut rows: Vec<Row> = found
        .into_iter()
        .map(|(kind, entry)| Row {
            kind,
            providers: default_providers(&entry.key, &entry.loc.file),
            key: entry.key,
            matcher: entry.matcher,
            source: entry.loc.to_string(),
        })
        .collect();

    apply_overrides(&mut rows, &sources.applies)?;
    row::sort(&mut rows);

    let mut seen = BTreeSet::new();
    for row in &rows {
        if !seen.insert((row.kind.to_string(), &row.key)) {
            bail!(
                "{}: a second `{}` entry point is named `{}`",
                row.source,
                row.kind,
                row.key
            );
        }
    }
    Ok(rows)
}

fn named(prefix: &str, messages: Vec<wire::Message>) -> Vec<Entry> {
    messages
        .into_iter()
        .map(|message| Entry {
            key: format!("{prefix}:{}", message.ident),
            matcher: message.matcher,
            loc: message.loc,
        })
        .collect()
}

/// The routes of another service that `sources.toml` lists by hand. The
/// file must register each: a `.route(` holding the end of the route's path
/// as a string literal and the route's method, or a `.nest(` holding it (the
/// router nested there is in another crate, so the method is not looked
/// for). A route that is renamed, removed or served under another method
/// then does not stay listed. An end made of parameters alone (`"/{id}"`)
/// says nothing of which route it is, so it does not count unless it is the
/// whole path.
fn routes_elsewhere(repo_root: &Path, source: &ElsewhereSource) -> Result<Vec<Entry>, Report> {
    let text = std::fs::read_to_string(repo_root.join(&source.file))
        .context(format!("could not read {}", source.file))?;
    source
        .routes
        .iter()
        .map(|route| {
            let Some((method, path)) = route.split_once(' ') else {
                bail!("{}: `{route}` is not `<METHOD> <path>`", source.file);
            };
            let line = registered_at(&text, method, path)
                .map_err(|why| report!("{}: {why} `{route}`", source.file))?;
            Ok(Entry {
                key: format!("{} {route}", source.service),
                matcher: String::new(),
                loc: Loc {
                    file: source.file.clone(),
                    line: line + 1,
                },
            })
        })
        .collect()
}

/// How a router adds a route, and how it mounts another router.
const ROUTE_CALL: &str = ".route(";
const NEST_CALL: &str = ".nest(";

/// The index of the line that registers `method path` in a router's source,
/// or what is missing.
fn registered_at(text: &str, method: &str, path: &str) -> Result<usize, &'static str> {
    let registrations = registrations(text);
    let mut found_path = false;
    let ends = path
        .match_indices('/')
        .map(|(start, _)| &path[start..])
        .filter(|end| *end == path || names_a_route(end));
    for end in ends {
        let literal = format!("\"{end}\"");
        for registration in &registrations {
            // The path is the call's first argument.
            let follows = registration.arguments.strip_prefix(literal.as_str());
            if !follows.is_some_and(|rest| rest.trim_start().starts_with(',')) {
                continue;
            }
            found_path = true;
            if registration.nests || calls(registration.arguments, method) {
                return Ok(registration.line);
            }
        }
    }
    if found_path {
        Err("the route registered there has not the method of")
    } else {
        Err("no route registration holds a string literal ending the path of")
    }
}

/// One `.route(..)` or `.nest(..)` call in a router's source.
struct Registration<'a> {
    nests: bool,
    /// What is between the call's parentheses, from its first argument.
    arguments: &'a str,
    /// The index of the line the first argument is on.
    line: usize,
}

/// The registrations in a router's source, comments left out.
fn registrations(text: &str) -> Vec<Registration<'_>> {
    let mut found = Vec::new();
    for (call, nests) in [(ROUTE_CALL, false), (NEST_CALL, true)] {
        for (start, _) in text.match_indices(call) {
            let line_start = text[..start].rfind('\n').map_or(0, |end| end + 1);
            if text[line_start..start].contains("//") {
                continue;
            }
            let inside = &text[start + call.len()..];
            let arguments = inside[..end_of_call(inside)].trim_start();
            let before = text.len() - inside.len() + (inside.len() - inside.trim_start().len());
            found.push(Registration {
                nests,
                arguments,
                line: text[..before].matches('\n').count(),
            });
        }
    }
    found
}

/// Where the call whose arguments `inside` starts with ends: its closing
/// parenthesis, those inside string literals not counted.
fn end_of_call(inside: &str) -> usize {
    let mut depth = 1_usize;
    let mut in_string = false;
    let mut escaped = false;
    for (index, character) in inside.char_indices() {
        if in_string {
            match character {
                _ if escaped => escaped = false,
                '\\' => escaped = true,
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match character {
            '"' => in_string = true,
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    return index;
                }
            }
            _ => {}
        }
    }
    inside.len()
}

/// Whether text calls the routing function of a method: `get(` or `.put(`.
fn calls(line: &str, method: &str) -> bool {
    let call = format!("{}(", method.to_lowercase());
    line.match_indices(&call).any(|(start, _)| {
        !line[..start]
            .chars()
            .next_back()
            .is_some_and(|before| before.is_alphanumeric() || before == '_')
    })
}

/// Whether a path has a segment that is not a parameter.
fn names_a_route(path: &str) -> bool {
    path.split('/')
        .any(|segment| !segment.is_empty() && !segment.starts_with('{'))
}

/// The providers a row applies to unless `sources.toml` says otherwise: the
/// one its key names, else the one its file's path names, else both.
fn default_providers(key: &str, file: &str) -> Providers {
    let named_in = |text: &str| {
        let text = text.to_lowercase();
        match (text.contains("gmail"), text.contains("outlook")) {
            (true, false) => Some(Providers::Gmail),
            (false, true) => Some(Providers::Outlook),
            (true, true) => Some(Providers::Both),
            (false, false) => None,
        }
    };

    named_in(key)
        .or_else(|| named_in(file))
        .unwrap_or(Providers::Both)
}

fn apply_overrides(rows: &mut [Row], overrides: &[ProvidersOverride]) -> Result<(), Report> {
    for rule in overrides {
        let covers = |key: &str| match rule.key.strip_suffix(KEY_PREFIX_MARK) {
            Some(prefix) => key.starts_with(prefix),
            None => key == rule.key,
        };

        let mut covered = 0_usize;
        for row in rows.iter_mut() {
            if row.kind == rule.kind && covers(&row.key) {
                row.providers = rule.providers;
                covered += 1;
            }
        }
        if covered == 0 {
            bail!(
                "{SOURCES_PATH}: [[applies]] kind = \"{}\", key = \"{}\" matches no row",
                rule.kind,
                rule.key
            );
        }
    }
    Ok(())
}
