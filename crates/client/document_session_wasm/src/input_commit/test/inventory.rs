//! Check every cfg-selected ordinary export against the reviewed entry policy.
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
};
use syn::{punctuated::Punctuated, Token};

#[derive(Clone, Copy)]
enum Profile {
    OrdinaryDefault,
    OrdinaryPreview,
    CompatWeb,
}
fn meta_enabled(meta: &syn::Meta, profile: Profile) -> bool {
    match meta {
        syn::Meta::Path(path) if path.is_ident("test") => false,
        syn::Meta::NameValue(pair) => {
            let syn::Expr::Lit(value) = &pair.value else {
                panic!("literal cfg");
            };
            let syn::Lit::Str(value) = &value.lit else {
                panic!("string cfg");
            };
            if pair.path.is_ident("feature") {
                match value.value().as_str() {
                    "compatibility" | "compat-web" => matches!(profile, Profile::CompatWeb),
                    "bebop-owned-all" => true,
                    "dev-probes" => matches!(profile, Profile::OrdinaryPreview),
                    other => panic!("classify new native feature {other}"),
                }
            } else if pair.path.is_ident("target_arch") {
                value.value() == "wasm32"
            } else {
                panic!("classify new native cfg");
            }
        }
        syn::Meta::List(list) => {
            let items = list
                .parse_args_with(Punctuated::<syn::Meta, Token![,]>::parse_terminated)
                .expect("cfg args");
            if list.path.is_ident("not") {
                assert_eq!(items.len(), 1);
                !meta_enabled(items.first().expect("not arg"), profile)
            } else if list.path.is_ident("all") {
                items.iter().all(|item| meta_enabled(item, profile))
            } else if list.path.is_ident("any") {
                items.iter().any(|item| meta_enabled(item, profile))
            } else {
                panic!("classify cfg predicate");
            }
        }
        _ => panic!("classify native cfg"),
    }
}
fn enabled(attrs: &[syn::Attribute], profile: Profile) -> bool {
    for attr in attrs.iter().filter(|attr| attr.path().is_ident("cfg_attr")) {
        let args = attr
            .parse_args_with(Punctuated::<syn::Meta, Token![,]>::parse_terminated)
            .expect("conditional attributes");
        assert!(
            !meta_enabled(args.first().expect("cfg_attr condition"), profile),
            "classify active conditional export attributes before inventorying them"
        );
    }
    attrs
        .iter()
        .filter(|attr| attr.path().is_ident("cfg"))
        .all(|attr| meta_enabled(&attr.parse_args::<syn::Meta>().expect("cfg"), profile))
}
fn wasm_attribute(attr: &syn::Attribute) -> bool {
    attr.path()
        .segments
        .last()
        .is_some_and(|segment| segment.ident == "wasm_bindgen")
}
fn wasm(attrs: &[syn::Attribute]) -> bool {
    attrs.iter().any(wasm_attribute)
}
fn exported_name(ident: &syn::Ident, attrs: &[syn::Attribute]) -> String {
    let mut name = ident.to_string();
    for attr in attrs.iter().filter(|attr| wasm_attribute(attr)) {
        if !matches!(attr.meta, syn::Meta::List(_)) {
            continue;
        }
        attr.parse_nested_meta(|meta| {
            if meta.path.is_ident("js_name") {
                let value = meta.value()?;
                name = if value.peek(syn::LitStr) {
                    value.parse::<syn::LitStr>()?.value()
                } else {
                    value.parse::<syn::Ident>()?.to_string()
                };
            }
            Ok(())
        })
        .expect("review generated export attributes");
    }
    name
}
fn invalidates_first(method: &syn::ImplItemFn) -> bool {
    let Some(syn::Stmt::Expr(syn::Expr::MethodCall(call), _)) = method.block.stmts.first() else {
        return false;
    };
    if call.method != "invalidate_input_commit" {
        return false;
    }
    let syn::Expr::Field(field) = &*call.receiver else {
        return false;
    };
    let syn::Member::Named(member) = &field.member else {
        return false;
    };
    let syn::Expr::Path(base) = &*field.base else {
        return false;
    };
    member == "machine" && base.path.is_ident("self")
}
#[derive(Default)]
struct Exports {
    methods: BTreeMap<String, (bool, String)>,
    classes: BTreeSet<String>,
    functions: BTreeMap<String, String>,
    development_only: BTreeSet<String>,
}
fn collect_file(
    path: &Path,
    module_dir: &Path,
    profile: Profile,
    development_only: bool,
    exports: &mut Exports,
) {
    let text = std::fs::read_to_string(path).expect("source");
    let file = syn::parse_file(&text).expect("parse actual source");
    if enabled(&file.attrs, profile) {
        collect_items(
            &file.items,
            path,
            module_dir,
            profile,
            development_only || !enabled(&file.attrs, Profile::OrdinaryDefault),
            exports,
        );
    }
}
fn collect_items(
    items: &[syn::Item],
    path: &Path,
    module_dir: &Path,
    profile: Profile,
    development_only: bool,
    exports: &mut Exports,
) {
    for item in items {
        match item {
            syn::Item::Impl(block) if enabled(&block.attrs, profile) && wasm(&block.attrs) => {
                let syn::Type::Path(target) = &*block.self_ty else {
                    continue;
                };
                let editor_session = target
                    .path
                    .segments
                    .last()
                    .is_some_and(|segment| segment.ident == "EditorSession");
                for item in &block.items {
                    let syn::ImplItem::Fn(method) = item else {
                        continue;
                    };
                    if !matches!(method.vis, syn::Visibility::Public(_))
                        || !enabled(&method.attrs, profile)
                    {
                        continue;
                    }
                    if development_only
                        || !enabled(&block.attrs, Profile::OrdinaryDefault)
                        || !enabled(&method.attrs, Profile::OrdinaryDefault)
                    {
                        exports
                            .development_only
                            .insert(exported_name(&method.sig.ident, &method.attrs));
                    }
                    if !editor_session {
                        continue;
                    }
                    assert!(
                        exports
                            .methods
                            .insert(
                                method.sig.ident.to_string(),
                                (
                                    invalidates_first(method),
                                    exported_name(&method.sig.ident, &method.attrs)
                                )
                            )
                            .is_none(),
                        "duplicate export"
                    );
                }
            }
            syn::Item::Fn(function)
                if enabled(&function.attrs, profile)
                    && wasm(&function.attrs)
                    && matches!(function.vis, syn::Visibility::Public(_)) =>
            {
                let name = exported_name(&function.sig.ident, &function.attrs);
                if development_only || !enabled(&function.attrs, Profile::OrdinaryDefault) {
                    exports.development_only.insert(name.clone());
                }
                assert!(
                    exports
                        .functions
                        .insert(name, function.sig.ident.to_string())
                        .is_none(),
                    "duplicate free export"
                );
            }
            syn::Item::Struct(value) if enabled(&value.attrs, profile) && wasm(&value.attrs) => {
                exports.classes.insert(value.ident.to_string());
                if development_only || !enabled(&value.attrs, Profile::OrdinaryDefault) {
                    exports
                        .development_only
                        .insert(exported_name(&value.ident, &value.attrs));
                }
                for field in &value.fields {
                    if matches!(field.vis, syn::Visibility::Public(_))
                        && enabled(&field.attrs, profile)
                        && (development_only
                            || !enabled(&value.attrs, Profile::OrdinaryDefault)
                            || !enabled(&field.attrs, Profile::OrdinaryDefault))
                    {
                        let ident = field.ident.as_ref().expect("named wasm field");
                        exports
                            .development_only
                            .insert(exported_name(ident, &field.attrs));
                    }
                }
            }
            syn::Item::Enum(value) if enabled(&value.attrs, profile) && wasm(&value.attrs) => {
                exports.classes.insert(value.ident.to_string());
                if development_only || !enabled(&value.attrs, Profile::OrdinaryDefault) {
                    exports
                        .development_only
                        .insert(exported_name(&value.ident, &value.attrs));
                }
                for variant in &value.variants {
                    if enabled(&variant.attrs, profile)
                        && (development_only
                            || !enabled(&value.attrs, Profile::OrdinaryDefault)
                            || !enabled(&variant.attrs, Profile::OrdinaryDefault))
                    {
                        exports
                            .development_only
                            .insert(exported_name(&variant.ident, &variant.attrs));
                    }
                }
            }
            syn::Item::Mod(module) if enabled(&module.attrs, profile) => {
                if let Some((_, items)) = &module.content {
                    collect_items(
                        items,
                        path,
                        &module_dir.join(module.ident.to_string()),
                        profile,
                        development_only || !enabled(&module.attrs, Profile::OrdinaryDefault),
                        exports,
                    );
                } else {
                    let explicit = module
                        .attrs
                        .iter()
                        .find(|attr| attr.path().is_ident("path"))
                        .map(|attr| {
                            let syn::Meta::NameValue(pair) = &attr.meta else {
                                panic!("path value");
                            };
                            let syn::Expr::Lit(value) = &pair.value else {
                                panic!("path literal");
                            };
                            let syn::Lit::Str(value) = &value.lit else {
                                panic!("path string");
                            };
                            path.parent().expect("parent").join(value.value())
                        });
                    let name = module.ident.to_string();
                    let source = explicit.unwrap_or_else(|| {
                        let source = module_dir.join(format!("{name}.rs"));
                        if source.exists() {
                            source
                        } else {
                            module_dir.join(&name).join("mod.rs")
                        }
                    });
                    let next_dir = if source.file_name().is_some_and(|name| name == "mod.rs") {
                        source.parent().expect("parent").to_owned()
                    } else {
                        source.with_extension("")
                    };
                    collect_file(
                        &source,
                        &next_dir,
                        profile,
                        development_only || !enabled(&module.attrs, Profile::OrdinaryDefault),
                        exports,
                    );
                }
            }
            _ => {}
        }
    }
}
fn exports(profile: Profile) -> Exports {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut exports = Exports::default();
    collect_file(&root.join("lib.rs"), &root, profile, false, &mut exports);
    exports
}
#[test]
fn declared_ordinary_preview_profile_has_complete_export_policy_and_predecode_invalidation() {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct EntryPolicy {
        policy: String,
        js_name: String,
    }
    let expected: BTreeMap<String, EntryPolicy> =
        serde_json::from_str(include_str!("entry-policy.json")).expect("reviewed policy");
    for actual in [
        exports(Profile::OrdinaryDefault),
        exports(Profile::OrdinaryPreview),
    ] {
        assert_eq!(
            actual.methods.keys().collect::<Vec<_>>(),
            expected.keys().collect::<Vec<_>>(),
            "classify new/removed cfg-selected exports"
        );
        for (name, policy) in &expected {
            assert_eq!(
                actual.methods[name].1, policy.js_name,
                "{name} generated name"
            );
            if matches!(
                name.as_str(),
                "register_view_block_navigation" | "enable_view_listener_metadata"
            ) {
                assert!(
                    !actual.methods[name].0,
                    "{name} must preserve the historical receipt"
                );
            }
            if policy.policy == "invalidate-before-decode" {
                assert!(
                    actual.methods[name].0,
                    "{name} must invalidate at Rust entry before decoding"
                );
            }
        }
        assert!(actual.classes.contains("InputCommitReceipt"));
        assert!(actual.classes.contains("InputCommitKind"));
    }
}

