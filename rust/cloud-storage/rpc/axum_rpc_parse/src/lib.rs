#![allow(clippy::result_large_err)]
use unsynn::*;

keyword! {
    pub KPub = "pub";
    pub KIn = "in";
    pub KRepr = "repr";
    pub KRouter = "router";
    pub KClient = "client";
    pub KBindgen = "bindgen";
    pub KIgnore = "ignore";
    pub KDoc = "doc";
    pub KTrait = "trait";
    pub KWhere = "where";
    pub KConst = "const";
    pub KJson = "json";
    pub KFn = "fn";
    pub KImpl = "impl";
    pub KFuture = "Future";
    pub KOutput = "Output";
    pub KResult = "Result";
    pub KSelf = "self";
    pub KType = "type";
}

operator! {
    /// Represents the '=' operator.
    Eq = "=";
    /// Represents the ';' operator.
    Semi = ";";
    /// Represents the apostrophe '\'' operator.
    Apostrophe = "'";
    /// Represents the double semicolon '::' operator.
    DoubleSemicolon = "::";
    /// Represents the '&'
    Ampersand = "&";
}

/// Represents a module path, consisting of an optional path separator followed by
/// a path-separator-delimited sequence of identifiers.
pub type ModPath = Cons<Option<PathSep>, DelimitedVec<Ident, PathSep>>;

/// Represents type bounds, consisting of a colon followed by tokens until
/// a comma, equals sign, or closing angle bracket is encountered.
pub type Bounds = Cons<Colon, VerbatimUntil<Either<Comma, Eq, Gt>>>;

/// Parses tokens and groups until `C` is found on the current token tree level.
pub type VerbatimUntil<C> = Any<Cons<Except<C>, AngleTokenTree>>;

/// Vector of `T` delimited by `;`
pub type SemicolonDelimitedVec<T> = DelimitedVec<T, Semicolon, TrailingDelimiter::Mandatory>;

