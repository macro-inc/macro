use axum_rpc_parse::{ClientDirective, KRouter, ModPath, Trait, TraitFn, TraitItem};
use proc_macro2::TokenStream;
use quote::quote;
use unsynn::*;

fn attr_macros_inner(attr: TokenStream, mut input: TokenStream) -> TokenStream {
    let mut i = input.clone().to_token_iter();

    let target = parse_top_level_attr(&attr);

    match i.parse::<Cons<Trait, EndOfStream>>() {
        Ok(Cons { first, .. }) => {
            input.extend(generate_target(target, first));
            input
        }
        Err(err) => {
            panic!("Could not parse type declaration: {input}\nError: {err}");
        }
    }
}

enum ToGenerate {
    Client { bindgen: bool },
    Router,
}

fn parse_top_level_attr(attr: &TokenStream) -> ToGenerate {
    let mut i = attr.to_token_iter();

    match i.parse::<Cons<CommaDelimitedVec<Either<KRouter, ClientDirective>>, EndOfStream>>() {
        Ok(Cons { first, .. }) => {
            let has_router = first.iter().any(|v| matches!(v.value, Either::First(_)));
            let bindgen = first.iter().find_map(|v| match &v.value {
                Either::Second(a) => Some(a.inner.as_ref().map(|_| true).unwrap_or_default()),
                _ => None,
            });
            match (has_router, bindgen) {
                (true, None) => ToGenerate::Router,
                (false, Some(bindgen)) => ToGenerate::Client { bindgen },
                _ => panic!("Expected one of `router` or `client`"),
            }
        }
        Err(err) => {
            panic!("Could not parse type declaration {attr}\nError: {err}");
        }
    }
}

#[proc_macro_attribute]
pub fn attr_macros(
    attr: proc_macro::TokenStream,
    input: proc_macro::TokenStream,
) -> proc_macro::TokenStream {
    attr_macros_inner(attr.into(), input.into()).into()
}

fn generate_target(target: ToGenerate, tokens: Trait) -> TokenStream {
    // Validate that all trait functions have exactly 1 argument (besides &self)
    validate_trait_functions(&tokens);

    match target {
        ToGenerate::Client { bindgen } => generate_client(&tokens, bindgen),
        ToGenerate::Router => generate_router(&tokens),
    }
}

fn validate_trait_functions(tokens: &Trait) {
    for item in tokens.body.content.iter() {
        if let TraitItem::Fn(f) = &item.value {
            let args_count = f.args.content.second.len();
            if args_count > 2 {
                panic!(
                    "RPC trait method '{}' must have 0, 1, or 2 arguments (besides &self), but found {}. \
                    RPC methods should take the form: fn method_name(&self, [extractor: Self::AssociatedType,] [arg: ArgType]) -> ...",
                    f.name, args_count
                );
            }
        }
    }
}

/// Check if a ModPath represents an associated type (e.g., Self::SomeType)
fn is_associated_type(path: &ModPath) -> bool {
    // Check if path is Self::Something (no leading ::, first ident is "Self", has at least 2 segments)
    if path.first.is_some() {
        return false; // Has leading ::, not an associated type
    }

    let segments = &path.second;
    if segments.len() < 2 {
        return false; // Need at least Self::TypeName
    }

    // Check if first segment is "Self"
    segments.first().map(|d| d.value == "Self").unwrap_or(false)
}

fn generate_bindgen(tokens: &Trait, client_name: &Ident) -> TokenStream {
    fn generate_client_method(f: &TraitFn, trait_name: &Ident) -> TokenStream {
        let method_name = &f.name;
        let args = &f.args.content.second;

        // Separate extractor args from JSON args - wasm_bindgen can't handle associated types
        let json_args: Vec<_> = args
            .iter()
            .filter(|arg| !is_associated_type(&arg.value.val))
            .collect();

        // Generate argument streams only for non-extractor args
        let arg_streams: Vec<_> = json_args
            .iter()
            .map(|arg| {
                let name = &arg.value.name;
                let val = generate_mod_path(&arg.value.val);
                quote! { #name: #val }
            })
            .collect();

        // Generate argument names to pass to trait method
        // For extractors, pass (), for JSON args pass the actual value
        let call_args: Vec<_> = args
            .iter()
            .map(|arg| {
                let name = &arg.value.name;
                if is_associated_type(&arg.value.val) {
                    quote! { () }
                } else {
                    quote! { #name }
                }
            })
            .collect();

        let ok = f.return_type.ok.to_token_stream();

        quote! {
            pub async fn #method_name(&self, #(#arg_streams),*) -> Result<#ok, String> {
                #trait_name::#method_name(self, #(#call_args),*).await.map_err(|e| e.to_string())
            }
        }
    }

    let methods = tokens
        .body
        .content
        .iter()
        .filter_map(|Delimited { value, .. }| match value {
            TraitItem::Fn(f) => Some(generate_client_method(f, &tokens.name)),
            TraitItem::AssociatedType(_) => None,
        });

    quote! {
        #[::wasm_bindgen::prelude::wasm_bindgen]
        impl #client_name {
            pub fn construct(s: String) -> Result<Self, String> {
                let url = s.parse().map_err(|_| String::from("invalid url"))?;
                Ok(Self::builder().build(url).map_err(|e| e.to_string())?)
            }

            pub fn construct_with_headers(
                s: String,
                // TODO: fix this it causes the compile to fail
                // consider moving this code outside of quote
                // #[wasm_bindgen(typescript_type = "() => Headers")]
                headers_fn: ::js_sys::Function
            ) -> Result<Self, String> {
                let url = s.parse().map_err(|_| String::from("invalid url"))?;
                let middleware = ::axum_rpc::wasm::JsHeaderMiddleware::new(headers_fn);
                Ok(Self::builder()
                    .with(middleware)
                    .build(url)
                    .map_err(|e| e.to_string())?)
            }

            #(#methods)*

        }

    }
}

