//! Host-tokenized Source code highlighting. The host's tokenizer (the app's Prism) returns
//! `$mapTokensToLexicalStructure`-shaped descriptors; the model validates them and applies Source
//! `getDiffRange` reuse inside the same transform, so tokens are authored where Source authors them.
use super::*;
use lexical_rich_nodes::code::CodeHighlightNode;
use std::sync::Arc;

#[cfg(test)]
mod test;

/// Pure, synchronous host tokenizer, split like Source: `isCodeLanguageLoaded` runs on every
/// transform pass, `$tokenize` only after the per-update dedupe admits the node. It gets no editor
/// or session access and must not reenter.
pub trait CodeTokenProvider: Send + Sync {
    /// Source `isCodeLanguageLoaded(language)`.
    fn is_loaded(&self, request: &CodeLanguageRequest<'_>) -> Result<bool, CodeTokenError>;
    /// Source `tokenizer.$tokenize` for a loaded language.
    fn tokenize(&self, request: &CodeTokenRequest<'_>) -> Result<Vec<CodeToken>, CodeTokenError>;
}

/// One language-availability check.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CodeLanguageRequest<'a> {
    /// The code node's language after the Source default.
    pub language: &'a str,
    /// Immutable identity of the host tokenizer configuration.
    pub profile: &'a str,
}

/// One tokenization request, read from the pending transaction.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CodeTokenRequest<'a> {
    /// The code node's language after the Source default.
    pub language: &'a str,
    /// The code node's current text content.
    pub text: &'a str,
    /// Immutable identity of the host tokenizer configuration.
    pub profile: &'a str,
}

/// One `$mapTokensToLexicalStructure` output node.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CodeToken {
    /// A non-empty run without line breaks or tabs.
    Text {
        /// Run text.
        text: String,
        /// Prism token type; None for untyped runs.
        highlight_type: Option<String>,
    },
    /// A line break.
    LineBreak,
    /// A tab.
    Tab,
}

/// Host tokenizer failure; carries no document content.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum CodeTokenError {
    /// The host tokenizer threw or was retired.
    #[error("host code tokenizer failed")]
    Host,
    /// The host tokenizer threw; the host retains the thrown value as `cause` of the current
    /// session entry. Same text as `Host`: the formatted error never carries the value.
    #[error("host code tokenizer failed")]
    Thrown {
        /// Host-assigned id of the thrown value within the current entry.
        cause: u32,
    },
    /// The host returned descriptors that do not reproduce the requested text.
    #[error("host code tokens do not match the code text")]
    Mismatch,
}

/// The session's tokenizer, installed once at builder construction.
#[derive(Clone)]
pub struct CodeTokens {
    provider: Option<Arc<dyn CodeTokenProvider>>,
    profile: Arc<str>,
}
impl CodeTokens {
    /// No tokenizer: the transform reports every language as not loaded (JNI profile).
    pub fn none() -> Self {
        Self {
            provider: None,
            profile: Arc::from("none"),
        }
    }
    /// A host tokenizer and its configuration identity.
    pub fn new(provider: Arc<dyn CodeTokenProvider>, profile: &str) -> Self {
        Self {
            provider: Some(provider),
            profile: Arc::from(profile),
        }
    }
    /// Whether a host tokenizer is installed: the code-highlighting activation (C) gate.
    pub fn is_active(&self) -> bool {
        self.provider.is_some()
    }
}
impl Default for CodeTokens {
    fn default() -> Self {
        Self::none()
    }
}

/// Source `isCodeLanguageLoaded`; with no tokenizer every language is not loaded.
pub(super) fn is_loaded(tx: &Transaction<'_>, language: &str) -> Result<bool, Error> {
    let tokens = tx.extension::<CodeTokens>()?;
    let Some(provider) = &tokens.provider else {
        return Ok(false);
    };
    provider
        .is_loaded(&CodeLanguageRequest {
            language,
            profile: &tokens.profile,
        })
        .map_err(|error| Error::Extension(Box::new(error)))
}