unsynn! {

/// Represents visibility modifiers for items.
enum Vis {
    /// `pub(in? crate::foo::bar)`/`pub(in? ::foo::bar)`
    PubIn(Cons<KPub, ParenthesisGroupContaining<Cons<Option<KIn>, ModPath>>>),
    /// Public visibility, indicated by the "pub" keyword.
    Pub(KPub),
}

/// Represents an attribute annotation on a field, typically in the form `#[attr]`.
pub struct Attribute {
    /// The pound sign preceding the attribute.
    pub _pound: Pound,
    /// The content of the attribute enclosed in square brackets.
    pub body: BracketGroupContaining<AttributeInner>,
}

/// Represents the inner content of an attribute annotation.
pub enum AttributeInner {
    /// A server attribute that can contain specialized metadata.
    Router(RouterAttr),

    /// A documentation attribute typically used for generating documentation.
    Doc(DocInner),
    /// A representation attribute that specifies how data should be laid out.
    Repr(ReprInner),
    /// Any other attribute represented as a sequence of token trees.
    Any(Vec<TokenTree>),
}



pub struct RouterAttr {
    /// The keyword for the router attribute.
    _router: KRouter,
    /// The inner content of the client attribute.
    pub inner: ParenthesisGroupContaining<CommaDelimitedVec<RouterInner>>,
}

pub enum RouterInner {
    ClientDirective(ClientDirective),
    JsonDirective(KJson),
}

pub struct ClientDirective {
    _client: KClient,
    pub inner: Option<ParenthesisGroupContaining<ClientDirectiveValue>>
}

pub struct ClientDirectiveValue {
    bindgen: KBindgen
}

/// Represents documentation for an item.
pub struct DocInner {
    /// The "doc" keyword.
    pub _kw_doc: KDoc,
    /// The equality operator.
    pub _eq: Eq,
    /// The documentation content as a literal string.
    pub value: LiteralString,
}

/// Represents the inner content of a `repr` attribute, typically used for specifying
/// memory layout or representation hints.
pub struct ReprInner {
    /// The "repr" keyword.
    pub _kw_repr: KRepr,
    /// The representation attributes enclosed in parentheses.
    pub attr: ParenthesisGroupContaining<CommaDelimitedVec<Ident>>,
}

/// Represents an associated type in a trait.
pub struct AssociatedType {
    /// Zero or more attributes (including doc comments)
    pub attributes: Option<Many<Attribute>>,
    /// The "type" keyword.
    pub _type: KType,
    /// The name of the associated type.
    pub name: Ident,
    /// Optional bounds and default type.
    pub rest: VerbatimUntil<Semicolon>,
}

pub struct TraitFn {
    /// Zero or more attributes (including doc comments)
    pub attributes: Option<Many<Attribute>>,
    pub _fn: KFn,
    /// the name of the function
    pub name: Ident,
    /// Generic parameters for the trait, if any.
    pub generics: Option<GenericParams>,
    /// The representation attributes enclosed in parentheses.
    pub args: ParenthesisGroupContaining<Cons<Receiver, CommaDelimitedVec<FnArg>, Option<Comma>>>,
    pub return_type: AsyncReturnType,
}

pub struct AsyncReturnType {
    _arrow: RArrow,
    _impl: KImpl,
    _fut: KFuture,
    _lt: Lt,
    _output: KOutput,
    _eq: Eq,
    _res: KResult,
    _lt2: Lt,
    pub ok: VerbatimUntil<Comma>,
    _comma: Comma,
    pub err: AngleTokenTree,
    _gt: Gt,
    _gt2: Gt,
    pub rest: VerbatimUntil<Semicolon>,
}

pub struct Receiver {
    _amp: Ampersand,
    _self: KSelf,
    _comma: Option<Comma>
}

pub struct FnArg {
    pub attr: Option<Many<Attribute>>,
    pub name: Ident,
    _colon: Colon,
    pub val: ModPath
}

/// Represents an item within a trait body.
pub enum TraitItem {
    /// An associated type declaration.
    AssociatedType(AssociatedType),
    /// A trait function.
    Fn(TraitFn),
}

/// Represents a trait definition.
pub struct Trait {
    /// Attributes applied to the struct.
    pub attributes: Option<Many<Attribute>>,
    /// The visibility modifier of the struct (e.g., `pub`).
    pub vis: Option<Vis>,
    /// The "struct" keyword.
    pub _kw_struct: KTrait,
    /// The name of the struct.
    pub name: Ident,
    /// Generic parameters for the trait, if any.
    pub generics: Option<GenericParams>,

    pub super_traits: Option<Cons<Colon, VerbatimUntil<Either<KWhere, BraceGroup>>>>,

    /// Optional where clauses.
    pub clauses: Option<WhereClauses>,
    /// The enum variants enclosed in braces `{}`.
    pub body: BraceGroupContaining<SemicolonDelimitedVec<TraitItem>>,
}

/// Represents a `where` clause attached to a definition.
/// e.g., `where T: Trait, 'a: 'b`.
#[derive(Clone)]
pub struct WhereClauses {
    /// The `where` keyword.
    pub _kw_where: KWhere,
    /// The comma-delimited list of where clause predicates.
    pub clauses: CommaDelimitedVec<WhereClause>,
}

/// Represents a single predicate within a `where` clause.
/// e.g., `T: Trait` or `'a: 'b`.
#[derive(Clone)]
pub struct WhereClause {
    // FIXME: This likely breaks for absolute `::` paths
    /// The type or lifetime being constrained (e.g., `T` or `'a`).
    pub _pred: VerbatimUntil<Colon>,
    /// The colon separating the constrained item and its bounds.
    pub _colon: Colon,
    /// The bounds applied to the type or lifetime (e.g., `Trait` or `'b`).
    pub bounds: VerbatimUntil<Either<Comma, Semicolon, BraceGroup>>,
}

/// Represents the generic parameters of a struct or enum definition, enclosed in angle brackets.
/// e.g., `<'a, T: Trait, const N: usize>`.
pub struct GenericParams {
    /// The opening angle bracket `<`.
    pub _lt: Lt,
    /// The comma-delimited list of generic parameters.
    pub params: CommaDelimitedVec<GenericParam>,
    /// The closing angle bracket `>`.
    pub _gt: Gt,
}

/// Represents a single generic parameter within a `GenericParams` list.
pub enum GenericParam {
    /// A lifetime parameter, e.g., `'a` or `'a: 'b + 'c`.
    Lifetime {
        /// The lifetime identifier (e.g., `'a`).
        name: Lifetime,
        /// Optional lifetime bounds (e.g., `: 'b + 'c`).
        bounds: Option<Cons<Colon, VerbatimUntil<Either<Comma, Gt>>>>,
    },
    /// A const generic parameter, e.g., `const N: usize = 10`.
    Const {
        /// The `const` keyword.
        _const: KConst,
        /// The name of the const parameter (e.g., `N`).
        name: Ident,
        /// The colon separating the name and type.
        _colon: Colon,
        /// The type of the const parameter (e.g., `usize`).
        typ: VerbatimUntil<Either<Comma, Gt, Eq>>,
        /// An optional default value (e.g., `= 10`).
        default: Option<Cons<Eq, VerbatimUntil<Either<Comma, Gt>>>>,
    },
    /// A type parameter, e.g., `T: Trait = DefaultType`.
    Type {
        /// The name of the type parameter (e.g., `T`).
        name: Ident,
        /// Optional type bounds (e.g., `: Trait`).
        bounds: Option<Bounds>,
        /// An optional default type (e.g., `= DefaultType`).
        default: Option<Cons<Eq, VerbatimUntil<Either<Comma, Gt>>>>,
    },
}

/// Represents a lifetime annotation, like `'a`.
pub struct Lifetime {
    /// The apostrophe `'` starting the lifetime.
    pub _apostrophe: PunctJoint<'\''>,
    /// The identifier name of the lifetime (e.g., `a`).
    pub name: Ident,
}

/// Parses either a `TokenTree` or `<...>` grouping (which is not a [`Group`] as far as proc-macros
/// are concerned).
#[derive(Clone)]
pub struct AngleTokenTree(
    #[allow(clippy::type_complexity)] // look,
    pub  Either<Cons<Lt, Vec<Cons<Except<Gt>, AngleTokenTree>>, Gt>, TokenTree>,
);
}

