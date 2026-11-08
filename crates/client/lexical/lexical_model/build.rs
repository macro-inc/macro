//! Derive development hook IDs from the trait that the runtime implements.
fn main() {
    #[cfg(feature = "foreign-nodes")]
    hooks::generate();
}

#[cfg(feature = "foreign-nodes")]
mod hooks {
    use std::{collections::BTreeSet, env, fs, path::PathBuf};
    use syn::{Expr, Item, Lit, Meta, TraitItem};

    pub fn generate() {
        let source = "src/foreign/hooks.rs";
        println!("cargo:rerun-if-changed={source}");
        let file = syn::parse_file(&fs::read_to_string(source).expect("read hook trait"))
            .expect("parse hook trait");
        let definition = file
            .items
            .into_iter()
            .find_map(|item| match item {
                Item::Trait(item) if item.ident == "ForeignHooks" => Some(item),
                _ => None,
            })
            .expect("ForeignHooks declaration");
        let mut methods = Vec::new();
        for item in definition.items {
            let TraitItem::Fn(method) = item else {
                panic!("expected a ForeignHooks method");
            };
            let rust = method.sig.ident.to_string();
            let words = rust.split('_').collect::<Vec<_>>();
            let variant = words
                .iter()
                .map(|word| capitalized(word))
                .collect::<String>();
            let host = method
                .attrs
                .iter()
                .find_map(|attribute| {
                    if !attribute.path().is_ident("doc") {
                        return None;
                    }
                    let Meta::NameValue(meta) = &attribute.meta else {
                        return None;
                    };
                    let Expr::Lit(value) = &meta.value else {
                        return None;
                    };
                    let Lit::Str(value) = &value.lit else {
                        return None;
                    };
                    value
                        .value()
                        .trim()
                        .strip_prefix("Upstream host method: `")
                        .and_then(|name| name.strip_suffix("`."))
                        .map(str::to_owned)
                })
                .unwrap_or_else(|| {
                    let mut name = words[0].to_owned();
                    for word in &words[1..] {
                        name.push_str(&capitalized(word));
                    }
                    name
                });
            methods.push((rust, variant, host));
        }
        methods.sort();
        assert!(methods.len() <= 64, "foreign hooks exceed the host bitmask");
        let names = methods
            .iter()
            .map(|(_, _, host)| host)
            .collect::<BTreeSet<_>>();
        assert_eq!(names.len(), methods.len(), "duplicate upstream hook name");
        let mut output = String::from(
            "/// Development polymorphic hook IDs, derived from ForeignHooks.\n#[derive(Clone, Copy, Debug, PartialEq, Eq)]\n#[repr(u8)]\npub enum ForeignHook {\n",
        );
        for (rust, variant, _) in &methods {
            output.push_str(&format!("/// [ForeignHooks::{rust}].\n{variant},\n"));
        }
        output.push_str("}\nimpl ForeignHook {\n/// Every hook in stable dispatch-ID order.\npub const ALL: &'static [Self] = &[\n");
        for (_, variant, _) in &methods {
            output.push_str(&format!("Self::{variant},\n"));
        }
        output.push_str("];\n/// The matching upstream method name.\npub const fn upstream_name(self) -> &'static str { match self {\n");
        for (_, variant, host) in &methods {
            output.push_str(&format!("Self::{variant} => {host:?},\n"));
        }
        output.push_str("}}\n/// Bit used by the development host override mask.\npub const fn bit(self) -> u64 { 1u64 << (self as u8) }\n}\n");
        let destination = PathBuf::from(env::var_os("OUT_DIR").expect("build directory"))
            .join("foreign_hooks.rs");
        fs::write(destination, output).expect("write hook IDs");
    }

    fn capitalized(word: &str) -> String {
        let mut chars = word.chars();
        let first = chars.next().expect("nonempty hook identifier word");
        first.to_uppercase().chain(chars).collect()
    }
}
