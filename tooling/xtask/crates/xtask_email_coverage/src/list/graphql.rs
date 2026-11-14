//! `graphql` rows: resolvers that take a `Context` or await, keyed by the SDL type and
//! field they serve.
//!
//! The Rust type a resolver is implemented on is often not the SDL type that
//! carries its field: root types are merged from several Rust types with
//! `#[derive(MergedObject)]`, and `#[graphql(flatten)]` copies one type's
//! fields into another. The scan records both, and the exported SDL decides.

use std::collections::{BTreeMap, BTreeSet};

use async_graphql_parser::types::{TypeKind, TypeSystemDefinition};
use heck::ToLowerCamelCase;
use rootcause::prelude::*;
use syn::visit::Visit;
use syn::{FnArg, ImplItem, Item, ItemImpl, ItemStruct, ReturnType, Type};

use super::Entry;
use crate::attrs;
use crate::repo::{Loc, Repo, is_test_only};
use crate::sources::{GraphqlSource, GraphqlTypeMapping};

/// Attribute macros that turn an impl block into GraphQL resolvers.
const RESOLVER_IMPLS: [&str; 3] = ["Object", "ComplexObject", "Subscription"];

/// Derives that merge the fields of a tuple struct's members into one type.
const MERGING_DERIVES: [&str; 2] = ["MergedObject", "MergedSubscription"];

/// Object type name → its field names, from the SDL.
type Schema = BTreeMap<String, BTreeSet<String>>;

struct Resolver {
    /// Name of the Rust type the impl block is for.
    rust_type: String,
    /// `#[Object(name = "...")]` of the impl block.
    object_name: Option<String>,
    field: String,
    loc: Loc,
}

#[derive(Default)]
struct Scan {
    resolvers: Vec<Resolver>,
    /// Rust type name → GraphQL names of the types that merge or flatten its
    /// fields into their own.
    holders: BTreeMap<String, BTreeSet<String>>,
    /// Rust type name → its `#[graphql(name = "...")]`.
    renamed: BTreeMap<String, String>,
}

/// Lists the resolvers of the configured crates as `<SDL type>.<field>`.
pub(crate) fn list(
    repo: &Repo,
    source: &GraphqlSource,
    mappings: &[GraphqlTypeMapping],
) -> Result<Vec<Entry>, Report> {
    let schema = read_schema(repo, &source.schema)?;

    let mut scan = Scan::default();
    for graphql_crate in &source.crates {
        let only = graphql_crate.only.as_deref().map(str::to_lowercase);
        for file in repo.library_files(&graphql_crate.dir)? {
            let parsed = repo.parse(&file)?;
            scan_items(&parsed.items, &file, only.as_deref(), &mut scan)?;
        }
    }

    let mut used_mappings = BTreeSet::new();
    let mut entries = Vec::new();
    for resolver in &scan.resolvers {
        let graphql_type = graphql_type(resolver, &scan, &schema, mappings, &mut used_mappings)
            .map_err(|error| error.attach(format!("SDL: {}", source.schema)))?;
        entries.push(Entry {
            key: format!("{graphql_type}.{}", resolver.field),
            matcher: String::new(),
            loc: resolver.loc.clone(),
        });
    }

    for mapping in mappings {
        if !used_mappings.contains(mapping.rust.as_str()) {
            bail!(
                "[[graphql_type]] rust = \"{}\" matches no listed resolver",
                mapping.rust
            );
        }
    }
    Ok(entries)
}

fn read_schema(repo: &Repo, path: &str) -> Result<Schema, Report> {
    let document = async_graphql_parser::parse_schema(repo.read(path)?)
        .map_err(|error| report!("{path}: {error}"))?;

    let mut schema = Schema::new();
    for definition in document.definitions {
        let TypeSystemDefinition::Type(definition) = definition else {
            continue;
        };
        let TypeKind::Object(object) = definition.node.kind else {
            continue;
        };
        schema
            .entry(definition.node.name.node.to_string())
            .or_default()
            .extend(
                object
                    .fields
                    .iter()
                    .map(|field| field.node.name.node.to_string()),
            );
    }
    Ok(schema)
}

