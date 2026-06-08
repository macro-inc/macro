use proc_macro::TokenStream;
use proc_macro2::TokenStream as TokenStream2;
use quote::{format_ident, quote};
use syn::{
    Data, DeriveInput, Fields, GenericArgument, LitStr, PathArguments, Type, parse_macro_input,
    parse_quote,
};

#[proc_macro_derive(MacroConfig, attributes(macro_config_default, serde))]
pub fn derive_macro_config(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);

    match expand_macro_config(input) {
        Ok(tokens) => tokens.into(),
        Err(error) => error.to_compile_error().into(),
    }
}

fn expand_macro_config(input: DeriveInput) -> syn::Result<TokenStream2> {
    let struct_name = input.ident;
    let struct_name_string = struct_name.to_string();
    let rename_all = serde_rename_all(&input.attrs)?;

    let fields = match input.data {
        Data::Struct(data) => match data.fields {
            Fields::Named(fields) => fields.named,
            _ => {
                return Err(syn::Error::new_spanned(
                    struct_name,
                    "MacroConfig only supports structs with named fields",
                ));
            }
        },
        _ => {
            return Err(syn::Error::new_spanned(
                struct_name,
                "MacroConfig only supports structs",
            ));
        }
    };

    let mut field_data = Vec::new();
    for (index, field) in fields.into_iter().enumerate() {
        let ident = field.ident.ok_or_else(|| {
            syn::Error::new_spanned(&field.ty, "MacroConfig only supports named fields")
        })?;
        let ty = field.ty;
        let key = serde_rename(&field.attrs)?.unwrap_or_else(|| {
            let field_name = ident.to_string();
            apply_rename_all(&field_name, rename_all.as_deref())
        });
        let default = macro_config_default(&field.attrs)?;
        let is_option = default.is_none() && is_option_type(&ty);
        let variant = format_ident!("Field{index}");

        field_data.push(FieldData {
            ident,
            ty,
            key,
            default,
            is_option,
            variant,
        });
    }

    let field_keys = field_data.iter().map(|field| field.key.as_str());
    let variants = field_data.iter().map(|field| &field.variant);
    let field_matches = field_data.iter().map(|field| {
        let key = field.key.as_str();
        let variant = &field.variant;
        quote! { #key => Ok(__MacroConfigField::#variant), }
    });
    let initializers = field_data.iter().map(|field| {
        let ident = &field.ident;
        quote! { let mut #ident = None; }
    });
    let value_matches = field_data.iter().map(|field| {
        let FieldData {
            ident,
            ty,
            key,
            default,
            variant,
            ..
        } = field;

        match default {
            Some(default) => quote! {
                __MacroConfigField::#variant => {
                    if #ident.is_some() {
                        return Err(<V::Error as ::macro_config::__serde::de::Error>::duplicate_field(#key));
                    }
                    #ident = Some(
                        map.next_value::<Option<#ty>>()?
                            .unwrap_or_else(|| #default)
                    );
                }
            },
            None => quote! {
                __MacroConfigField::#variant => {
                    if #ident.is_some() {
                        return Err(<V::Error as ::macro_config::__serde::de::Error>::duplicate_field(#key));
                    }
                    #ident = Some(map.next_value::<#ty>()?);
                }
            },
        }
    });
    let finalizers = field_data.iter().map(|field| {
        let FieldData {
            ident,
            key,
            default,
            is_option,
            ..
        } = field;

        match default {
            Some(default) => quote! {
                let #ident = #ident.unwrap_or_else(|| #default);
            },
            None if *is_option => quote! {
                let #ident = #ident.unwrap_or(None);
            },
            None => quote! {
                let #ident = #ident.ok_or_else(|| {
                    <V::Error as ::macro_config::__serde::de::Error>::missing_field(#key)
                })?;
            },
        }
    });
    let struct_fields = field_data.iter().map(|field| &field.ident);

    let mut impl_generics_with_de = input.generics.clone();
    impl_generics_with_de.params.insert(0, parse_quote!('de));
    let (impl_generics, _, where_clause) = impl_generics_with_de.split_for_impl();
    let (_, ty_generics, _) = input.generics.split_for_impl();

    Ok(quote! {
        impl #impl_generics ::macro_config::__serde::Deserialize<'de> for #struct_name #ty_generics #where_clause {
            fn deserialize<__D>(deserializer: __D) -> Result<Self, __D::Error>
            where
                __D: ::macro_config::__serde::Deserializer<'de>,
            {
                const FIELDS: &[&str] = &[#(#field_keys),*];

                enum __MacroConfigField {
                    #(#variants),*
                }

                impl<'de> ::macro_config::__serde::Deserialize<'de> for __MacroConfigField {
                    fn deserialize<__D>(deserializer: __D) -> Result<Self, __D::Error>
                    where
                        __D: ::macro_config::__serde::Deserializer<'de>,
                    {
                        struct __MacroConfigFieldVisitor;

                        impl<'de> ::macro_config::__serde::de::Visitor<'de> for __MacroConfigFieldVisitor {
                            type Value = __MacroConfigField;

                            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                                formatter.write_str("a config field")
                            }

                            fn visit_str<__E>(self, value: &str) -> Result<Self::Value, __E>
                            where
                                __E: ::macro_config::__serde::de::Error,
                            {
                                match value {
                                    #(#field_matches)*
                                    _ => Err(__E::unknown_field(value, FIELDS)),
                                }
                            }
                        }

                        deserializer.deserialize_identifier(__MacroConfigFieldVisitor)
                    }
                }

                struct __MacroConfigVisitor;

                impl<'de> ::macro_config::__serde::de::Visitor<'de> for __MacroConfigVisitor {
                    type Value = #struct_name #ty_generics;

                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        formatter.write_str(concat!("struct ", #struct_name_string))
                    }

                    fn visit_map<V>(self, mut map: V) -> Result<Self::Value, V::Error>
                    where
                        V: ::macro_config::__serde::de::MapAccess<'de>,
                    {
                        #(#initializers)*

                        while let Some(key) = map.next_key::<__MacroConfigField>()? {
                            match key {
                                #(#value_matches)*
                            }
                        }

                        #(#finalizers)*

                        Ok(#struct_name {
                            #(#struct_fields),*
                        })
                    }
                }

                deserializer.deserialize_struct(#struct_name_string, FIELDS, __MacroConfigVisitor)
            }
        }
    })
}

struct FieldData {
    ident: syn::Ident,
    ty: Type,
    key: String,
    default: Option<TokenStream2>,
    is_option: bool,
    variant: syn::Ident,
}

fn macro_config_default(attrs: &[syn::Attribute]) -> syn::Result<Option<TokenStream2>> {
    let mut default = None;

    for attr in attrs {
        if attr.path().is_ident("macro_config_default") {
            if default.is_some() {
                return Err(syn::Error::new_spanned(
                    attr,
                    "duplicate macro_config_default attribute",
                ));
            }
            default = Some(attr.parse_args::<TokenStream2>()?);
        }
    }

    Ok(default)
}

fn serde_rename_all(attrs: &[syn::Attribute]) -> syn::Result<Option<String>> {
    let mut rename_all = None;

    for attr in attrs {
        if attr.path().is_ident("serde") {
            attr.parse_nested_meta(|meta| {
                if meta.path.is_ident("rename_all") {
                    let value = meta.value()?;
                    let value = value.parse::<LitStr>()?;
                    rename_all = Some(value.value());
                }
                Ok(())
            })?;
        }
    }

    Ok(rename_all)
}

fn serde_rename(attrs: &[syn::Attribute]) -> syn::Result<Option<String>> {
    let mut rename = None;

    for attr in attrs {
        if attr.path().is_ident("serde") {
            attr.parse_nested_meta(|meta| {
                if meta.path.is_ident("rename") {
                    let value = meta.value()?;
                    let value = value.parse::<LitStr>()?;
                    rename = Some(value.value());
                }
                Ok(())
            })?;
        }
    }

    Ok(rename)
}

fn apply_rename_all(field_name: &str, rename_all: Option<&str>) -> String {
    match rename_all {
        Some("SCREAMING_SNAKE_CASE") => to_screaming_snake_case(field_name),
        Some("lowercase") => field_name.to_ascii_lowercase(),
        Some("snake_case") | None => field_name.to_string(),
        _ => field_name.to_string(),
    }
}

fn to_screaming_snake_case(value: &str) -> String {
    let mut out = String::new();
    let mut previous_was_lowercase_or_digit = false;

    for ch in value.chars() {
        if ch == '-' || ch == ' ' {
            if !out.ends_with('_') {
                out.push('_');
            }
            previous_was_lowercase_or_digit = false;
        } else if ch.is_ascii_uppercase() {
            if previous_was_lowercase_or_digit && !out.ends_with('_') {
                out.push('_');
            }
            out.push(ch);
            previous_was_lowercase_or_digit = false;
        } else {
            out.push(ch.to_ascii_uppercase());
            previous_was_lowercase_or_digit = ch.is_ascii_lowercase() || ch.is_ascii_digit();
        }
    }

    out
}

fn is_option_type(ty: &Type) -> bool {
    let Type::Path(path) = ty else {
        return false;
    };

    let Some(segment) = path.path.segments.last() else {
        return false;
    };

    if segment.ident != "Option" {
        return false;
    }

    matches!(
        &segment.arguments,
        PathArguments::AngleBracketed(args)
            if args.args.iter().any(|arg| matches!(arg, GenericArgument::Type(_)))
    )
}
