//! Literal generic-Dockerfile consumers outside Pulumi: Compose and direct
//! just recipes. A new reference outside these supported shapes is an error.
use crate::infra::Consumer;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::path::{Component, Path};

#[cfg(test)]
mod test;

const GENERIC: &str = "docker/Dockerfile";

fn literal(value: &str) -> bool {
    !value.is_empty() && !value.contains(['$', '{', '}', '`', '\\'])
}

pub fn consumers(path: &str, text: &str) -> Result<Vec<Consumer>, String> {
    if path.ends_with(".yml") || path.ends_with(".yaml") {
        return yaml_consumers(path, text);
    }
    if !has_generic_reference(text) {
        return Ok(Vec::new());
    }
    if path.rsplit('/').next() == Some("justfile") {
        return recipes(path, text);
    }
    Err(format!(
        "{path}: generic Dockerfile consumer outside supported Compose/just syntax"
    ))
}

fn has_generic_reference(text: &str) -> bool {
    lazy_regex::regex_is_match!(
        r#"(?:^|[\s'"=:])(?:\.\./)*docker/Dockerfile(?:[\s'"\\]|$)"#,
        text
    )
}

/// Classify every YAML document by its parsed root, before inspecting paths.
/// A Compose document can have any filename and can spell paths with `./`.
fn yaml_consumers(path: &str, text: &str) -> Result<Vec<Consumer>, String> {
    let mut found = Vec::new();
    for document in serde_yaml::Deserializer::from_str(text) {
        let mut value = serde_yaml::Value::deserialize(document)
            .map_err(|error| format!("{path}: cannot read YAML: {error}"))?;
        value
            .apply_merge()
            .map_err(|error| format!("{path}: cannot merge YAML: {error}"))?;
        if value
            .get("services")
            .and_then(serde_yaml::Value::as_mapping)
            .is_some()
        {
            found.extend(compose(path, &value)?);
        } else {
            let serialized = serde_yaml::to_string(&value)
                .map_err(|error| format!("{path}: cannot inspect YAML: {error}"))?;
            if has_generic_reference(&serialized) {
                return Err(format!(
                    "{path}: generic Dockerfile reference outside supported Compose structure"
                ));
            }
        }
    }
    Ok(found)
}

fn compose(path: &str, value: &serde_yaml::Value) -> Result<Vec<Consumer>, String> {
    let services = value
        .get("services")
        .and_then(serde_yaml::Value::as_mapping)
        .ok_or_else(|| format!("{path}: generic Dockerfile reference outside Compose services"))?;
    let mut found = Vec::new();
    for (service, value) in services {
        let Some(build) = value.get("build") else {
            continue;
        };
        let (context, dockerfile) = if let Some(context) = build.as_str() {
            (context, "Dockerfile")
        } else {
            if !build.is_mapping() || build.get("dockerfile_inline").is_some() {
                return Err(format!("{path}: unsupported Compose build shape"));
            }
            let context = match build.get("context") {
                Some(value) => value
                    .as_str()
                    .ok_or_else(|| format!("{path}: nonliteral Compose context"))?,
                None => ".",
            };
            let dockerfile = match build.get("dockerfile") {
                Some(value) => value
                    .as_str()
                    .ok_or_else(|| format!("{path}: nonliteral Compose dockerfile"))?,
                None => "Dockerfile",
            };
            (context, dockerfile)
        };
        // The main local stack's callers set --project-directory to the
        // repository root (root justfile and tooling/scripts/run-local.sh).
        // Other Compose files use their own directory, Compose's default.
        let project = if path == "docker/docker-compose.yml" {
            Path::new("")
        } else {
            Path::new(path).parent().unwrap_or(Path::new(""))
        };
        let context = repository_path(path, project, context)?;
        let dockerfile = repository_path(path, Path::new(&context), dockerfile)?;
        if dockerfile != GENERIC {
            continue;
        }
        let mut args = BTreeMap::new();
        if let Some(build_args) = build.get("args") {
            let entries = build_args
                .as_mapping()
                .ok_or_else(|| format!("{path}: Compose build args must be a literal mapping"))?;
            for (name, value) in entries {
                let name = name
                    .as_str()
                    .filter(|name| literal(name))
                    .ok_or_else(|| format!("{path}: nonliteral Compose arg name"))?;
                let value = value
                    .as_str()
                    .filter(|value| literal(value))
                    .ok_or_else(|| format!("{path}: nonliteral Compose arg {name}"))?;
                args.insert(name.to_owned(), value.to_owned());
            }
        }
        found.push(Consumer {
            source: format!("{path}:services.{}", service.as_str().unwrap_or("?")),
            dockerfile: GENERIC.into(),
            args,
        });
    }
    Ok(found)
}

