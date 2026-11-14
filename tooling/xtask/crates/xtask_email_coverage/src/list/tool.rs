//! `tool` rows: the agent tools a toolset file registers, by the name a model
//! calls them.

use std::collections::BTreeMap;

use rootcause::prelude::*;
use syn::visit::Visit;
use syn::{ExprMethodCall, GenericArgument, Type};

use super::{Entry, wire};
use crate::attrs;
use crate::repo::{Loc, Repo};
use crate::sources::ToolSource;

/// The toolset methods that register a tool type as their first type argument.
const REGISTRATIONS: [&str; 2] = ["add_tool", "add_user_tool"];

/// Lists the tools registered in `source.file`.
///
/// A tool's name is its `schemars::JsonSchema::schema_name()`: the type's
/// name unless `#[schemars(rename = "...")]` or `#[serde(rename = "...")]`
/// changes it.
pub(crate) fn list(repo: &Repo, source: &ToolSource) -> Result<Vec<Entry>, Report> {
    let module = repo.module_of(&source.file)?;
    let file = repo.parse(&source.file)?;
    let mut registrations = Registrations::default();
    registrations.visit_file(&file);

    let mut entries = BTreeMap::new();
    for registration in registrations.calls {
        let loc = Loc::new(&source.file, registration.method.span());
        let tool_type = registration
            .turbofish
            .as_ref()
            .and_then(|turbofish| turbofish.args.first())
            .and_then(|argument| match argument {
                GenericArgument::Type(Type::Path(ty)) => Some(&ty.path),
                _ => None,
            })
            .ok_or_else(|| report!("{loc}: this registration does not name its tool type"))?;
        let segments: Vec<String> = tool_type
            .segments
            .iter()
            .map(|segment| segment.ident.to_string())
            .collect();

        let (declaring, ident) = repo.resolve(&module, &segments, &loc)?;
        let declaring_file = repo.parse(&declaring.file)?;
        let (attributes, span) = match wire::find_type(&declaring_file, &ident) {
            Some(wire::TypeItem::Struct(item)) => (&item.attrs, item.ident.span()),
            Some(wire::TypeItem::Enum(item)) => (&item.attrs, item.ident.span()),
            None => bail!(
                "{loc}: `{ident}` is not a struct or enum in {}",
                declaring.file
            ),
        };

        let type_loc = Loc::new(&declaring.file, span);
        let schemars = attrs::args(attributes, "schemars", &declaring.file)?;
        let serde = attrs::args(attributes, "serde", &declaring.file)?;
        let name = match attrs::value(&schemars, "rename", &type_loc)? {
            Some(renamed) => Some(renamed),
            None => attrs::value(&serde, "rename", &type_loc)?,
        };
        let key = name.map_or(ident, str::to_owned);
        entries.insert(
            key.clone(),
            Entry {
                key,
                matcher: String::new(),
                loc: type_loc,
            },
        );
    }

    if entries.is_empty() {
        bail!("{}:1: registers no tools", source.file);
    }
    Ok(entries.into_values().collect())
}

#[derive(Default)]
struct Registrations<'ast> {
    calls: Vec<&'ast ExprMethodCall>,
}

impl<'ast> Visit<'ast> for Registrations<'ast> {
    fn visit_expr_method_call(&mut self, call: &'ast ExprMethodCall) {
        if REGISTRATIONS.contains(&call.method.to_string().as_str()) {
            self.calls.push(call);
        }
        syn::visit::visit_expr_method_call(self, call);
    }
}