/// Source `$tokenize` for a loaded language, validated before any token node is created.
pub(super) fn tokenize(
    tx: &Transaction<'_>,
    language: &str,
    text: &str,
) -> Result<Vec<CodeToken>, Error> {
    let tokens = tx.extension::<CodeTokens>()?;
    let provider = tokens
        .provider
        .as_ref()
        .ok_or(Error::Invariant("tokenize without a code tokenizer"))?;
    let descriptors = provider
        .tokenize(&CodeTokenRequest {
            language,
            text,
            profile: &tokens.profile,
        })
        .map_err(|error| Error::Extension(Box::new(error)))?;
    validate(text, &descriptors).map_err(|error| Error::Extension(Box::new(error)))?;
    Ok(descriptors)
}

/// The descriptors must reproduce `text` exactly before any token node is created.
fn validate(text: &str, tokens: &[CodeToken]) -> Result<(), CodeTokenError> {
    let mut rebuilt = String::with_capacity(text.len());
    for token in tokens {
        match token {
            CodeToken::Text { text, .. } => {
                if text.is_empty() || text.contains(['\n', '\t']) {
                    return Err(CodeTokenError::Mismatch);
                }
                rebuilt.push_str(text);
            }
            CodeToken::LineBreak => rebuilt.push('\n'),
            CodeToken::Tab => rebuilt.push('\t'),
        }
    }
    if rebuilt == text {
        Ok(())
    } else {
        Err(CodeTokenError::Mismatch)
    }
}

/// Source `isEqual`: code-highlight by text and type, tab and line break by kind; plain text never.
fn same_token(tx: &Transaction<'_>, current: NodeKey, next: &CodeToken) -> bool {
    match next {
        CodeToken::Text {
            text,
            highlight_type,
        } => {
            tx.view()
                .get::<CodeHighlightNode>(current)
                .is_some_and(|node| &node.highlight_type == highlight_type)
                && tx.text_content(current) == text.as_str()
        }
        CodeToken::LineBreak => tx.is_line_break(current),
        CodeToken::Tab => tx.is::<Tab>(current),
    }
}

fn create(tx: &mut Transaction<'_>, token: &CodeToken) -> Result<NodeKey, Error> {
    Ok(match token {
        CodeToken::Text {
            text,
            highlight_type,
        } => {
            let node = tx.create(CodeHighlightNode {
                highlight_type: highlight_type.clone(),
            })?;
            tx.text(node)?.set_text_content(text)?;
            node.key()
        }
        CodeToken::LineBreak => tx.create(LineBreak {})?.key(),
        CodeToken::Tab => tx.create(Tab {})?.key(),
    })
}

/// Source `getDiffRange` + `splice` inside `$updateAndRetainSelection`. Unchanged children are not
/// touched, so an unchanged pass leaves the node clean.
///
/// Known frontier: Source constructs every candidate highlight node before `getDiffRange` and
/// discards the matched ones; this creates only the changed middle. Retained keys and stored results
/// match, but key-allocator advancement and constructor/replacement callbacks for discarded candidates
/// are not qualified; record a control before claiming registered/custom factory parity.
pub(super) fn apply(
    tx: &mut Transaction<'_>,
    code: NodeKey,
    tokens: &[CodeToken],
) -> Result<(), Error> {
    let previous = tx.children_keys(code)?;
    let mut leading = 0;
    while leading < previous.len().min(tokens.len())
        && same_token(tx, previous[leading], &tokens[leading])
    {
        leading += 1;
    }
    let max_trailing = previous.len().min(tokens.len()) - leading;
    let mut trailing = 0;
    while trailing < max_trailing
        && same_token(
            tx,
            previous[previous.len() - trailing - 1],
            &tokens[tokens.len() - trailing - 1],
        )
    {
        trailing += 1;
    }
    let from = leading;
    let to = previous.len() - trailing;
    let replacement = &tokens[leading..tokens.len() - trailing];
    if from == to && replacement.is_empty() {
        return Ok(());
    }
    let caret = normalize::capture_caret(tx, code);
    let mut nodes = Vec::with_capacity(replacement.len());
    for token in replacement {
        nodes.push(create(tx, token)?);
    }
    tx.splice(code, ChildIndex(from as u32), (to - from) as u32, &nodes)?;
    normalize::restore_caret(tx, code, caret)
}
