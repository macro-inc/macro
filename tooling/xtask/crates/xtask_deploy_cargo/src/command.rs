//! One shell command of a deploy build, parsed into the Cargo selection it makes.
//!
//! Only the commands that compile workspace code count: `cargo build`,
//! `cargo zigbuild`, crane's `cargoWithProfile build` and `cargo chef cook`.
//! Every option of those commands must be understood: a selection option is
//! recorded, a known option that cannot change feature resolution is skipped,
//! and anything else is an error, so no selection can pass unread.

#[cfg(test)]
mod test;

/// What a build command asks Cargo to resolve.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Selection {
    pub packages: Vec<String>,
    pub features: Vec<String>,
    pub no_default_features: bool,
    pub all_features: bool,
    /// The target triple, without cargo-zigbuild's glibc version suffix.
    pub target: Option<String>,
}

const SELECTION_VALUE: &[&str] = &["--package", "-p", "--features", "-F", "--target"];
/// Options that take a value but cannot change which packages or features resolve.
const OTHER_VALUE: &[&str] = &[
    "--bin",
    "--message-format",
    "--recipe-path",
    "--profile",
    "-j",
    "--jobs",
];
const OTHER_FLAG: &[&str] = &[
    "--release",
    "--locked",
    "--frozen",
    "--offline",
    "--quiet",
    "-q",
    "--verbose",
    "-v",
];

/// The selection of a compiling Cargo command, `None` for a command that
/// compiles no workspace code. A command that names Cargo anywhere but at its
/// head (`env X cargo build`, `sh -c "cargo build"`), or runs a Cargo
/// subcommand this grammar does not know, is an error: it cannot be read.
pub fn parse(words: &[String]) -> Result<Option<Selection>, String> {
    let names_cargo = names_cargo(&words.join(" "));
    if names_cargo && words.iter().any(|word| word.contains(['(', ')', '`'])) {
        return Err("unsupported shell grouping or substitution".into());
    }
    let mut words = words
        .iter()
        .map(String::as_str)
        .skip_while(|word| is_assignment(word));
    let head = words.next().map(|word| cargo_word(word).unwrap_or(word));
    let options: Vec<&str> = match (head, words.next()) {
        (Some("cargo"), Some("build" | "zigbuild")) | (Some("cargoWithProfile"), Some("build")) => {
            words.collect()
        }
        (Some("cargo"), Some("chef")) => match words.next() {
            Some("cook") => words.collect(),
            Some("prepare") => return Ok(None),
            other => return Err(format!("unsupported `cargo chef {}`", other.unwrap_or(""))),
        },
        // Commands that compile no workspace code.
        (Some("cargo"), Some("install" | "strip" | "--version" | "-V")) => return Ok(None),
        (Some("cargo" | "cargoWithProfile"), other) => {
            return Err(format!(
                "unsupported Cargo subcommand `{}`",
                other.unwrap_or("")
            ));
        }
        _ if names_cargo => return Err("unsupported Cargo invocation shape".into()),
        _ => return Ok(None),
    };
    let mut selection = Selection::default();
    let mut options = options.into_iter();
    while let Some(option) = options.next() {
        // --name=value, or a short option with its value attached (-pNAME).
        let (name, inline) = if let Some(rest) = option.strip_prefix("--") {
            match rest.split_once('=') {
                Some((name, value)) => (&option[..2 + name.len()], Some(value)),
                None => (option, None),
            }
        } else if let Some(short @ ("-p" | "-F" | "-j")) = option.get(..2)
            && option.len() > 2
        {
            (short, option.get(2..))
        } else {
            (option, None)
        };
        if SELECTION_VALUE.contains(&name) || OTHER_VALUE.contains(&name) {
            let value = match inline {
                Some(value) => value,
                None => options
                    .next()
                    .ok_or_else(|| format!("`{name}` has no value"))?,
            };
            let value = value.trim_matches('"');
            match name {
                "--package" | "-p" => selection.packages.push(package(value)?),
                "--features" | "-F" => selection.features.push(value.to_owned()),
                "--target" => selection.target = Some(strip_glibc_suffix(value).to_owned()),
                _ => {}
            }
        } else if inline.is_none() && OTHER_FLAG.contains(&name) {
        } else if inline.is_none() && name == "--no-default-features" {
            selection.no_default_features = true;
        } else if inline.is_none() && name == "--all-features" {
            selection.all_features = true;
        } else {
            return Err(format!("unsupported Cargo argument `{option}`"));
        }
    }
    Ok(Some(selection))
}

/// The Cargo program a word runs, by basename (`/usr/local/cargo/bin/cargo`
/// is `cargo`), or `None` for a word that is not a Cargo binary. Any
/// `cargo-<sub>` binary names Cargo too, so it reaches the grammar and fails
/// there rather than passing unread.
fn cargo_word(word: &str) -> Option<&str> {
    let word = word.trim_matches(['"', '\'', '[', ']', ',']);
    let name = word.rsplit('/').next().unwrap_or(word);
    (matches!(name, "cargo" | "cargoWithProfile") || name.starts_with("cargo-")).then_some(name)
}

/// Whether any word of a shell command runs Cargo.
pub fn names_cargo(text: &str) -> bool {
    text.split(|character: char| {
        character.is_whitespace() || matches!(character, '(' | ')' | '`' | ';' | '&' | '|' | '$')
    })
    .any(|word| cargo_word(word).is_some())
}

fn is_assignment(word: &str) -> bool {
    word.split_once('=').is_some_and(|(name, _)| {
        !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
    })
}

/// A literal package name; build arguments are substituted before parsing,
/// so a `$` left here is unresolved.
fn package(value: &str) -> Result<String, String> {
    if value.is_empty() || value.contains('$') {
        return Err(format!("unresolved package `{value}`"));
    }
    Ok(value.to_owned())
}

/// cargo-zigbuild's `x86_64-unknown-linux-gnu.2.26` names glibc 2.26, not a triple.
fn strip_glibc_suffix(target: &str) -> &str {
    match target.rsplit_once(".2.") {
        Some((triple, version)) if version.chars().all(|c| c.is_ascii_digit()) => triple,
        _ => target,
    }
}

/// Splits a shell command line into words and the separate commands it chains
/// (`&&`, `||`, `;`, `|`), dropping redirections and line continuations.
pub fn commands(line: &str) -> Vec<Vec<String>> {
    let mut commands = vec![Vec::new()];
    for word in line.split_whitespace() {
        match word {
            "&&" | "||" | ";" | "|" => commands.push(Vec::new()),
            "\\" => {}
            _ if word.starts_with('>') || word.starts_with("2>") || word.starts_with('<') => {}
            _ => {
                let (word, ends) = match word.strip_suffix(';') {
                    Some(word) => (word, true),
                    None => (word, false),
                };
                if let Some(current) = commands.last_mut() {
                    current.push(word.trim_matches('\'').to_owned());
                }
                if ends {
                    commands.push(Vec::new());
                }
            }
        }
    }
    commands.retain(|command| !command.is_empty());
    commands
}
