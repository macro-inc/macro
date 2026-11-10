//! Build a stored HTML document: its `text/macro` programs and its TypeScript
//! client script become bundles, and the page the preview loads.
//!
//! Each `<script type="text/macro" id="…" lang="ts">` block is a program whose
//! default export takes `(args, { macro }: ProgramContext)` and returns plain
//! JSON. The one `<script type="module" lang="ts">` imports those programs,
//! typed, from `macro:programs`, and `on` from `macro:client`. Programs are
//! type-checked on their own, then with the client, so a call with the wrong
//! arguments fails the build. Each program bundles alone and the client
//! bundles without any program source, so server code never reaches the page.

use code_execution::domain::{
    Bundle, BundleTarget, CheckError, Diagnostic, Limits, ProgramBundler, ProgramChecker,
    SourceFile,
};
use lol_html::{RewriteStrSettings, element, html_content::ContentType, rewrite_str, text};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{cell::RefCell, collections::BTreeMap};

/// Programs one document may hold.
pub const MAX_PROGRAMS: usize = 16;

const PROGRAM_SELECTOR: &str = r#"script[type="text/macro"]"#;
const CLIENT_SELECTOR: &str = r#"script[type="module"][lang="ts"]"#;
const CLIENT_FILE: &str = "client.ts";
const PROGRAMS_FILE: &str = "programs.ts";
const MACRO_CLIENT_FILE: &str = "macro_client.ts";
const ENTRY_FILE: &str = "entry.ts";
/// `macro:client`, the typed face of the frame's injected `window.macro`.
const MACRO_CLIENT: &str = include_str!("macro_client.ts");
/// What a program's second argument is.
const PROGRAM_CONTEXT: &str = "import type { Macro } from '@macro-inc/sdk';\n\
declare global {\n\
  /** What a program receives beside its arguments: the SDK, signed in as the viewer. */\n\
  interface ProgramContext { macro: Macro }\n\
}\n";
/// Words a program id can't be: the generated `macro:programs` declares each
/// id as a `const` beside its `run` import, so reserved words, strict-mode
/// bindings and `run` would not compile.
const RESERVED_IDS: &[&str] = &[
    "arguments",
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "debugger",
    "default",
    "delete",
    "do",
    "else",
    "enum",
    "eval",
    "export",
    "extends",
    "false",
    "finally",
    "for",
    "function",
    "if",
    "implements",
    "import",
    "in",
    "instanceof",
    "interface",
    "let",
    "new",
    "null",
    "package",
    "private",
    "protected",
    "public",
    "return",
    "run",
    "static",
    "super",
    "switch",
    "this",
    "throw",
    "true",
    "try",
    "typeof",
    "var",
    "void",
    "while",
    "with",
    "yield",
];
/// What a program's arguments check reports when its first parameter isn't
/// an object; [`named`] replaces it with [`object_arguments_problem`].
const NOT_AN_OBJECT: &str = "first parameter is not an object";
/// The client's check adds the browser's types.
const DOM_REFERENCE: &str =
    "/// <reference lib=\"dom\" />\n/// <reference lib=\"dom.iterable\" />\n";

/// A program's id: its block's `id`, and the name the client imports.
#[nutype::nutype(
    validate(predicate = is_identifier),
    derive(
        Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, AsRef, Display, Serialize,
        Deserialize
    )
)]
pub struct ProgramId(String);

fn is_identifier(id: &str) -> bool {
    let mut chars = id.chars();
    let starts = chars
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic() || first == '_');
    starts
        && chars.all(|rest| rest.is_ascii_alphanumeric() || rest == '_')
        && id.len() <= 64
        && !RESERVED_IDS.contains(&id)
}

/// The SHA-256 of a document's source, in lowercase hex: which build a page
/// was rendered from.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct SourceHash(String);

impl SourceHash {
    /// The hash of `source`.
    pub fn of(source: &str) -> Self {
        Self(hex::encode(Sha256::digest(source.as_bytes())))
    }
}

impl AsRef<str> for SourceHash {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for SourceHash {
    type Error = InvalidSourceHash;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        let hex = value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));
        if value.len() == 64 && hex {
            Ok(Self(value))
        } else {
            Err(InvalidSourceHash)
        }
    }
}

impl From<SourceHash> for String {
    fn from(hash: SourceHash) -> Self {
        hash.0
    }
}

/// Not 64 lowercase hex digits.
#[derive(Debug, thiserror::Error)]
#[error("a source hash is 64 lowercase hex digits")]
pub struct InvalidSourceHash;

