//! How serde puts a message type on the wire, read from its attributes, and
//! the `match` column that recognises each message in JSON.

use rootcause::prelude::*;
use syn::{Fields, Item, ItemEnum, ItemStruct, Type};

use crate::attrs;
use crate::repo::{Loc, Repo};
use crate::sources::ItemRef;

#[cfg(test)]
mod test;

/// The `match` column of a message that is recognised by its queue alone.
const MATCH_ANY: &str = "*";

/// One message type: an enum variant, or a whole struct.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Message {
    /// The variant's or struct's Rust name.
    pub(crate) ident: String,
    pub(crate) matcher: String,
    pub(crate) loc: Loc,
}

/// A top-level enum or struct of a file.
pub(crate) enum TypeItem<'a> {
    Enum(&'a ItemEnum),
    Struct(&'a ItemStruct),
}

pub(crate) fn find_type<'a>(file: &'a syn::File, ident: &str) -> Option<TypeItem<'a>> {
    file.items.iter().find_map(|item| match item {
        Item::Enum(item) if item.ident == ident => Some(TypeItem::Enum(item)),
        Item::Struct(item) if item.ident == ident => Some(TypeItem::Struct(item)),
        _ => None,
    })
}

/// The message types of `item`: one per variant of an enum, or the struct
/// itself. `at` is the JSON pointer of the value in the message body.
pub(crate) fn messages(repo: &Repo, item: &ItemRef, at: &str) -> Result<Vec<Message>, Report> {
    let file = repo.parse(&item.file)?;
    match find_type(&file, &item.ident) {
        Some(TypeItem::Enum(item_enum)) => variants(item_enum, &item.file, at),
        Some(TypeItem::Struct(item_struct)) => Ok(vec![Message {
            ident: item.ident.clone(),
            matcher: MATCH_ANY.to_owned(),
            loc: Loc::new(&item.file, item_struct.ident.span()),
        }]),
        None => bail!(
            "{}:1: no top-level enum or struct `{}`",
            item.file,
            item.ident
        ),
    }
}

fn variants(item: &ItemEnum, file: &str, at: &str) -> Result<Vec<Message>, Report> {
    let loc = Loc::new(file, item.ident.span());
    let container = attrs::args(&item.attrs, "serde", file)?;
    if attrs::has(&container, "untagged") {
        bail!(
            "{loc}: `{}` is untagged, so its variants cannot be told apart by a tag",
            item.ident
        );
    }
    let tag = attrs::value(&container, "tag", &loc)?;
    let rename_all = attrs::value(&container, "rename_all", &loc)?;

    let mut found = Vec::new();
    for variant in &item.variants {
        let loc = Loc::new(file, variant.ident.span());
        let ident = variant.ident.to_string();
        let own = attrs::args(&variant.attrs, "serde", file)?;
        if attrs::has(&own, "skip") {
            continue;
        }
        if attrs::has(&own, "untagged") || attrs::has(&own, "other") {
            bail!("{loc}: `{ident}` has no tag of its own on the wire");
        }

        let name = match (attrs::value(&own, "rename", &loc)?, rename_all) {
            (Some(renamed), _) => renamed.to_owned(),
            (None, Some(rule)) => rename_variant(rule, &ident, &loc)?,
            (None, None) => ident.clone(),
        };

        // Internally and adjacently tagged enums both carry the variant name
        // in the tag field. Externally tagged ones are the bare name for a
        // unit variant and a single-key object otherwise.
        let matcher = match (tag, &variant.fields) {
            (Some(tag), _) => format!("{at}/{}={name}", pointer_token(tag)),
            (None, Fields::Unit) => format!("{at}={name}"),
            (None, _) => format!("{at}/{}", pointer_token(&name)),
        };
        found.push(Message {
            ident,
            matcher,
            loc,
        });
    }
    Ok(found)
}

