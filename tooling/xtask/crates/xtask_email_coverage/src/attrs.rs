//! Reads the arguments of helper attributes such as `#[serde(tag = "t")]`,
//! `#[graphql(name = "x", flatten)]` and `#[strum(serialize = "a.b")]`.

use rootcause::prelude::*;
use syn::{Attribute, Expr, ExprLit, Lit, Meta};

use crate::repo::Loc;

/// One `key`, `key = "value"` or `key(...)` argument of an attribute.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Arg {
    pub(crate) key: String,
    /// The value when it is a string literal; `None` for a bare flag, a
    /// nested list, or a value of another type.
    pub(crate) value: Option<String>,
}

/// The arguments of every `#[<name>(...)]` in `attrs`, in source order. The
/// attribute is matched on its last path segment, so `#[async_graphql::Object]`
/// and `#[Object]` are the same.
pub(crate) fn args(attrs: &[Attribute], name: &str, file: &str) -> Result<Vec<Arg>, Report> {
    let mut found = Vec::new();

    for attr in attrs {
        let is_named = attr
            .path()
            .segments
            .last()
            .is_some_and(|segment| segment.ident == name);
        if !is_named || !matches!(attr.meta, Meta::List(_)) {
            continue;
        }

        attr.parse_nested_meta(|meta| {
            let key = meta
                .path
                .segments
                .last()
                .map(|segment| segment.ident.to_string())
                .unwrap_or_default();

            let value = if meta.input.peek(syn::Token![=]) {
                match meta.value()?.parse::<Expr>()? {
                    Expr::Lit(ExprLit {
                        lit: Lit::Str(text),
                        ..
                    }) => Some(text.value()),
                    _ => None,
                }
            } else {
                if meta.input.peek(syn::token::Paren) {
                    let nested;
                    syn::parenthesized!(nested in meta.input);
                    nested.parse::<proc_macro2::TokenStream>()?;
                }
                None
            };

            found.push(Arg { key, value });
            Ok(())
        })
        .map_err(|error| {
            report!(
                "{}: cannot read #[{name}(...)]: {error}",
                Loc::new(file, error.span())
            )
        })?;
    }

    Ok(found)
}

/// Whether `key` appears among the arguments, with or without a value.
pub(crate) fn has(args: &[Arg], key: &str) -> bool {
    args.iter().any(|arg| arg.key == key)
}

/// The string values given for `key`, in source order.
pub(crate) fn values<'a>(args: &'a [Arg], key: &str) -> Vec<&'a str> {
    args.iter()
        .filter(|arg| arg.key == key)
        .filter_map(|arg| arg.value.as_deref())
        .collect()
}

/// The string value of `key`: `None` when absent, an error naming `loc` when
/// it is present in a form that has no single string value.
pub(crate) fn value<'a>(args: &'a [Arg], key: &str, loc: &Loc) -> Result<Option<&'a str>, Report> {
    let mut given = args.iter().filter(|arg| arg.key == key);
    let Some(first) = given.next() else {
        return Ok(None);
    };
    if given.next().is_some() {
        bail!("{loc}: `{key}` is given more than once");
    }

    match first.value.as_deref() {
        Some(value) => Ok(Some(value)),
        None => bail!("{loc}: `{key}` is not a plain `{key} = \"...\"`"),
    }
}