/// A document's build: the page and each program's bundle, or why it failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BuildOutcome {
    /// The page to render and the bundle each program id runs.
    Built {
        /// The document with programs removed and the client script bundled.
        html: String,
        /// Each program's bundle, an ES module exporting the runtime's `main`.
        programs: BTreeMap<ProgramId, String>,
    },
    /// The author's problems: invalid blocks, type errors, failed bundles.
    Failed(Vec<Diagnostic>),
    /// Neither programs nor a client script: an ordinary page, shown as it is.
    Plain,
}

/// The source's blocks, before checking.
struct Extracted {
    programs: Vec<(ProgramId, String)>,
    client: Option<String>,
}

/// Build `html`. `Err` is the toolchain failing, never the author's mistake.
pub async fn build(
    html: &str,
    checker: &dyn ProgramChecker,
    bundler: &dyn ProgramBundler,
) -> Result<BuildOutcome, CheckError> {
    let extracted = match extract(html) {
        Ok(extracted) => extracted,
        Err(diagnostics) => return Ok(BuildOutcome::Failed(diagnostics)),
    };
    if extracted.programs.is_empty() && extracted.client.is_none() {
        return Ok(BuildOutcome::Plain);
    }
    let ids: Vec<ProgramId> = extracted
        .programs
        .iter()
        .map(|(id, _)| id.clone())
        .collect();
    let rename = |diagnostics: Vec<Diagnostic>| BuildOutcome::Failed(named(diagnostics, &ids));
    let program_files: Vec<SourceFile> = extracted
        .programs
        .iter()
        .enumerate()
        .map(|(index, (_, source))| SourceFile {
            name: program_file(index),
            source: source.clone(),
        })
        .collect();

    if !program_files.is_empty() {
        let argument_checks = (0..program_files.len()).map(|index| SourceFile {
            name: arguments_file(index),
            source: arguments_module(index),
        });
        let checked: Vec<SourceFile> = program_files
            .iter()
            .cloned()
            .chain(argument_checks)
            .collect();
        let problems = check_verdict(checker.check_files(&checked, PROGRAM_CONTEXT).await)?;
        if !problems.is_empty() {
            return Ok(rename(problems));
        }
    }

    let mut client_files = Vec::new();
    if let Some(client) = &extracted.client {
        client_files = vec![
            SourceFile {
                name: CLIENT_FILE.to_owned(),
                source: client.clone(),
            },
            SourceFile {
                name: PROGRAMS_FILE.to_owned(),
                source: programs_module(&ids),
            },
            SourceFile {
                name: MACRO_CLIENT_FILE.to_owned(),
                source: MACRO_CLIENT.to_owned(),
            },
        ];
        let checked_together: Vec<SourceFile> =
            client_files.iter().chain(&program_files).cloned().collect();
        let declarations = format!("{DOM_REFERENCE}{PROGRAM_CONTEXT}");
        let problems = check_verdict(checker.check_files(&checked_together, &declarations).await)?;
        if !problems.is_empty() {
            return Ok(rename(problems));
        }
    }

    let mut programs = BTreeMap::new();
    for (index, (id, source)) in extracted.programs.iter().enumerate() {
        let files = [
            SourceFile {
                name: program_file(index),
                source: source.clone(),
            },
            SourceFile {
                name: ENTRY_FILE.to_owned(),
                source: entry_module(index),
            },
        ];
        let code =
            match bundle_verdict(bundler.bundle(&files, ENTRY_FILE, BundleTarget::Deno).await)? {
                Bundle::Code(code) => code,
                Bundle::Rejected(problems) => return Ok(rename(problems)),
            };
        // A run refuses a bundle over the runtime's module limit, so the
        // build does too, where the author can see it.
        let limit = Limits::default().max_source_bytes;
        if code.len() > limit {
            return Ok(BuildOutcome::Failed(vec![Diagnostic {
                file: Some(format!("program {id}")),
                message: format!(
                    "Program `{id}` bundles to {} KiB; a program may be at most {} KiB once bundled. Move what the page can do itself into the client script, or split the program.",
                    code.len().div_ceil(1024),
                    limit / 1024
                ),
            }]));
        }
        programs.insert(id.clone(), code);
    }

    let mut client_bundle = None;
    if !client_files.is_empty() {
        match bundle_verdict(
            bundler
                .bundle(&client_files, CLIENT_FILE, BundleTarget::Browser)
                .await,
        )? {
            Bundle::Code(code) => client_bundle = Some(code),
            Bundle::Rejected(problems) => return Ok(rename(problems)),
        }
    }
    // The bundler escapes `</script` in what it emits; a page whose script
    // could still close its own tag is refused rather than rendered broken.
    if client_bundle
        .as_deref()
        .is_some_and(|code| code.to_ascii_lowercase().contains("</script"))
    {
        return Ok(BuildOutcome::Failed(vec![problem(
            "The client script contains `</script`, which would end it early; escape it as `<\\/script`.",
        )]));
    }

    match assemble(html, client_bundle.as_deref()) {
        Ok(html) => Ok(BuildOutcome::Built { html, programs }),
        Err(error) => Ok(BuildOutcome::Failed(vec![problem(&format!(
            "The page could not be assembled: {error}"
        ))])),
    }
}

