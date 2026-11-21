//! The infra stacks' Docker image builds: which Dockerfile each builds, with
//! which build arguments.
//!
//! The grammar is deliberately strict. A stack file's `dockerfile:` values
//! must be string literals (or `${REPO_ROOT}/<path>` templates), and each
//! `buildArgs:` must be a key of the same object literal as its `dockerfile:`
//! and hold only `NAME: 'literal'` entries. Anything else is an error, so no image build
//! can escape the check by being written differently.

use std::collections::BTreeMap;

#[cfg(test)]
mod test;

/// One image build in a stack file.
#[derive(Debug, PartialEq, Eq)]
pub struct Consumer {
    /// `<file>:<line>` of its `dockerfile:`.
    pub source: String,
    /// The Dockerfile path, relative to the repository root.
    pub dockerfile: String,
    pub args: BTreeMap<String, String>,
}

fn line_of(text: &str, offset: usize) -> usize {
    text[..offset].matches('\n').count() + 1
}

/// The `{ … }` object literals of a stack file as (open, close) byte offsets.
/// Strings, template literals and comments are skipped whole, so braces in
/// them do not count; unbalanced braces are an error.
fn objects(path: &str, text: &str) -> Result<Vec<(usize, usize)>, String> {
    let mut open = Vec::new();
    let mut objects = Vec::new();
    for (start, end) in tokens(path, text)? {
        match &text[start..end] {
            "{" => open.push(start),
            "}" => {
                let first = open
                    .pop()
                    .ok_or_else(|| format!("{path}:{}: unbalanced braces", line_of(text, start)))?;
                objects.push((first, start));
            }
            _ => {}
        }
    }
    if let Some(&start) = open.last() {
        return Err(format!(
            "{path}:{}: unbalanced braces",
            line_of(text, start)
        ));
    }
    Ok(objects)
}

/// The innermost object literal holding `offset`, by its opening brace.
fn owner(objects: &[(usize, usize)], offset: usize) -> Option<usize> {
    objects
        .iter()
        .filter(|&&(open, close)| open < offset && offset < close)
        .map(|&(open, _)| open)
        .max()
}

/// The image builds of one stack file. Each `buildArgs:` must be a key of the
/// same object literal as a literal `dockerfile:`; one anywhere else (a nested
/// object, another call) fails rather than binding to a nearby build.
pub fn consumers(path: &str, text: &str) -> Result<Vec<Consumer>, String> {
    let objects = objects(path, text)?;
    let keys = keys(path, text)?;
    let mut builds: Vec<(usize, Consumer)> = Vec::new();
    for &(_, start, end) in keys.iter().filter(|&&(key, _, _)| key == "dockerfile") {
        let source = format!("{path}:{}", line_of(text, start));
        let object = owner(&objects, start)
            .ok_or_else(|| format!("{source}: dockerfile is not inside an object literal"))?;
        reject_overrides(path, text, &objects, object)?;
        if builds.iter().any(|(owner, _)| *owner == object) {
            return Err(format!("{source}: several dockerfile keys in one object"));
        }
        let dockerfile = lazy_regex::regex_captures!(
            r#"^\s*(?:'([^']+)'|"([^"]+)"|`\$\{REPO_ROOT\}/([^`$]+)`)\s*[,}]"#,
            &text[end..]
        )
        .map(|(_, single, double, template)| {
            [single, double, template]
                .into_iter()
                .find(|captured| !captured.is_empty())
                .unwrap_or_default()
                .to_owned()
        })
        .ok_or_else(|| format!("{source}: dockerfile is not a string literal"))?;
        builds.push((
            object,
            Consumer {
                source,
                dockerfile,
                args: BTreeMap::new(),
            },
        ));
    }
    let mut bound = Vec::new();
    for &(_, start, end) in keys.iter().filter(|&&(key, _, _)| key == "buildArgs") {
        let object = owner(&objects, start);
        let Some((_, consumer)) = builds.iter_mut().find(|(owner, _)| Some(*owner) == object)
        else {
            return Err(format!(
                "{path}:{}: buildArgs is not in the object of a literal dockerfile",
                line_of(text, start)
            ));
        };
        if bound.contains(&object) {
            return Err(format!(
                "{}: several buildArgs for one dockerfile",
                consumer.source
            ));
        }
        bound.push(object);
        consumer.args = build_args(&consumer.source, &text[end..])?;
    }
    Ok(builds.into_iter().map(|(_, consumer)| consumer).collect())
}