fn scan_items(
    items: &[Item],
    file: &str,
    only: Option<&str>,
    scan: &mut Scan,
) -> Result<(), Report> {
    for item in items {
        match item {
            Item::Mod(item) if !is_test_only(&item.attrs) => {
                if let Some((_, inline)) = &item.content {
                    scan_items(inline, file, only, scan)?;
                }
            }
            Item::Struct(item) => scan_struct(item, file, scan)?,
            Item::Enum(item) => {
                let loc = Loc::new(file, item.ident.span());
                let arguments = attrs::args(&item.attrs, "graphql", file)?;
                if let Some(name) = attrs::value(&arguments, "name", &loc)? {
                    scan.renamed.insert(item.ident.to_string(), name.to_owned());
                }
            }
            Item::Impl(item) => scan_impl(item, file, only, scan)?,
            _ => {}
        }
    }
    Ok(())
}

fn scan_struct(item: &ItemStruct, file: &str, scan: &mut Scan) -> Result<(), Report> {
    let loc = Loc::new(file, item.ident.span());
    let arguments = attrs::args(&item.attrs, "graphql", file)?;
    let name = attrs::value(&arguments, "name", &loc)?;
    if let Some(name) = name {
        scan.renamed.insert(item.ident.to_string(), name.to_owned());
    }

    let derives = attrs::args(&item.attrs, "derive", file)?;
    if !MERGING_DERIVES
        .iter()
        .any(|derive| attrs::has(&derives, derive))
    {
        return Ok(());
    }

    let holder = name.map_or_else(|| item.ident.to_string(), str::to_owned);
    for field in &item.fields {
        let Some(member) = type_name(&field.ty) else {
            bail!("{loc}: cannot name a member type of this merged object");
        };
        scan.holders
            .entry(member)
            .or_default()
            .insert(holder.clone());
    }
    Ok(())
}

fn scan_impl(
    item: &ItemImpl,
    file: &str,
    only: Option<&str>,
    scan: &mut Scan,
) -> Result<(), Report> {
    let Some(macro_name) = RESOLVER_IMPLS.iter().find(|name| {
        item.attrs.iter().any(|attr| {
            attr.path()
                .segments
                .last()
                .is_some_and(|segment| segment.ident == **name)
        })
    }) else {
        return Ok(());
    };
    let loc = Loc::new(file, item.impl_token.span);
    let Some(rust_type) = type_name(&item.self_ty) else {
        bail!("{loc}: cannot name the type of this #[{macro_name}] impl");
    };
    let object_name = attrs::value(&attrs::args(&item.attrs, macro_name, file)?, "name", &loc)?
        .map(str::to_owned);

    for member in &item.items {
        let ImplItem::Fn(method) = member else {
            continue;
        };
        let name = method.sig.ident.to_string();
        let loc = Loc::new(file, method.sig.ident.span());
        let arguments = attrs::args(&method.attrs, "graphql", file)?;
        if attrs::has(&arguments, "skip") {
            continue;
        }

        // A flattened method is not a field: the fields of the type it
        // returns appear on this type instead.
        if attrs::has(&arguments, "flatten") {
            let holder = object_name.clone().unwrap_or_else(|| rust_type.clone());
            let mut returned = PathNames::default();
            if let ReturnType::Type(_, ty) = &method.sig.output {
                returned.visit_type(ty);
            }
            for flattened in returned.names {
                scan.holders
                    .entry(flattened)
                    .or_default()
                    .insert(holder.clone());
            }
            continue;
        }

        let takes_context = method.sig.inputs.iter().any(|input| {
            let FnArg::Typed(input) = input else {
                return false;
            };
            let mut names = PathNames::default();
            names.visit_type(&input.ty);
            names.names.contains("Context")
        });
        // A resolver does work when it reads the request context or awaits
        // something; the rest are getters over data already loaded.
        let mut awaits = Awaits::default();
        awaits.visit_block(&method.block);
        if !takes_context && !awaits.found {
            continue;
        }
        if let Some(only) = only
            && !name.to_lowercase().contains(only)
            && !rust_type.to_lowercase().contains(only)
        {
            continue;
        }

        let field = match attrs::value(&arguments, "name", &loc)? {
            Some(renamed) => renamed.to_owned(),
            None => name.trim_start_matches("r#").to_lower_camel_case(),
        };
        scan.resolvers.push(Resolver {
            rust_type: rust_type.clone(),
            object_name: object_name.clone(),
            field,
            loc,
        });
    }
    Ok(())
}