fn recipes(path: &str, text: &str) -> Result<Vec<Consumer>, String> {
    if text
        .lines()
        .any(|line| line.trim().starts_with("set working-directory"))
    {
        return Err(format!(
            "{path}: custom recipe working directory is unsupported"
        ));
    }
    let mut found = Vec::new();
    for (line_number, line) in text.lines().enumerate() {
        if !line.contains(GENERIC) || line.trim_start().starts_with('#') {
            continue;
        }
        let commands = crate::command::commands(line);
        if commands.len() != 1 {
            return Err(format!(
                "{path}: chained generic Docker build is unsupported"
            ));
        }
        let words = shell_words::split(line.trim())
            .map_err(|error| format!("{path}: cannot read Docker recipe: {error}"))?;
        if words.first().map(String::as_str) != Some("docker")
            || words.get(1).map(String::as_str) != Some("build")
        {
            return Err(format!(
                "{path}: generic Dockerfile reference outside a direct docker build"
            ));
        }
        let mut args = BTreeMap::new();
        let mut dockerfile = None;
        let mut words = words[2..].iter();
        while let Some(word) = words.next() {
            match word.as_str() {
                "-f" | "--file" => dockerfile = words.next().map(String::as_str),
                "--build-arg" => {
                    let arg = words
                        .next()
                        .and_then(|arg| arg.split_once('='))
                        .filter(|(name, value)| literal(name) && literal(value))
                        .ok_or_else(|| {
                            format!("{path}: Docker build arg is not a literal NAME=value")
                        })?;
                    args.insert(arg.0.to_owned(), arg.1.to_owned());
                }
                "-t" | "--tag" => {
                    words
                        .next()
                        .ok_or_else(|| format!("{path}: missing Docker tag"))?;
                }
                word if word.starts_with('-') => {
                    return Err(format!("{path}: unsupported Docker build option {word}"));
                }
                _ => {}
            }
        }
        let dockerfile = dockerfile
            .filter(|file| literal(file))
            .ok_or_else(|| format!("{path}: Docker build has no literal --file"))?;
        let resolved = repository_path(
            path,
            Path::new(path).parent().unwrap_or(Path::new("")),
            dockerfile,
        )?;
        if resolved != GENERIC {
            return Err(format!(
                "{path}: generic Dockerfile reference resolves elsewhere"
            ));
        }
        found.push(Consumer {
            source: format!("{path}:{}", line_number + 1),
            dockerfile: GENERIC.into(),
            args,
        });
    }
    if found.is_empty() {
        return Err(format!(
            "{path}: generic Dockerfile reference has no supported recipe consumer"
        ));
    }
    Ok(found)
}

fn repository_path(source: &str, base: &Path, relative: &str) -> Result<String, String> {
    if !literal(relative) || relative.starts_with('~') {
        return Err(format!("{source}: nonliteral Docker build path"));
    }
    let file = base.join(relative);
    let mut parts = Vec::new();
    for component in file.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().into_owned()),
            Component::CurDir => {}
            Component::ParentDir if parts.pop().is_some() => {}
            _ => return Err(format!("{source}: Docker build path escapes repository")),
        }
    }
    Ok(parts.join("/"))
}