fn generate_client(tokens: &Trait, bindgen: bool) -> TokenStream {
    let trait_name = &tokens.name;
    let name_str = trait_name.to_string();
    let client_name = quote::format_ident!("{name_str}Client");
    let builder_name = quote::format_ident!("{name_str}ClientBuilder");

    let methods = generate_client_methods(tokens);
    let associated_types = generate_client_associated_types(tokens);

    let mut output = match bindgen {
        true => quote! {
            #[::wasm_bindgen::prelude::wasm_bindgen]
        },
        false => quote! {},
    };

    output.extend(quote! {
        #[derive(Clone)]
        pub struct #client_name {
            endpoint: ::url::Url,
            client: ::std::sync::Arc<::reqwest_middleware::ClientWithMiddleware>
        }


        impl #client_name {
            pub fn builder() -> #builder_name {
                #builder_name::new()
            }

            fn get_endpoint(&self, s: &'static str) -> ::url::Url {
                let mut url = self.endpoint.clone();
                url.path_segments_mut().unwrap().push(s);
                url
            }
        }

        impl #trait_name for #client_name {
            #(#associated_types)*

            #(#methods)*
        }


        pub struct #builder_name {
            builder: ::reqwest_middleware::ClientBuilder,
        }

        #[derive(Debug)]
        pub struct CannotBeBase;

        impl std::fmt::Display for CannotBeBase {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                write!(f, "Url cannot be a base. Must pass a qualified url e.g. https://macro.com")
            }
        }


        impl #builder_name {
            pub fn new_with_client(client: ::reqwest::Client) -> Self {
                #builder_name {
                    builder: ::reqwest_middleware::ClientBuilder::new(client)
                }
            }

            pub fn new() -> Self {
                let client = ::reqwest::Client::new();
                Self::new_with_client(client)
            }

            pub fn with<M: ::reqwest_middleware::Middleware>(self, middleware: M) -> Self {
                let #builder_name { builder } = self;
                #builder_name { builder: builder.with(middleware) }
            }

            pub fn build(self, endpoint: ::url::Url) -> Result<#client_name, CannotBeBase> {
                let #builder_name { builder } = self;

                let false = endpoint.cannot_be_a_base() else {
                    return Err(CannotBeBase);
                };

                Ok(#client_name {
                    endpoint,
                    client: ::std::sync::Arc::new(builder.build())
                })
            }
        }


    });

    if bindgen {
        output.extend(generate_bindgen(tokens, &client_name));
    }

    output
}