/// The SDL object type that carries the resolver's field.
fn graphql_type<'a>(
    resolver: &'a Resolver,
    scan: &'a Scan,
    schema: &'a Schema,
    mappings: &'a [GraphqlTypeMapping],
    used_mappings: &mut BTreeSet<&'a str>,
) -> Result<&'a str, Report> {
    let Resolver {
        rust_type,
        field,
        loc,
        ..
    } = resolver;
    let has_field = |name: &str| {
        schema
            .get(name)
            .is_some_and(|fields| fields.contains(field))
    };

    if let Some(mapping) = mappings.iter().find(|mapping| mapping.rust == *rust_type) {
        used_mappings.insert(&mapping.rust);
        if !has_field(&mapping.graphql) {
            bail!(
                "{loc}: [[graphql_type]] maps `{rust_type}` to `{}`, which has no field \
                 `{field}` in the SDL",
                mapping.graphql
            );
        }
        return Ok(&mapping.graphql);
    }

    // The type's own name: the impl's, the struct's, or the Rust name.
    let own = resolver
        .object_name
        .as_ref()
        .or_else(|| scan.renamed.get(rust_type))
        .unwrap_or(rust_type);
    if has_field(own) {
        return Ok(own);
    }

    // The types the code merges or flattens it into.
    let holders: Vec<&String> = scan
        .holders
        .get(rust_type)
        .into_iter()
        .flatten()
        .filter(|holder| has_field(holder))
        .collect();
    match holders.as_slice() {
        [holder] => return Ok(holder),
        [] => {}
        several => bail!(
            "{loc}: `{rust_type}.{field}` is merged into several SDL types ({}); add a \
             [[graphql_type]] rust = \"{rust_type}\" mapping to sources.toml",
            join(several)
        ),
    }

    // Last, the only SDL type with a field of that name.
    let anywhere: Vec<&String> = schema.keys().filter(|name| has_field(name)).collect();
    match anywhere.as_slice() {
        [only] => Ok(only),
        [] => bail!(
            "{loc}: no SDL object type has a field `{field}` for the resolver on \
             `{rust_type}`: the SDL is stale (export it again) or this is not a resolver"
        ),
        several => bail!(
            "{loc}: several SDL types have a field `{field}` ({}) and none is tied to \
             `{rust_type}` in code; add a [[graphql_type]] rust = \"{rust_type}\" mapping to \
             sources.toml",
            join(several)
        ),
    }
}

fn join(names: &[&String]) -> String {
    names
        .iter()
        .map(|name| name.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

/// The name of a path type, without its module path or generics.
fn type_name(ty: &Type) -> Option<String> {
    match ty {
        Type::Path(ty) => ty
            .path
            .segments
            .last()
            .map(|segment| segment.ident.to_string()),
        _ => None,
    }
}

/// Every name that appears as a path segment.
#[derive(Default)]
struct PathNames {
    names: BTreeSet<String>,
}

impl<'ast> Visit<'ast> for PathNames {
    fn visit_path_segment(&mut self, segment: &'ast syn::PathSegment) {
        self.names.insert(segment.ident.to_string());
        syn::visit::visit_path_segment(self, segment);
    }
}

/// Whether an `.await` appears.
#[derive(Default)]
struct Awaits {
    found: bool,
}

impl<'ast> Visit<'ast> for Awaits {
    fn visit_expr_await(&mut self, _: &'ast syn::ExprAwait) {
        self.found = true;
    }
}
