//! Build-time schema metadata codegen.
//!
//! Parses the in-repo SDL schema plus `key_config.toml` and emits
//! `$OUT_DIR/schema_meta.rs`: static lookup tables consumed by `src/meta.rs`.
//! See the design doc (`js/app/docs/graphql-normalized-cache-plan.md`) §4 and
//! the "cache-schema-codegen" discussion — this deliberately fails the build
//! on schema/key-config drift.

use apollo_compiler::schema::ExtendedType;
use apollo_compiler::Schema;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;
use std::path::Path;

const SCHEMA_PATH: &str = "../../cloud-storage/schema.graphql";
const KEY_CONFIG_PATH: &str = "key_config.toml";

#[derive(serde::Deserialize)]
struct KeyConfig {
    keys: BTreeMap<String, Vec<String>>,
    embedded: BTreeSet<String>,
}

fn main() {
    println!("cargo:rerun-if-changed={SCHEMA_PATH}");
    println!("cargo:rerun-if-changed={KEY_CONFIG_PATH}");

    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let schema_path = Path::new(&manifest_dir).join(SCHEMA_PATH);
    let schema_text = std::fs::read_to_string(&schema_path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", schema_path.display()));
    let config_text = std::fs::read_to_string(Path::new(&manifest_dir).join(KEY_CONFIG_PATH))
        .expect("cannot read key_config.toml");

    let config: KeyConfig = toml::from_str(&config_text).expect("invalid key_config.toml");
    let schema = Schema::parse_and_validate(&schema_text, "schema.graphql")
        .unwrap_or_else(|e| panic!("schema does not validate: {e:?}"));

    let query_root = schema
        .schema_definition
        .query
        .as_ref()
        .expect("schema has no query root")
        .name
        .to_string();

    // Hash covers schema + key policy: either changing invalidates persisted
    // caches via the namespace.
    let mut hasher = Sha256::new();
    hasher.update(schema_text.as_bytes());
    hasher.update(config_text.as_bytes());
    let schema_hash = hex_string(&hasher.finalize());

    let mut errors: Vec<String> = Vec::new();
    let mut entries: Vec<(String, String)> = Vec::new(); // (type name, TypeMeta literal)

    // Interface implementors (reverse map).
    let mut implementors: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for (name, ty) in schema.types.iter() {
        if let ExtendedType::Object(obj) = ty {
            for iface in &obj.implements_interfaces {
                implementors
                    .entry(iface.name.to_string())
                    .or_default()
                    .insert(name.to_string());
            }
        }
    }

    for (name, ty) in schema.types.iter() {
        let name = name.to_string();
        if name.starts_with("__") {
            continue; // introspection machinery
        }
        match ty {
            ExtendedType::Object(obj) => {
                let key_literal = key_literal(&name, name == query_root, &config, &mut errors);
                let fields = fields_literal(&schema, obj.fields.iter(), &mut errors);
                entries.push((
                    name.clone(),
                    type_meta_literal(&name, "Object", &key_literal, &fields, &[]),
                ));
            }
            ExtendedType::Interface(iface) => {
                let key_literal = key_literal(&name, false, &config, &mut errors);
                let fields = fields_literal(&schema, iface.fields.iter(), &mut errors);
                let possible: Vec<String> = implementors
                    .get(&name)
                    .map(|s| s.iter().cloned().collect())
                    .unwrap_or_default();
                entries.push((
                    name.clone(),
                    type_meta_literal(&name, "Interface", &key_literal, &fields, &possible),
                ));
            }
            ExtendedType::Union(u) => {
                let possible: Vec<String> = u.members.iter().map(|m| m.name.to_string()).collect();
                entries.push((
                    name.clone(),
                    type_meta_literal(&name, "Union", "None", "&[]", &possible),
                ));
            }
            // Scalars, enums and input objects need no TypeMeta: field kinds
            // are resolved at codegen and inputs never appear in responses.
            _ => {}
        }
    }

    // Unused config entries are drift too.
    for configured in config.keys.keys().chain(config.embedded.iter()) {
        if !schema.types.contains_key(configured.as_str()) {
            errors.push(format!(
                "key_config.toml mentions `{configured}` which is not in the schema"
            ));
        }
    }

    if !errors.is_empty() {
        panic!(
            "schema/key-config drift:\n  - {}\n(fix key_config.toml or the schema)",
            errors.join("\n  - ")
        );
    }

    entries.sort_by(|a, b| a.0.cmp(&b.0)); // binary-searchable

    let mut out = String::new();
    writeln!(out, "// @generated by cache-core/build.rs — do not edit.").unwrap();
    writeln!(out, "pub static QUERY_ROOT_TYPE: &str = {query_root:?};").unwrap();
    writeln!(out, "pub static SCHEMA_HASH: &str = {schema_hash:?};").unwrap();
    writeln!(out, "pub static TYPES: &[TypeMeta] = &[").unwrap();
    for (_, literal) in &entries {
        writeln!(out, "    {literal},").unwrap();
    }
    writeln!(out, "];").unwrap();

    let out_path = Path::new(&std::env::var("OUT_DIR").unwrap()).join("schema_meta.rs");
    std::fs::write(out_path, out).unwrap();
}

/// Resolves key policy for an object/interface type into a `key_fields`
/// literal, recording drift errors.
fn key_literal(
    name: &str,
    is_query_root: bool,
    config: &KeyConfig,
    errors: &mut Vec<String>,
) -> String {
    if is_query_root {
        return "None".into();
    }
    match (config.keys.get(name), config.embedded.contains(name)) {
        (Some(_), true) => {
            errors.push(format!("`{name}` is in both [keys] and embedded"));
            "None".into()
        }
        (Some(fields), false) => {
            let list = fields
                .iter()
                .map(|f| format!("{f:?}"))
                .collect::<Vec<_>>()
                .join(", ");
            format!("Some(&[{list}])")
        }
        (None, true) => "None".into(),
        (None, false) => {
            errors.push(format!(
                "`{name}` is not configured: add it to [keys] or embedded in key_config.toml"
            ));
            "None".into()
        }
    }
}

fn type_meta_literal(
    name: &str,
    kind: &str,
    key_literal: &str,
    fields_literal: &str,
    possible: &[String],
) -> String {
    let possible_list = possible
        .iter()
        .map(|p| format!("{p:?}"))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "TypeMeta {{ name: {name:?}, kind: TypeKind::{kind}, key_fields: {key_literal}, fields: {fields_literal}, possible_types: &[{possible_list}] }}"
    )
}