fn generate_client_method(f: &TraitFn) -> TokenStream {
    let method_name = &f.name;
    let ok = f.return_type.ok.to_token_stream();
    let err = f.return_type.err.to_token_stream();
    let literal = proc_macro2::Literal::string(&f.name.to_string());

    let args = &f.args.content.second;

    // Separate extractor args from JSON args
    let mut extractor_args = vec![];
    let mut json_arg = None;

    for arg in args.iter() {
        if is_associated_type(&arg.value.val) {
            extractor_args.push(arg);
        } else {
            json_arg = Some(arg);
        }
    }

    // Generate function signature with all arguments
    // For extractor args (Self::AssociatedType), use () in the client impl
    let all_args = args.iter().map(|arg| {
        let arg_name = &arg.value.name;
        if is_associated_type(&arg.value.val) {
            // Extractor argument - use () for client
            quote! { #arg_name: () }
        } else {
            let arg_val = generate_mod_path(&arg.value.val);
            quote! { #arg_name: #arg_val }
        }
    });

    match json_arg {
        Some(arg) => {
            // Has JSON body
            let arg_name = &arg.value.name;

            quote! {
                async fn #method_name(&self, #(#all_args),*) -> Result<#ok, #err> {
                    let endpoint = self.get_endpoint(#literal);
                    Ok(self.client.post(endpoint).with_inner_builder(|builder| builder.fetch_credentials_include()).json(&#arg_name).send().await?.error_for_status()?.json().await?)
                }
            }
        }
        None => {
            // No JSON body (only extractor args or no args at all)
            if extractor_args.is_empty() {
                // No arguments at all
                quote! {
                    async fn #method_name(&self) -> Result<#ok, #err> {
                        let endpoint = self.get_endpoint(#literal);
                        Ok(self.client.post(endpoint).with_inner_builder(|builder| builder.fetch_credentials_include()).send().await?.error_for_status()?.json().await?)
                    }
                }
            } else {
                // Only extractor args (passed but not used in HTTP call)
                quote! {
                    async fn #method_name(&self, #(#all_args),*) -> Result<#ok, #err> {
                        let endpoint = self.get_endpoint(#literal);
                        Ok(self.client.post(endpoint).with_inner_builder(|builder| builder.fetch_credentials_include()).send().await?.error_for_status()?.json().await?)
                    }
                }
            }
        }
    }
}

fn generate_mod_path(path: &ModPath) -> TokenStream {
    let mut tokens = TokenStream::new();

    // Add optional leading ::
    if let Some(path_sep) = &path.first {
        tokens.extend(path_sep.to_token_stream());
    }

    // Add the path segments (ident :: ident :: ident)
    tokens.extend(path.second.to_token_stream());

    tokens
}

/// Generate a mod path, replacing Self with the given type name for use in impl blocks
fn generate_mod_path_replace_self(path: &ModPath, replacement: &Ident) -> TokenStream {
    // Check if first segment is "Self" and replace it
    let segments = &path.second;
    if let Some(first_seg) = segments.first()
        && first_seg.value == "Self"
    {
        // Build new path with replacement
        let mut tokens = TokenStream::new();

        // Add optional leading ::
        if let Some(path_sep) = &path.first {
            tokens.extend(path_sep.to_token_stream());
        }

        // Add the replacement for Self
        tokens.extend(replacement.to_token_stream());

        // Add the rest (::TypeName)
        // Get the tail of segments after Self
        for i in 1..segments.len() {
            tokens.extend(quote! { :: });
            if let Some(seg) = segments.get(i) {
                tokens.extend(seg.value.to_token_stream());
            }
        }

        return tokens;
    }

    // No Self to replace, use original
    generate_mod_path(path)
}

fn generate_client_methods(tokens: &Trait) -> impl Iterator<Item = TokenStream> + '_ {
    tokens
        .body
        .content
        .iter()
        .filter_map(|Delimited { value, .. }| match value {
            TraitItem::Fn(f) => Some(generate_client_method(f)),
            TraitItem::AssociatedType(_) => None,
        })
}

fn generate_client_associated_types(tokens: &Trait) -> impl Iterator<Item = TokenStream> + '_ {
    tokens
        .body
        .content
        .iter()
        .filter_map(|Delimited { value, .. }| match value {
            TraitItem::AssociatedType(at) => {
                let type_name = &at.name;
                Some(quote! {
                    type #type_name = ();
                })
            }
            TraitItem::Fn(_) => None,
        })
}

fn generate_router(tokens: &Trait) -> TokenStream {
    let trait_name = &tokens.name;
    let name_str = trait_name.to_string();
    let builder_name = quote::format_ident!("{name_str}RouterBuilder");

    let handlers = generate_handlers(tokens);
    let handler_fns = generate_handler_fns(tokens);
    let build_where_bounds = generate_build_where_bounds(tokens);

    quote! {

        pub struct #builder_name<T> {
            state: T
        }


        #handler_fns

        impl<T: #trait_name + Clone> #builder_name<T> {
            pub fn new(state: T) -> Self {
                Self {
                    state
                }

            }

            pub fn build<S: Send + Sync>(self) -> ::axum::Router<S>
            where
                #(#build_where_bounds),*
            {
                ::axum::Router::new()#handlers.with_state(self.state)
            }
        }
    }
}

fn generate_build_where_bounds(tokens: &Trait) -> Vec<TokenStream> {
    use std::collections::HashSet;

    // Collect all associated types that are actually used as extractors
    let mut used_extractors = HashSet::new();

    for item in tokens.body.content.iter() {
        if let TraitItem::Fn(f) = &item.value {
            let args = &f.args.content.second;
            for arg in args.iter() {
                if is_associated_type(&arg.value.val) {
                    // Extract the type name from Self::TypeName
                    if let Some(type_name_ident) = arg.value.val.second.get(1) {
                        used_extractors.insert(type_name_ident.value.to_string());
                    }
                }
            }
        }
    }

    // Generate where bounds only for used extractors
    used_extractors
        .into_iter()
        .map(|type_name_str| {
            let type_name = quote::format_ident!("{}", type_name_str);
            quote! {
                T::#type_name: ::axum::extract::FromRequestParts<T> + Send
            }
        })
        .collect()
}

