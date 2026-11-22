//! Binds every deploy build to the Cargo selections it compiles with.
//!
//! Each deploy root must yield at least one selection of its own: a nix
//! derivation by its own build script, or, for a bundle that only copies
//! other derivations' binaries, by every `-binaries-` derivation it bundles.
//! A root that yields none fails on its own, whatever the other roots yield.

use crate::command::{self, Selection};
use crate::infra::Consumer;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

#[cfg(test)]
mod test;

/// A deploy build and one Cargo selection it makes.
#[derive(Debug, PartialEq, Eq)]
pub struct Bound {
    pub source: String,
    pub selection: Selection,
}

/// Records a selection, or an error when it selects no package: without one
/// Cargo resolves features across the whole workspace.
fn bind(source: String, selection: Selection, bound: &mut Vec<Bound>, errors: &mut Vec<String>) {
    if selection.packages.is_empty() {
        errors.push(format!(
            "{source}: a build selects no package, so Cargo resolves the whole workspace"
        ));
    } else {
        bound.push(Bound { source, selection });
    }
}

/// Selections in a shell script; errors name the offending command.
pub fn script_selections(script: &str) -> Result<Vec<Selection>, String> {
    let mut selections = Vec::new();
    for line in script.lines() {
        for words in command::commands(line) {
            if let Some(selection) = command::parse(&words)
                .map_err(|error| format!("{error} in `{}`", words.join(" ")))?
            {
                selections.push(selection);
            }
        }
    }
    Ok(selections)
}

/// The derivations of a `nix derivation show` document, by store basename.
fn derivations(show: &Value) -> Option<&serde_json::Map<String, Value>> {
    show.get("derivations").unwrap_or(show).as_object()
}

fn build_phase(derivation: &Value) -> &str {
    derivation
        .pointer("/env/buildPhase")
        .and_then(Value::as_str)
        .unwrap_or("")
}

/// `roots` maps each deploy attribute to its derivation's store basename;
/// `shown` holds the root derivations and the bundled ones they reference.
pub fn nix_selections(roots: &[(String, String)], shown: &Value) -> (Vec<Bound>, Vec<String>) {
    let mut bound = Vec::new();
    let mut errors = Vec::new();
    let Some(derivations) = derivations(shown) else {
        return (
            bound,
            vec!["`nix derivation show` output is not an object".into()],
        );
    };
    for (attribute, drv) in roots {
        let Some(derivation) = derivations.get(drv) else {
            errors.push(format!("{attribute}: derivation {drv} was not shown"));
            continue;
        };
        match script_selections(build_phase(derivation)) {
            Err(error) => errors.push(format!("{attribute}: {error}")),
            Ok(own) if !own.is_empty() => {
                for selection in own {
                    bind(attribute.clone(), selection, &mut bound, &mut errors);
                }
            }
            Ok(_) => {
                let children: Vec<&str> = derivation
                    .pointer("/inputs/drvs")
                    .and_then(Value::as_object)
                    .map(|drvs| {
                        drvs.keys()
                            .map(String::as_str)
                            .filter(|name| name.contains("-binaries-") && name.ends_with(".drv"))
                            .collect()
                    })
                    .unwrap_or_default();
                if children.is_empty() {
                    errors.push(format!(
                        "{attribute}: no Cargo build command and no bundled build"
                    ));
                    continue;
                }
                for child in children {
                    let selections = derivations
                        .get(child)
                        .ok_or_else(|| format!("bundled derivation {child} was not shown"))
                        .and_then(|child| script_selections(build_phase(child)));
                    match selections {
                        Err(error) => errors.push(format!("{attribute}: {error}")),
                        Ok(own) if own.is_empty() => errors.push(format!(
                            "{attribute}: bundled {child} has no Cargo build command"
                        )),
                        Ok(own) => {
                            for selection in own {
                                bind(
                                    format!("{attribute} ({child})"),
                                    selection,
                                    &mut bound,
                                    &mut errors,
                                );
                            }
                        }
                    }
                }
            }
        }
    }
    (bound, errors)
}

/// A Dockerfile's RUN shell commands (continuations joined, RUN's own
/// `--mount`/`--network` options removed) and its `ARG NAME=default` values.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Dockerfile {
    pub runs: Vec<String>,
    pub defaults: BTreeMap<String, String>,
}