fn fields_literal<'a>(
    schema: &Schema,
    fields: impl Iterator<
        Item = (
            &'a apollo_compiler::Name,
            &'a apollo_compiler::schema::Component<apollo_compiler::ast::FieldDefinition>,
        ),
    >,
    errors: &mut Vec<String>,
) -> String {
    let mut parts = Vec::new();
    for (fname, fdef) in fields {
        let (named, nullable, list, item_nullable) = match flatten_type(&fdef.ty) {
            Ok(t) => t,
            Err(e) => {
                errors.push(format!("field `{fname}`: {e}"));
                continue;
            }
        };
        let kind = match schema.types.get(named.as_str()) {
            Some(ExtendedType::Object(_))
            | Some(ExtendedType::Interface(_))
            | Some(ExtendedType::Union(_)) => "Composite",
            Some(ExtendedType::Enum(_)) => "Leaf",
            Some(ExtendedType::Scalar(_)) => {
                if matches!(
                    named.as_str(),
                    "Int" | "Float" | "String" | "Boolean" | "ID"
                ) {
                    "Leaf"
                } else {
                    "OpaqueScalar" // e.g. JSON
                }
            }
            Some(ExtendedType::InputObject(_)) | None => {
                errors.push(format!("field `{fname}` has non-output type `{named}`"));
                continue;
            }
        };
        parts.push(format!(
            "FieldMeta {{ name: {:?}, ty: FieldType {{ name: {:?}, kind: FieldKind::{kind}, nullable: {nullable}, list: {list}, item_nullable: {item_nullable} }} }}",
            fname.to_string(),
            named,
        ));
    }
    format!("&[{}]", parts.join(", "))
}

/// Flattens GraphQL type wrapping to (named, nullable, list, item_nullable).
/// Nested lists are rejected — extend `FieldType` if the schema ever needs
/// them.
fn flatten_type(ty: &apollo_compiler::ast::Type) -> Result<(String, bool, bool, bool), String> {
    use apollo_compiler::ast::Type;
    let (inner, nullable, list) = match ty {
        Type::Named(n) => return Ok((n.to_string(), true, false, false)),
        Type::NonNullNamed(n) => return Ok((n.to_string(), false, false, false)),
        Type::List(inner) => (inner, true, true),
        Type::NonNullList(inner) => (inner, false, true),
    };
    match inner.as_ref() {
        Type::Named(n) => Ok((n.to_string(), nullable, list, true)),
        Type::NonNullNamed(n) => Ok((n.to_string(), nullable, list, false)),
        Type::List(_) | Type::NonNullList(_) => Err("nested lists are not supported".into()),
    }
}

fn hex_string(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