fn generate_handlers(tokens: &Trait) -> TokenStream {
    tokens
        .body
        .content
        .iter()
        .filter_map(|Delimited { value, .. }| match value {
            TraitItem::Fn(f) => {
                let literal = proc_macro2::Literal::string(&format!("/{}", &f.name));
                let HandlerName { handler_name } = HandlerName::new(f);

                Some(quote! {
                    .route(#literal, ::axum::routing::post(#handler_name::<T>))
                })
            }
            TraitItem::AssociatedType(_) => None,
        })
        .collect()
}

struct HandlerName {
    handler_name: Ident,
}

impl HandlerName {
    fn new(f: &TraitFn) -> Self {
        let handler_name = quote::format_ident!("{}_handler", f.name.to_string());
        HandlerName { handler_name }
    }
}

fn generate_handler_fns(tokens: &Trait) -> TokenStream {
    let trait_name = &tokens.name;

    tokens
        .body
        .content
        .iter()
        .filter_map(|Delimited { value, .. }| {
            let f = match value {
                TraitItem::Fn(f) => f,
                TraitItem::AssociatedType(_) => return None,
            };

            let args = &f.args.content.second;
            let ok = f.return_type.ok.to_token_stream();
            let err = f.return_type.err.to_token_stream();

            let HandlerName { handler_name } = HandlerName::new(f);
            let method_name = &f.name;

            // Separate extractor args from JSON args
            let mut extractor_args = vec![];
            let mut json_arg = None;

            for arg in args.iter() {
                if is_associated_type(&arg.value.val) {
                    extractor_args.push(arg);
                } else {
                    json_arg = Some(arg);
                }
            }

            // Generate extractor parameters only for the ones used in this method
            // Replace Self:: with T:: for use in handler function
            let t_ident = quote::format_ident!("T");
            let extractor_params = extractor_args.iter().map(|arg| {
                let arg_name = &arg.value.name;
                let arg_val = generate_mod_path_replace_self(&arg.value.val, &t_ident);
                quote! {
                    #arg_name: #arg_val
                }
            });

            // Generate where bounds only for the extractors used in this method
            let where_bounds = extractor_args.iter().map(|arg| {
                let arg_val = generate_mod_path_replace_self(&arg.value.val, &t_ident);
                quote! {
                    #arg_val: ::axum::extract::FromRequestParts<T> + Send
                }
            });

            // Generate the argument names to pass to the trait method
            let method_call_args = args.iter().map(|arg| {
                let arg_name = &arg.value.name;
                quote! { #arg_name }
            });

            match json_arg {
                Some(arg) => {
                    // Has JSON body
                    let json_arg_name = &arg.value.name;
                    let json_arg_val = generate_mod_path(&arg.value.val);

                    if extractor_args.is_empty() {
                        // No extractors, only JSON
                        Some(quote! {
                            async fn #handler_name<T>(
                                state: ::axum::extract::State<T>,
                                ::axum::extract::Json(#json_arg_name): ::axum::extract::Json<#json_arg_val>
                            ) -> Result<::axum::extract::Json<#ok>, #err>
                            where
                                T: #trait_name,
                                #(#where_bounds),*
                            {
                                state.0.#method_name(#(#method_call_args),*).await.map(::axum::extract::Json)
                            }
                        })
                    } else {
                        // Both extractors and JSON
                        Some(quote! {
                            async fn #handler_name<T>(
                                state: ::axum::extract::State<T>,
                                #(#extractor_params,)*
                                ::axum::extract::Json(#json_arg_name): ::axum::extract::Json<#json_arg_val>
                            ) -> Result<::axum::extract::Json<#ok>, #err>
                            where
                                T: #trait_name,
                                #(#where_bounds),*
                            {
                                state.0.#method_name(#(#method_call_args),*).await.map(::axum::extract::Json)
                            }
                        })
                    }
                }
                None => {
                    // No JSON body (only extractor args or no args at all)
                    Some(quote! {
                        async fn #handler_name<T>(
                            state: ::axum::extract::State<T>,
                            #(#extractor_params),*
                        ) -> Result<::axum::extract::Json<#ok>, #err>
                        where
                            T: #trait_name,
                            #(#where_bounds),*
                        {
                            state.0.#method_name(#(#method_call_args),*).await.map(::axum::extract::Json)
                        }
                    })
                }
            }
        })
        .collect()
}