/// Reads RUN instructions in the shell form only. An exec-form (`RUN [..]`)
/// instruction, any heredoc (`<<`, whose body this reader would otherwise
/// take for Docker instructions), or a continuation that never ends cannot be
/// read and fails the file.
pub fn parse_dockerfile(text: &str) -> Result<Dockerfile, String> {
    let mut dockerfile = Dockerfile::default();
    let mut current: Option<String> = None;
    for line in text.lines() {
        let trimmed = line.trim();
        if current.is_none() && (trimmed.is_empty() || trimmed.starts_with('#')) {
            continue;
        }
        let (body, continues) = match trimmed.strip_suffix('\\') {
            Some(body) => (body, true),
            None => (trimmed, false),
        };
        match current.as_mut() {
            Some(run) => {
                run.push(' ');
                run.push_str(body);
            }
            None => {
                let instruction = body.split_whitespace().next().unwrap_or("");
                let rest = body[instruction.len()..].trim_start();
                if instruction.eq_ignore_ascii_case("RUN") {
                    current = Some(rest.to_owned());
                } else if instruction.eq_ignore_ascii_case("ARG")
                    && let Some((name, value)) = rest.split_once('=')
                {
                    dockerfile.defaults.insert(
                        name.trim().to_owned(),
                        value.trim().trim_matches('"').to_owned(),
                    );
                }
            }
        }
        if !continues && let Some(run) = current.take() {
            let command = run
                .split_whitespace()
                .skip_while(|word| word.starts_with("--mount=") || word.starts_with("--network="))
                .collect::<Vec<_>>()
                .join(" ");
            if command.starts_with('[') || command.contains("<<") {
                return Err(format!("unsupported RUN form `{command}`"));
            }
            dockerfile.runs.push(command);
        }
    }
    if let Some(run) = current {
        return Err(format!("RUN continuation never ends: `{run}`"));
    }
    Ok(dockerfile)
}

/// Build arguments the Cargo commands of `runs` reference as `${NAME}`; a
/// bare `$NAME` in a Cargo command is an error.
fn referenced_args(runs: &[String]) -> Result<BTreeSet<String>, String> {
    let mut names = BTreeSet::new();
    for run in runs {
        for words in command::commands(run) {
            let joined = words.join(" ");
            if !command::names_cargo(&joined) {
                continue;
            }
            if lazy_regex::regex_is_match!(r"\$[A-Za-z_]", &joined) {
                return Err(format!("`{joined}` uses $NAME; write ${{NAME}}"));
            }
            for captures in
                lazy_regex::regex_captures_iter!(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}", &joined)
            {
                if let Some(name) = captures.get(1) {
                    names.insert(name.as_str().to_owned());
                }
            }
        }
    }
    Ok(names)
}

fn substitute(run: &str, values: &BTreeMap<String, String>) -> String {
    lazy_regex::regex_replace_all!(
        r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}",
        run,
        |whole: &str, name: &str| {
            values
                .get(name)
                .cloned()
                .unwrap_or_else(|| whole.to_owned())
        }
    )
    .into_owned()
}

/// A Dockerfile's selections. One that references build arguments in a Cargo
/// command is resolved once per infra consumer with that consumer's values
/// (over the Dockerfile's defaults); every referenced argument must be set,
/// and such a Dockerfile must have a consumer. Each selection must name a
/// package, or the build resolves the whole workspace.
pub fn dockerfile_selections(
    name: &str,
    text: &str,
    consumers: &[&Consumer],
) -> (Vec<Bound>, Vec<String>) {
    let mut bound = Vec::new();
    let mut errors = Vec::new();
    let dockerfile = match parse_dockerfile(text) {
        Ok(dockerfile) => dockerfile,
        Err(error) => return (bound, vec![format!("{name}: {error}")]),
    };
    let referenced = match referenced_args(&dockerfile.runs) {
        Ok(referenced) => referenced,
        Err(error) => return (bound, vec![format!("{name}: {error}")]),
    };
    let mut resolutions: Vec<(String, BTreeMap<String, String>)> = Vec::new();
    if referenced.is_empty() {
        resolutions.push((name.to_owned(), dockerfile.defaults.clone()));
    } else if consumers.is_empty() {
        errors.push(format!(
            "{name}: its Cargo commands use build arguments ({}) but no infra stack builds it",
            referenced.iter().cloned().collect::<Vec<_>>().join(", ")
        ));
    } else {
        for consumer in consumers {
            let mut values = dockerfile.defaults.clone();
            values.extend(consumer.args.clone());
            let missing: Vec<&String> = referenced
                .iter()
                .filter(|arg| !values.contains_key(*arg))
                .collect();
            if missing.is_empty() {
                resolutions.push((format!("{name} for {}", consumer.source), values));
            } else {
                errors.push(format!(
                    "{name} for {}: build argument {} is not set",
                    consumer.source,
                    missing
                        .iter()
                        .map(|arg| arg.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                ));
            }
        }
    }
    for (source, values) in resolutions {
        let mut found = 0;
        let mut failed = false;
        for run in &dockerfile.runs {
            match script_selections(&substitute(run, &values)) {
                Err(error) => {
                    failed = true;
                    errors.push(format!("{source}: {error}"));
                }
                Ok(selections) => {
                    found += selections.len();
                    for selection in selections {
                        bind(source.clone(), selection, &mut bound, &mut errors);
                    }
                }
            }
        }
        // A wrapper such as worker-build or wasm-pack runs Cargo without naming
        // it; a Dockerfile that compiles no workspace code belongs in EXEMPT.
        if found == 0 && !failed {
            errors.push(format!(
                "{source}: no Cargo build command; if it compiles no workspace code, exempt it with a reason"
            ));
        }
    }
    (bound, errors)
}
