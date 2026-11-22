#!/usr/bin/env bash
set -euo pipefail

crate_dir="$(\cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(\cd "$crate_dir/../.." && pwd)"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/imap-client-regen.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT

mkdir -p "$crate_dir/spec" "$work_dir/generator/src"
(\cd "$repo_dir" && cargo run -j 2 --quiet -p imap_service --bin imap_service_openapi) > "$work_dir/openapi-3.1.json"
python3 "$crate_dir/normalize_openapi.py" "$work_dir/openapi-3.1.json" "$work_dir/openapi.json"
cat > "$work_dir/generator/Cargo.toml" <<'EOF'
[package]
name = "imap_client_generator"
version = "0.0.0"
edition = "2024"
publish = false
[workspace]
[dependencies]
openapiv3 = "=2.2.0"
prettyplease = "0.2"
progenitor = "=0.15.1"
serde_json = "1"
syn = { version = "2", features = ["full", "visit-mut"] }
EOF
cat > "$work_dir/generator/src/main.rs" <<'EOF'
use std::{error::Error, fs::File};
use syn::visit_mut::VisitMut;

struct Documentation;
impl VisitMut for Documentation {
    fn visit_item_impl_mut(&mut self, item: &mut syn::ItemImpl) {
        if let syn::Type::Path(path) = &*item.self_ty
            && path.path.is_ident("Client")
        {
            // Callers must supply the authenticated, bounded HTTP client.
            item.items.retain(|item| !matches!(item, syn::ImplItem::Fn(function) if function.sig.ident == "new"));
        }
        syn::visit_mut::visit_item_impl_mut(self, item);
    }

    fn visit_item_struct_mut(&mut self, item: &mut syn::ItemStruct) {
        if item.ident == "ConversionError" {
            item.attrs.push(syn::parse_quote!(#[expect(dead_code, reason = "generated helper has no string-conversion parameters")]));
        }
        syn::visit_mut::visit_item_struct_mut(self, item);
    }

    fn visit_attributes_mut(&mut self, attributes: &mut Vec<syn::Attribute>) {
        let mut normalized = Vec::new();
        for attribute in attributes.drain(..) {
            if let syn::Meta::NameValue(meta) = &attribute.meta
                && meta.path.is_ident("doc")
                && let syn::Expr::Lit(expression) = &meta.value
                && let syn::Lit::Str(documentation) = &expression.lit
            {
                for line in documentation.value().lines() {
                    normalized.push(syn::parse_quote!(#[doc = #line]));
                }
            } else {
                normalized.push(attribute);
            }
        }
        *attributes = normalized;
    }
}

// Explicit public re-exports are source DTOs too. Reuse them instead of
// generating unused parallel definitions for their OpenAPI components.
fn exported_names(tree: &syn::UseTree, names: &mut Vec<String>) {
    match tree {
        syn::UseTree::Path(path) => exported_names(&path.tree, names),
        syn::UseTree::Name(name) => names.push(name.ident.to_string()),
        syn::UseTree::Rename(rename) => names.push(rename.rename.to_string()),
        syn::UseTree::Group(group) => {
            for item in &group.items {
                exported_names(item, names);
            }
        }
        syn::UseTree::Glob(_) => {}
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    let arguments: Vec<_> = std::env::args().collect();
    let spec: openapiv3::OpenAPI = serde_json::from_reader(File::open(&arguments[1])?)?;
    let mut settings = progenitor::GenerationSettings::default();
    settings.with_interface(progenitor::InterfaceStyle::Positional)
        .with_map_type("::std::collections::BTreeMap")
        .with_pre_hook(syn::parse_quote!(crate::trace_request));
    // Keep source domain types, including the password's redacting Debug impl.
    let model_path = std::path::Path::new(&arguments[3]);
    for (module, path) in [("models", model_path.to_path_buf()), ("bounce", model_path.with_file_name("bounce.rs")), ("account_settings", model_path.with_file_name("account_settings.rs")), ("server_features", model_path.with_file_name("server_features.rs"))] {
        let source = syn::parse_file(&std::fs::read_to_string(path)?)?;
        for item in source.items {
            let names = match item {
                syn::Item::Struct(item) if matches!(item.vis, syn::Visibility::Public(_)) => vec![item.ident.to_string()],
                syn::Item::Enum(item) if matches!(item.vis, syn::Visibility::Public(_)) => vec![item.ident.to_string()],
                syn::Item::Use(item) if matches!(item.vis, syn::Visibility::Public(_)) => {
                    let mut names = Vec::new();
                    exported_names(&item.tree, &mut names);
                    names
                }
                _ => continue,
            };
            for name in names {
                if spec.components.as_ref().is_some_and(|components| components.schemas.contains_key(&name)) {
                    settings.with_replacement(&name, &format!("::imap_engine::domain::{module}::{name}"), std::iter::empty());
                }
            }
        }
    }
    let mut generator = progenitor::Generator::new(&settings);
    let mut file: syn::File = syn::parse2(generator.generate_tokens(&spec)?)?;
    Documentation.visit_file_mut(&mut file);
    std::fs::write(&arguments[2], format!("// @generated by crates/imap_service_client/regen.sh; do not edit.\n{}", prettyplease::unparse(&file)))?;
    Ok(())
}
EOF
CARGO_TARGET_DIR="$repo_dir/target/imap_client_regen" cargo run -j 2 --quiet \
    --manifest-path "$work_dir/generator/Cargo.toml" -- \
    "$work_dir/openapi.json" "$work_dir/generated.rs" "$repo_dir/crates/imap_engine/src/domain/models.rs"
rustfmt --edition 2024 "$work_dir/generated.rs"
if [[ "${1:-}" == --check ]]; then
    cmp "$work_dir/openapi-3.1.json" "$crate_dir/spec/openapi-3.1.json"
    cmp "$work_dir/openapi.json" "$crate_dir/spec/openapi.json"
    cmp "$work_dir/generated.rs" "$crate_dir/src/generated.rs"
else
    cp "$work_dir/openapi-3.1.json" "$crate_dir/spec/openapi-3.1.json"
    cp "$work_dir/openapi.json" "$crate_dir/spec/openapi.json"
    cp "$work_dir/generated.rs" "$crate_dir/src/generated.rs"
fi
