//! Embed the shared tooling pin without runtime filesystem access.
fn main() {
    generate_export_inputs();
    let manifest = env!("CARGO_MANIFEST_DIR");
    let pin = std::path::Path::new(&manifest)
        .join("../../../../packages/lexical-conformance/upstream.lock");
    println!("cargo:rerun-if-changed={}", pin.display());
    let contents = std::fs::read_to_string(pin).expect("shared upstream pin");
    let value: serde_json::Value =
        serde_json::from_str(&contents).expect("valid upstream pin JSON");
    let version = value
        .get("version")
        .and_then(serde_json::Value::as_str)
        .expect("upstream version");
    println!("cargo:rustc-env=LEXICAL_UPSTREAM_VERSION={version}");
}

use std::path::{Path, PathBuf};
use syn::{Attribute, FnArg, ImplItem, Item, Type};

type Input = (String, u32, Vec<(u32, u32, bool)>, Vec<u8>);

fn generate_export_inputs() {
    let mut exports = Vec::new();
    visit(Path::new("src/lib.rs"), &mut exports);
    exports.sort();
    let entries = exports
        .iter()
        .map(|(name, bytes, strings, abi)| format!("({name:?}, {bytes}, &{strings:?}, &{abi:?})"))
        .collect::<Vec<_>>()
        .join(",\n");
    let output = format!("pub const EXPORT_INPUTS: &[Input] = &[{entries}];\n");
    let path = PathBuf::from(std::env::var_os("OUT_DIR").expect("build output directory"))
        .join("export_inputs.rs");
    std::fs::write(path, output).expect("write export input schema");
}

fn bound(attributes: &[Attribute]) -> bool {
    attributes.iter().any(|a| a.path().is_ident("wasm_bindgen"))
}

fn check_attributes(attributes: &[Attribute], constructor: bool) {
    for attribute in attributes
        .iter()
        .filter(|a| a.path().is_ident("wasm_bindgen"))
    {
        match &attribute.meta {
            syn::Meta::Path(_) => {}
            syn::Meta::List(list) if constructor && list.tokens.to_string() == "constructor" => {}
            _ => panic!("extend input derivation before adding renamed or custom exports"),
        }
    }
}

fn visit(path: &Path, exports: &mut Vec<Input>) {
    println!("cargo:rerun-if-changed={}", path.display());
    let text = std::fs::read_to_string(path).expect("read boundary source");
    let file = syn::parse_file(&text).expect("parse boundary source");
    for item in file.items {
        match item {
            Item::Fn(function) if bound(&function.attrs) => {
                check_attributes(&function.attrs, false);
                exports.push(signature(function.sig.ident.to_string(), &function.sig));
            }
            Item::Impl(implementation) if bound(&implementation.attrs) => {
                check_attributes(&implementation.attrs, false);
                let Type::Path(class) = implementation.self_ty.as_ref() else {
                    panic!("unsupported wasm-bindgen class type");
                };
                let class = class.path.get_ident().expect("local boundary class");
                for item in implementation.items {
                    if let ImplItem::Fn(method) = item {
                        check_attributes(&method.attrs, true);
                        exports.push(signature(
                            format!("{}_{}", class.to_string().to_lowercase(), method.sig.ident),
                            &method.sig,
                        ));
                    }
                }
            }
            Item::Mod(module) if module.content.is_none() && module.ident != "test" => {
                let directory = if path.file_name().is_some_and(|p| p == "lib.rs") {
                    path.parent().expect("source directory").to_path_buf()
                } else {
                    path.with_extension("")
                };
                visit(&directory.join(format!("{}.rs", module.ident)), exports);
            }
            _ => {}
        }
    }
}

fn signature(name: String, signature: &syn::Signature) -> Input {
    let mut bytes = 0;
    let mut position = 0;
    let mut strings = Vec::new();
    let mut abi = Vec::new();
    for argument in &signature.inputs {
        let FnArg::Typed(argument) = argument else {
            bytes += 4;
            position += 1;
            abi.push(0);
            continue;
        };
        let mut ty = argument.ty.as_ref();
        if let Type::Reference(reference) = ty {
            ty = &reference.elem;
        }
        let Type::Path(path) = ty else {
            panic!("extend input derivation for new boundary argument type");
        };
        match path
            .path
            .segments
            .last()
            .expect("argument type")
            .ident
            .to_string()
            .as_str()
        {
            "str" | "String" => {
                strings.push((position, position + 1, false));
                position += 2;
                abi.extend([0, 0]);
            }
            "Option" => {
                let syn::PathArguments::AngleBracketed(arguments) =
                    &path.path.segments[0].arguments
                else {
                    panic!("expected optional string");
                };
                assert!(
                    matches!(arguments.args.first(), Some(syn::GenericArgument::Type(Type::Path(p))) if p.path.is_ident("String")),
                    "extend input derivation for new optional argument"
                );
                strings.push((position, position + 1, true));
                position += 2;
                abi.extend([0, 0]);
            }
            "JsValue" => {
                position += 1;
                abi.push(2);
            }
            "bool" => {
                bytes += 1;
                position += 1;
                abi.push(0);
            }
            "u32" => {
                bytes += 4;
                position += 1;
                abi.push(0);
            }
            "f64" => {
                bytes += 8;
                position += 1;
                abi.push(1);
            }
            _ => panic!("extend input derivation for new boundary argument type"),
        }
    }
    (name, bytes, strings, abi)
}
