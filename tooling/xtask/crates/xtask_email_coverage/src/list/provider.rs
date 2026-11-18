//! `provider` rows: the provider API methods an emulator's route enum names,
//! by the name `strum::Display` prints for each.

use heck::{ToKebabCase, ToLowerCamelCase, ToShoutySnakeCase, ToSnakeCase, ToUpperCamelCase};
use rootcause::prelude::*;

use super::{Entry, wire};
use crate::attrs;
use crate::repo::{Loc, Repo};
use crate::sources::ProviderSource;

/// Lists the variants of the route enum as `<prefix>:<display name>`.
pub(crate) fn list(repo: &Repo, source: &ProviderSource) -> Result<Vec<Entry>, Report> {
    let file_name = &source.routes.file;
    let file = repo.parse(file_name)?;
    let Some(wire::TypeItem::Enum(routes)) = wire::find_type(&file, &source.routes.ident) else {
        bail!("{file_name}:1: no top-level enum `{}`", source.routes.ident);
    };
    let loc = Loc::new(file_name, routes.ident.span());
    let container = attrs::args(&routes.attrs, "strum", file_name)?;
    let serialize_all = attrs::value(&container, "serialize_all", &loc)?;

    let mut entries = Vec::new();
    for variant in &routes.variants {
        let loc = Loc::new(file_name, variant.ident.span());
        let own = attrs::args(&variant.attrs, "strum", file_name)?;
        if attrs::has(&own, "disabled") {
            continue;
        }

        // strum's Display prints `to_string` when given, else the longest
        // `serialize` (the last of equally long ones), else the variant name
        // in the enum's `serialize_all` case.
        let ident = variant.ident.to_string();
        let name = match attrs::value(&own, "to_string", &loc)? {
            Some(name) => name.to_owned(),
            None => match attrs::values(&own, "serialize")
                .into_iter()
                .max_by_key(|name| name.len())
            {
                Some(name) => name.to_owned(),
                None => match serialize_all {
                    None => ident,
                    Some("snake_case") => ident.to_snake_case(),
                    Some("kebab-case") => ident.to_kebab_case(),
                    Some("camelCase") => ident.to_lower_camel_case(),
                    Some("PascalCase") => ident.to_upper_camel_case(),
                    Some("SCREAMING_SNAKE_CASE") => ident.to_shouty_snake_case(),
                    Some("lowercase") => ident.to_lowercase(),
                    Some("UPPERCASE") => ident.to_uppercase(),
                    Some(rule) => bail!("{loc}: unknown strum serialize_all rule `{rule}`"),
                },
            },
        };

        entries.push(Entry {
            key: format!("{}:{name}", source.prefix),
            matcher: String::new(),
            loc,
        });
    }
    Ok(entries)
}