#[test]
fn compatibility_profile_exports_no_observed_methods_receipt_or_capability_stub() {
    let actual = exports(Profile::CompatWeb);
    assert!(!actual.methods.contains_key("input_observed"));
    assert!(!actual.methods.contains_key("read_input_commit_receipt"));
    assert!(!actual.classes.contains("InputCommitReceipt"));
    assert!(!actual.classes.contains("InputCommitKind"));
}

#[test]
fn issued_navigation_scope_exports_have_explicit_profile_and_names() {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ScopePolicy {
        js_name: String,
        policy: String,
        ordinary: bool,
        compatibility: bool,
    }
    let expected: BTreeMap<String, ScopePolicy> =
        serde_json::from_str(include_str!("scope-export-policy.json"))
            .expect("reviewed scope policy");
    for profile in [
        Profile::OrdinaryDefault,
        Profile::OrdinaryPreview,
        Profile::CompatWeb,
    ] {
        let actual = exports(profile);
        for (name, policy) in &expected {
            assert_eq!(policy.policy, "issued-view-command-scope-only");
            let present = if matches!(profile, Profile::CompatWeb) {
                policy.compatibility
            } else {
                policy.ordinary
            };
            assert_eq!(
                actual.functions.contains_key(&policy.js_name),
                present,
                "{name} profile"
            );
            if present {
                assert_eq!(
                    actual.functions[&policy.js_name], *name,
                    "{name} generated scope name"
                );
            }
        }
    }
}