#[cfg(test)]
mod tests {
    use super::*;
    use cool_asserts::assert_matches;
    use unsynn::ToTokens;

    static TRAIT_FN: &str = r#"
        fn hello(
            &self,
            arg: Arg,
        ) -> impl Future<Output = Result<String, MyErr>> + Send;
    "#;

    #[test]
    fn it_parses_trait_fn() {
        let mut token_iter = TRAIT_FN.to_token_iter();
        let f: Cons<SemicolonDelimitedVec<TraitItem>, EndOfStream> = token_iter.parse().unwrap();
        assert_matches!(&f.first.first().unwrap().value, TraitItem::Fn(TraitFn { attributes: None, _fn, name: _, generics: None, args: ParenthesisGroupContaining { content: Cons { first: _, second, third: _, .. } }, return_type: _ }) => {
            let arg = second.first().unwrap();
            assert_eq!(arg.value.name.to_string(), "arg");
            dbg!(arg);
        });
    }

    #[test]
    fn it_parses_multiple_trait_fn() {
        let input = r#"
            fn method(&self) -> impl Future<Output = Result<String, String>> + Send;
            fn method2(&self, req: String) -> impl Future<Output = Result<String, String>> + Send;
        "#;
        let mut token_iter = input.to_token_iter();
        let _result: Cons<SemicolonDelimitedVec<TraitItem>, EndOfStream> =
            token_iter.parse().unwrap();
    }

    #[test]
    fn it_parses_mod_path() {
        let mut token_iter = "axum::http::HeaderMap".to_token_iter();
        let m: ModPath = token_iter.parse().unwrap();
        assert_matches!(m, Cons { first: None, second, .. } => {
            let f = second.first().unwrap().value.to_string();
            assert_eq!(f, "axum");
            let f = second.get(1).unwrap().value.to_string();
            assert_eq!(f, "http");
            let f = second.get(2).unwrap().value.to_string();
            assert_eq!(f, "HeaderMap");
        });
    }

    #[test]
    fn it_parses_trait_without_super_traits() {
        let input = r#"
            pub trait MyTrait {
                type ServerContext;
                fn method(&self) -> impl Future<Output = Result<String, String>> + Send;
            }
        "#;
        let mut token_iter = input.to_token_iter();
        let result: Result<Cons<Trait, EndOfStream>> = token_iter.parse();
        if let Err(e) = &result {
            eprintln!("Parse error: {}", e);
        }
        assert!(result.is_ok(), "Failed to parse trait without super traits");
    }

    #[test]
    fn it_parses_trait_with_super_traits() {
        let input = r#"
            pub trait MyTrait: Send + Sync {
                type ServerContext: 'static;
                fn method(&self) -> impl Future<Output = Result<String, String>> + Send;
                fn method2(&self, req: String) -> impl Future<Output = Result<String, String>> + Send;
            }
        "#;
        let mut token_iter = input.to_token_iter();
        let result: Result<Cons<Trait, EndOfStream>> = token_iter.parse();
        if let Err(e) = &result {
            eprintln!("Parse error with super traits: {}", e);
        }
        assert!(result.is_ok(), "Failed to parse trait with super traits");
    }

    #[test]
    fn it_parses_associated_type() {
        let input = r#"
            type ServerContext: 'static;
        "#;
        let mut token_iter = input.to_token_iter();
        let result: Result<Cons<TraitItem, Semicolon, EndOfStream>> = token_iter.parse();
        result.unwrap();
    }