/// The JSON pointer of the `inner` type inside the `envelope` struct: the
/// wire name of the one field whose type is `inner`.
pub(crate) fn envelope_pointer(
    repo: &Repo,
    envelope: &ItemRef,
    inner: &str,
) -> Result<String, Report> {
    let file = repo.parse(&envelope.file)?;
    let Some(TypeItem::Struct(item)) = find_type(&file, &envelope.ident) else {
        bail!(
            "{}:1: no top-level struct `{}`",
            envelope.file,
            envelope.ident
        );
    };
    let loc = Loc::new(&envelope.file, item.ident.span());
    let container = attrs::args(&item.attrs, "serde", &envelope.file)?;
    let rename_all = attrs::value(&container, "rename_all", &loc)?;

    let mut holding = item.fields.iter().filter(|field| match &field.ty {
        Type::Path(ty) => ty
            .path
            .segments
            .last()
            .is_some_and(|segment| segment.ident == inner),
        _ => false,
    });
    let (Some(field), None) = (holding.next(), holding.next()) else {
        bail!(
            "{loc}: `{}` does not have exactly one field of type `{inner}`",
            envelope.ident
        );
    };
    let Some(ident) = &field.ident else {
        bail!("{loc}: `{}` has no named fields", envelope.ident);
    };

    let loc = Loc::new(&envelope.file, ident.span());
    let own = attrs::args(&field.attrs, "serde", &envelope.file)?;
    if attrs::has(&own, "flatten") {
        return Ok(String::new());
    }
    let name = match (attrs::value(&own, "rename", &loc)?, rename_all) {
        (Some(renamed), _) => renamed.to_owned(),
        (None, Some(rule)) => rename_field(rule, &ident.to_string(), &loc)?,
        (None, None) => ident.to_string(),
    };
    Ok(format!("/{}", pointer_token(&name)))
}

/// Escapes a name for use as one JSON pointer token (RFC 6901).
fn pointer_token(name: &str) -> String {
    name.replace('~', "~0").replace('/', "~1")
}

/// serde's `rename_all` applied to a variant name, which is PascalCase.
fn rename_variant(rule: &str, ident: &str, loc: &Loc) -> Result<String, Report> {
    let snake = || {
        let mut snake = String::new();
        for (index, letter) in ident.char_indices() {
            if index > 0 && letter.is_uppercase() {
                snake.push('_');
            }
            snake.push(letter.to_ascii_lowercase());
        }
        snake
    };

    Ok(match rule {
        "PascalCase" => ident.to_owned(),
        "lowercase" => ident.to_ascii_lowercase(),
        "UPPERCASE" => ident.to_ascii_uppercase(),
        "camelCase" => {
            let mut letters = ident.chars();
            match letters.next() {
                Some(first) => first.to_ascii_lowercase().to_string() + letters.as_str(),
                None => String::new(),
            }
        }
        "snake_case" => snake(),
        "SCREAMING_SNAKE_CASE" => snake().to_ascii_uppercase(),
        "kebab-case" => snake().replace('_', "-"),
        "SCREAMING-KEBAB-CASE" => snake().to_ascii_uppercase().replace('_', "-"),
        _ => bail!("{loc}: unknown serde rename_all rule `{rule}`"),
    })
}

/// serde's `rename_all` applied to a field name, which is snake_case.
fn rename_field(rule: &str, ident: &str, loc: &Loc) -> Result<String, Report> {
    let pascal = || {
        let mut pascal = String::new();
        let mut capitalize = true;
        for letter in ident.chars() {
            if letter == '_' {
                capitalize = true;
            } else if capitalize {
                pascal.push(letter.to_ascii_uppercase());
                capitalize = false;
            } else {
                pascal.push(letter);
            }
        }
        pascal
    };

    Ok(match rule {
        "lowercase" | "snake_case" => ident.to_owned(),
        "UPPERCASE" | "SCREAMING_SNAKE_CASE" => ident.to_ascii_uppercase(),
        "PascalCase" => pascal(),
        "camelCase" => {
            let pascal = pascal();
            let mut letters = pascal.chars();
            match letters.next() {
                Some(first) => first.to_ascii_lowercase().to_string() + letters.as_str(),
                None => String::new(),
            }
        }
        "kebab-case" => ident.replace('_', "-"),
        "SCREAMING-KEBAB-CASE" => ident.to_ascii_uppercase().replace('_', "-"),
        _ => bail!("{loc}: unknown serde rename_all rule `{rule}`"),
    })
}