#[test]
fn shipping_declarations_exclude_source_derived_development_exports() {
    let names = exports(Profile::OrdinaryPreview).development_only;
    assert!(
        !names.is_empty(),
        "development export inventory must be nonempty"
    );
    assert!(
        names.contains("debugCodeTokenProviders"),
        "known probe must be discovered"
    );
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let declarations = std::fs::read_to_string(
        root.join("../../../packages/collaboration/src/session/wasm.generated.d.ts"),
    )
    .expect("committed shipping declarations");
    let identifiers: BTreeSet<_> = declarations
        .split(|character: char| {
            !character.is_alphanumeric() && character != '_' && character != '$'
        })
        .collect();
    for name in names {
        assert!(
            !identifiers.contains(name.as_str()),
            "shipping declarations expose development export {name}"
        );
    }
}

#[test]
fn development_export_inventory_follows_module_and_member_cfg_and_names() {
    let fixture = syn::parse_file(
        r#"
        #[cfg(feature = "dev-probes")]
        mod probes {
            #[wasm_bindgen::prelude::wasm_bindgen(js_name = renamedProbe)]
            pub fn rust_name() {}
            #[wasm_bindgen]
            pub fn default_probe() {}
            #[wasm_bindgen]
            pub struct ProbeClass;
        }
        #[wasm_bindgen]
        impl ShippingClass {
            #[cfg(feature = "dev-probes")]
            #[wasm_bindgen(js_name = renamedMethod)]
            pub fn method(&self) {}
            pub fn shipping_method(&self) {}
        }
    "#,
    )
    .expect("fixture source");
    let mut actual = Exports::default();
    collect_items(
        &fixture.items,
        Path::new("fixture.rs"),
        Path::new("."),
        Profile::OrdinaryPreview,
        false,
        &mut actual,
    );
    assert_eq!(
        actual.development_only,
        BTreeSet::from([
            "renamedProbe".to_owned(),
            "default_probe".to_owned(),
            "ProbeClass".to_owned(),
            "renamedMethod".to_owned(),
        ])
    );
}

#[test]
fn conditional_attribute_inventory_ignores_disabled_conditions_and_refuses_active_ones() {
    let disabled: syn::ItemStruct = syn::parse_quote! {
        #[cfg_attr(test, derive(Clone, PartialEq))]
        pub struct Shipping;
    };
    assert!(enabled(&disabled.attrs, Profile::OrdinaryPreview));
    let active: syn::ItemFn = syn::parse_quote! {
        #[cfg_attr(feature = "dev-probes", wasm_bindgen)]
        pub fn new_probe() {}
    };
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        enabled(&active.attrs, Profile::OrdinaryPreview)
    }))
    .is_err());
}