    #[test]
    fn it_parses_associated_type_directly() {
        let input = r#"type A;"#;
        let mut token_iter = input.to_token_iter();
        let result: Result<Cons<AssociatedType, Semicolon, EndOfStream>> = token_iter.parse();
        if let Err(e) = &result {
            eprintln!("Parse error direct: {}", e);
        }
        result.unwrap();
    }

    #[test]
    fn it_parses_one_associated_type_in_vec() {
        let input = r#"
            type A;
        "#;
        let mut token_iter = input.to_token_iter();
        let result: Result<Cons<SemicolonDelimitedVec<TraitItem>, EndOfStream>> =
            token_iter.parse();
        if let Err(e) = &result {
            eprintln!("Parse error: {}", e);
        }
        result.unwrap();
    }

    #[test]
    fn it_parses_two_associated_types() {
        let input = r#"
            type A: 'static;
            type B;
        "#;
        let mut token_iter = input.to_token_iter();
        let result: Result<Cons<SemicolonDelimitedVec<TraitItem>, EndOfStream>> =
            token_iter.parse();
        if let Err(e) = &result {
            eprintln!("Parse error: {}", e);
        }
        result.unwrap();
    }

    #[test]
    fn it_parses_trait_body() {
        let input = r#"
        {
            fn method(&self) -> impl Future<Output = Result<String, String>> + Send;
            fn patch_user_group(
                &self,
                req: PatchUserGroupRequest,
            ) -> impl Future<Output = Result<(), LegacyPermErr>> + Send;
        }
        "#;

        let mut token_iter = input.to_token_iter();
        let result: Result<
            Cons<BraceGroupContaining<SemicolonDelimitedVec<TraitItem>>, EndOfStream>,
        > = token_iter.parse();
        result.unwrap();
    }

    #[test]
    fn it_parses_trait_body2() {
        let input = r#"
        {
            fn method(&self) -> impl Future<Output = Result<String, String>> + Send;
            fn patch_user_group(
                &self,
                req: String,
            ) -> impl Future<Output = Result<String, String>> + Send;
        }
        "#;

        let mut token_iter = input.to_token_iter();
        let result: Result<
            Cons<BraceGroupContaining<SemicolonDelimitedVec<TraitItem>>, EndOfStream>,
        > = token_iter.parse();
        result.unwrap();
    }

    #[test]
    fn it_parses_full_trait() {
        let input = r#"
            pub trait LegacyGqlRpc: Send + Sync + 'static {
                type ServerContext: 'static;
                fn get_legacy_user_permissions(
                    &self,
                ) -> impl Future<Output = Result<GetLegacyUserPermissionsResponse, LegacyPermErr>> + Send;
                fn get_user_organization(
                    &self,
                ) -> impl Future<Output = Result<UserOrganizationResponse, LegacyPermErr>> + Send;
                fn patch_user_group(
                    &self,
                    req: PatchUserGroupRequest,
                ) -> impl Future<Output = Result<(), LegacyPermErr>> + Send;
                fn patch_user_onboarding(
                    &self,
                    req: PatchUserOnboardingRequest,
                ) -> impl Future<Output = Result<(), LegacyPermErr>> + Send;
            }
        "#;

        let mut token_iter = input.to_token_iter();
        let _: Cons<Trait, EndOfStream> = token_iter.parse().unwrap();
    }

    #[test]
    fn it_parses_advanced() {
        let input = r#"
            
pub trait LegacyGqlRpc: Send + Sync + 'static {
    type GetPermsExtractor: 'static;

    fn get_legacy_user_permissions(
        &self,
        ctx: Self::GetPermsExtractor,
    ) -> impl Future<Output = Result<GetLegacyUserPermissionsResponse, LegacyPermErr>> + Send;

    type OrgExtractor: 'static;

    fn get_user_organization(
        &self,
        ctx: Self::OrgExtractor,
    ) -> impl Future<Output = Result<Option<UserOrganizationResponse>, LegacyPermErr>> + Send;

    fn patch_user_group(
        &self,
        req: PatchUserGroupRequest,
    ) -> impl Future<Output = Result<(), LegacyPermErr>> + Send;

    fn patch_user_onboarding(
        &self,
        req: PatchUserOnboardingRequest,
    ) -> impl Future<Output = Result<(), LegacyPermErr>> + Send;
}
        "#;

        let mut token_iter = input.to_token_iter();
        let _: Cons<Trait, EndOfStream> = token_iter.parse().unwrap();
    }
}