/// The checker's verdict; an oversized module is the author's problem, any
/// other failure the toolchain's.
fn check_verdict(
    result: Result<Vec<Diagnostic>, CheckError>,
) -> Result<Vec<Diagnostic>, CheckError> {
    match result {
        Err(CheckError::InvalidSource) => Ok(vec![oversized()]),
        other => other,
    }
}

/// The bundler's verdict, read the same way as the checker's.
fn bundle_verdict(result: Result<Bundle, CheckError>) -> Result<Bundle, CheckError> {
    match result {
        Err(CheckError::InvalidSource) => Ok(Bundle::Rejected(vec![oversized()])),
        other => other,
    }
}

fn oversized() -> Diagnostic {
    problem("A program or the client script is larger than a module may be.")
}

/// Collect the blocks and refuse ones the build can't name.
fn extract(html: &str) -> Result<Extracted, Vec<Diagnostic>> {
    let blocks: RefCell<Vec<(Option<String>, String)>> = RefCell::default();
    let clients: RefCell<Vec<String>> = RefCell::default();
    let collected = rewrite_str(
        html,
        RewriteStrSettings {
            element_content_handlers: vec![
                element!(PROGRAM_SELECTOR, |element| {
                    blocks
                        .borrow_mut()
                        .push((element.get_attribute("id"), String::new()));
                    Ok(())
                }),
                text!(PROGRAM_SELECTOR, |chunk| {
                    if let Some((_, source)) = blocks.borrow_mut().last_mut() {
                        source.push_str(chunk.as_str());
                    }
                    Ok(())
                }),
                element!(CLIENT_SELECTOR, |_| {
                    clients.borrow_mut().push(String::new());
                    Ok(())
                }),
                text!(CLIENT_SELECTOR, |chunk| {
                    if let Some(source) = clients.borrow_mut().last_mut() {
                        source.push_str(chunk.as_str());
                    }
                    Ok(())
                }),
            ],
            ..RewriteStrSettings::new()
        },
    );
    if let Err(error) = collected {
        return Err(vec![problem(&format!(
            "The page could not be read: {error}"
        ))]);
    }

    let blocks = blocks.into_inner();
    let mut clients = clients.into_inner();
    let mut problems = Vec::new();
    if blocks.len() > MAX_PROGRAMS {
        problems.push(problem(&format!(
            "A document may hold at most {MAX_PROGRAMS} programs; this one has {}.",
            blocks.len()
        )));
    }
    if clients.len() > 1 {
        problems.push(problem(
            "A document may have one `<script type=\"module\" lang=\"ts\">`; merge them into one.",
        ));
    }

    let mut programs: Vec<(ProgramId, String)> = Vec::new();
    for (id, source) in blocks {
        let Some(id) = id else {
            problems.push(problem(
                "Every `<script type=\"text/macro\">` needs an `id`.",
            ));
            continue;
        };
        if RESERVED_IDS.contains(&id.as_str()) {
            problems.push(problem(&format!(
                "Program id `{id}` is a reserved word in JavaScript or `macro:programs`; rename it."
            )));
            continue;
        }
        let Ok(program) = ProgramId::try_new(id.clone()) else {
            problems.push(problem(&format!(
                "Program id `{id}` must be a JavaScript identifier: letters, digits and `_`, not starting with a digit."
            )));
            continue;
        };
        if programs.iter().any(|(existing, _)| existing == &program) {
            problems.push(problem(&format!("Two programs have the id `{id}`.")));
            continue;
        }
        if source.trim().is_empty() {
            problems.push(problem(&format!("Program `{id}` is empty.")));
            continue;
        }
        programs.push((program, source));
    }

    if clients
        .last()
        .is_some_and(|client| client.trim().is_empty())
    {
        problems.push(problem(
            "The `<script type=\"module\" lang=\"ts\">` is empty; write the client script or remove it.",
        ));
    }

    if !problems.is_empty() {
        return Err(problems);
    }
    Ok(Extracted {
        programs,
        client: clients.pop(),
    })
}

/// The page with program blocks removed and the client script replaced by
/// its bundle.
fn assemble(
    html: &str,
    client_bundle: Option<&str>,
) -> Result<String, lol_html::errors::RewritingError> {
    rewrite_str(
        html,
        RewriteStrSettings {
            element_content_handlers: vec![
                element!(PROGRAM_SELECTOR, |element| {
                    element.remove();
                    Ok(())
                }),
                element!(CLIENT_SELECTOR, |element| {
                    element.remove_attribute("lang");
                    if let Some(code) = client_bundle {
                        element.set_inner_content(code, ContentType::Html);
                    }
                    Ok(())
                }),
            ],
            ..RewriteStrSettings::new()
        },
    )
}