fn build_args(source: &str, text: &str) -> Result<BTreeMap<String, String>, String> {
    let (_, body) = lazy_regex::regex_captures!(r"^\s*\{([^{}]*)\}", text)
        .ok_or_else(|| format!("{source}: buildArgs is not a flat object literal"))?;
    let mut args = BTreeMap::new();
    for entry in body
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
    {
        let (_, name, single, double) =
            lazy_regex::regex_captures!(r#"^([A-Z][A-Z0-9_]*):\s*(?:'([^']*)'|"([^"]*)")$"#, entry)
                .ok_or_else(|| format!("{source}: build arg `{entry}` is not NAME: 'literal'"))?;
        let value = if double.is_empty() { single } else { double };
        args.insert(name.to_owned(), value.to_owned());
    }
    Ok(args)
}

/// Tokens retain their source offsets; strings and comments must never turn
/// punctuation inside a value into an enclosing object's property syntax.
#[derive(logos::Logos)]
#[logos(skip r"[\s\u{feff}]+")]
// Consuming an entire line comment is intentional; unlike a fallback
// token this pattern is entered only after the literal `//` prefix.
#[logos(skip(r"//[^\r\n\u{2028}\u{2029}]*", allow_greedy = true))]
#[logos(skip r"/\*([^*]|\*+[^*/])*\*+/")]
enum Token {
    #[regex(r"[A-Za-z_$][A-Za-z0-9_$]*")]
    Word,
    #[token(r"\u")]
    IdentifierEscape,
    #[regex(r#"'([^'\\]|\\.)*'|"([^"\\]|\\.)*"|`([^`\\]|\\.)*`"#)]
    String,
    #[token("...")]
    Spread,
    #[regex(r"[^\s]", priority = 0)]
    Punctuation,
}

fn tokens(path: &str, text: &str) -> Result<Vec<(usize, usize)>, String> {
    use logos::Logos;
    let mut tokens = Vec::new();
    for (kind, span) in Token::lexer(text).spanned() {
        let kind = kind.map_err(|_| {
            format!(
                "{path}:{}: unsupported TypeScript token",
                line_of(text, span.start)
            )
        })?;
        // Refuse the unquoted escape introducer before identifier fragments
        // could conceal a dockerfile/buildArgs key. No codepoint spelling is
        // admitted; quoted values and comments remain separate whole tokens.
        if matches!(kind, Token::IdentifierEscape) {
            return Err(format!(
                "{path}:{}: escaped identifiers are unsupported",
                line_of(text, span.start)
            ));
        }
        tokens.push((span.start, span.end));
    }
    Ok(tokens)
}

/// Return the exact key and colon spans. Quoted/computed keys are refused
/// rather than silently omitting a second consumer next to a recognised one.
fn keys<'a>(path: &str, text: &'a str) -> Result<Vec<(&'a str, usize, usize)>, String> {
    let tokens = tokens(path, text)?;
    let mut keys = Vec::new();
    for (index, &(start, end)) in tokens.iter().enumerate() {
        let word = &text[start..end];
        let key = word.trim_matches(['\'', '"', '`']);
        let next = tokens.get(index + 1).map(|&(start, end)| &text[start..end]);
        let computed = next == Some("]")
            && tokens
                .get(index + 2)
                .is_some_and(|&(start, end)| &text[start..end] == ":");
        if word != key && word.contains('\\') && (next == Some(":") || computed) {
            return Err(format!(
                "{path}:{}: escaped property keys are unsupported",
                line_of(text, start)
            ));
        }
        if !matches!(key, "dockerfile" | "buildArgs") {
            continue;
        }
        if computed || (word != key && next == Some(":")) {
            return Err(format!(
                "{path}:{}: quoted or computed {key} key is unsupported",
                line_of(text, start)
            ));
        }
        if next == Some(":") {
            keys.push((key, start, tokens[index + 1].1));
        }
    }
    Ok(keys)
}

fn reject_overrides(
    path: &str,
    text: &str,
    objects: &[(usize, usize)],
    image: usize,
) -> Result<(), String> {
    let tokens = tokens(path, text)?;
    for (index, &(start, end)) in tokens.iter().enumerate() {
        let word = &text[start..end];
        let at_key =
            index > 0 && matches!(&text[tokens[index - 1].0..tokens[index - 1].1], "{" | ",");
        if matches!(word, "..." | "[") && at_key && owner(objects, start) == Some(image) {
            return Err(format!(
                "{path}:{}: image options contain a spread or computed property",
                line_of(text, start)
            ));
        }
    }
    Ok(())
}