/// `macro:programs`: each program as a typed function that runs it by id.
/// The argument may be left out when an empty object would satisfy it. Each
/// resolves to the program's value as the page receives it: its JSON form.
fn programs_module(ids: &[ProgramId]) -> String {
    let mut module = String::from(include_str!("programs_prelude.ts"));
    for (index, id) in ids.iter().enumerate() {
        let file = program_file(index);
        module.push_str(&format!(
            "type Program{index} = typeof import('./{file}').default;\n\
             export const {id} = (...args: ArgsOf<Program{index}>): Promise<Returned<Awaited<ReturnType<Program{index}>>>> =>\n  \
               run('{id}', args.at(0) ?? {{}});\n"
        ));
    }
    module
}

/// Checks that a program's first parameter, if it has one, is an object:
/// the page always calls it with one.
fn arguments_module(index: usize) -> String {
    let file = program_file(index);
    format!(
        "import type program from './{file}';\n\
         type Argument<P> = P extends (...args: infer A) => unknown\n  \
           ? A extends [] ? 'ok'\n  \
           : 0 extends 1 & A[0] ? 'ok'\n  \
           : [NonNullable<A[0]>] extends [readonly unknown[]] ? '{NOT_AN_OBJECT}'\n  \
           : [NonNullable<A[0]>] extends [(...args: never[]) => unknown] ? '{NOT_AN_OBJECT}'\n  \
           : [NonNullable<A[0]>] extends [object] ? 'ok'\n  \
           : '{NOT_AN_OBJECT}'\n  \
           : 'ok';\n\
         export const checked: Argument<typeof program> = 'ok';\n"
    )
}

fn arguments_file(index: usize) -> String {
    format!("program_{index}_args.ts")
}

fn object_arguments_problem(id: &ProgramId) -> String {
    format!(
        "Program `{id}`'s first parameter must be an object type, such as `{{ query: string }}`: the page always passes its arguments as one object."
    )
}

/// The runtime's `main({ macro, ...args })`, calling the program's default
/// export and wrapping its value as the runtime's `{ data }`.
fn entry_module(index: usize) -> String {
    let file = program_file(index);
    format!(
        "import program from './{file}';\n\
         export async function main({{ macro, ...args }}) {{\n  \
           return {{ data: (await program(args, {{ macro }})) ?? null }};\n\
         }}\n"
    )
}

fn program_file(index: usize) -> String {
    format!("program_{index}.ts")
}

/// Diagnostics name what the author wrote, not the generated files.
fn named(diagnostics: Vec<Diagnostic>, ids: &[ProgramId]) -> Vec<Diagnostic> {
    diagnostics
        .into_iter()
        .map(|diagnostic| {
            let arguments_of = diagnostic.file.as_deref().and_then(|file| {
                ids.iter()
                    .enumerate()
                    .find(|(index, _)| arguments_file(*index) == file)
                    .map(|(_, id)| id)
            });
            if let Some(id) = arguments_of
                && diagnostic.message.contains(NOT_AN_OBJECT)
            {
                return Diagnostic {
                    file: Some(format!("program {id}")),
                    message: object_arguments_problem(id),
                };
            }

            let mut message = diagnostic.message;
            // Highest index first, so `program_1` doesn't rewrite `program_10`.
            for (index, id) in ids.iter().enumerate().rev() {
                message = message
                    .replace(&arguments_file(index), &format!("program {id}"))
                    .replace(&program_file(index), &format!("program {id}"));
            }
            // `macro_client.ts` first, since it ends in `client.ts`.
            message = message
                .replace(MACRO_CLIENT_FILE, "macro:client")
                .replace(CLIENT_FILE, "client script")
                .replace(PROGRAMS_FILE, "macro:programs");
            let file = diagnostic.file.map(|file| {
                ids.iter()
                    .enumerate()
                    .find(|(index, _)| {
                        program_file(*index) == file || arguments_file(*index) == file
                    })
                    .map(|(_, id)| format!("program {id}"))
                    .unwrap_or_else(|| match file.as_str() {
                        CLIENT_FILE => "client script".to_owned(),
                        PROGRAMS_FILE => "macro:programs".to_owned(),
                        MACRO_CLIENT_FILE => "macro:client".to_owned(),
                        _ => file,
                    })
            });
            Diagnostic { file, message }
        })
        .collect()
}

fn problem(message: &str) -> Diagnostic {
    Diagnostic {
        file: None,
        message: message.to_owned(),
    }
}

#[cfg(test)]
mod test;
