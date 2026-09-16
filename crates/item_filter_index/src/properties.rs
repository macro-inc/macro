//! Select-option and entity-reference filters shared by Soup and Mail.
//! Property snapshots are versioned independently of the immutable server capsules.

use super::*;

/// Select-option posting for one property definition (status, priority or tags).
pub fn select_attribute(definition: Uuid) -> Token {
    Token::new(format!("property-select:{definition}")).expect("UUID attribute is bounded")
}

/// Entity-reference posting for one property definition (for example assignees).
pub fn entity_attribute(definition: Uuid) -> Token {
    Token::new(format!("property-entity:{definition}")).expect("UUID attribute is bounded")
}

/// Reverse ownership evidence for one normalized property row.
pub fn row_attribute(definition: Uuid) -> Token {
    Token::new(format!("property-row:{definition}")).expect("UUID attribute is bounded")
}

/// Whether an attribute belongs to this property projection family.
pub fn is_property_attribute(attribute: &Token) -> bool {
    ["property-select:", "property-entity:", "property-row:"]
        .iter()
        .any(|prefix| attribute.as_str().starts_with(prefix))
}

/// A cached-Mail profile containing the same canonical message facts plus properties.
pub fn mail_profile() -> Profile {
    Profile::new(mail::token("soup-mail-v3"))
}

fn supported(ast: &EntityFilterAst) -> bool {
    supported_expr(ast.properties_filter.as_deref(), |literal| {
        // Current view selections are untyped. Typed property-row lookups need
        // association evidence not present in the GraphQL property snapshot.
        literal.entity_type.is_none()
    })
}

fn property_predicate(
    ast: &EntityFilterAst,
    partition: &Token,
) -> Result<PredicateExpr, CompileError> {
    compile_expr(ast.properties_filter.as_deref(), |literal| {
        if partition == &vocabulary::channel_partition() {
            // Channels have no properties in Soup. Preserve Boolean semantics
            // for negations rather than pretending all property filters exclude them.
            return Ok(PredicateExpr::None);
        }
        Ok(match &literal.value {
            PropertyMatchValue::SelectOption(id) => {
                exact_uuid(select_attribute(literal.property_definition_id), id)
            }
            PropertyMatchValue::EntityRef(id) => exact_utf8(
                entity_attribute(literal.property_definition_id),
                id.to_string(),
            )?,
        })
    })
}

fn add_properties(
    ast: &EntityFilterAst,
    query: ValidatedIndexQuery,
    profile: Profile,
) -> Result<LocalCompileOutcome, CompileError> {
    let mut query = query.as_query().clone();
    query.profile = profile;
    if ast.properties_filter.is_some() {
        for partition in &mut query.partitions {
            partition.predicate = PredicateExpr::And(
                Box::new(std::mem::replace(
                    &mut partition.predicate,
                    PredicateExpr::None,
                )),
                Box::new(property_predicate(ast, &partition.partition)?),
            );
        }
    }
    Ok(LocalCompileOutcome::Supported(ValidatedIndexQuery::new(
        query,
    )?))
}

/// Compile the current flat Soup profile without broadening any non-property filters.
pub fn compile_soup(
    ast: &EntityFilterAst,
    request: SoupFlatRequest,
) -> Result<LocalCompileOutcome, CompileError> {
    if !supported(ast) {
        return Ok(LocalCompileOutcome::Unsupported(
            UnsupportedReason::GlobalProperties,
        ));
    }
    let mut base = ast.clone();
    base.properties_filter = None;
    match compile_soup_flat_v4(&base, request)? {
        LocalCompileOutcome::Supported(query) => {
            add_properties(ast, query, vocabulary::profile_v5())
        }
        unsupported => Ok(unsupported),
    }
}

/// Compile current Mail properties while retaining readable-account and shared-grant gates.
pub fn compile_mail(
    ast: &EntityFilterAst,
    request: SoupFlatRequest,
    view: &str,
    links: &[Uuid],
    viewer: &str,
) -> Result<LocalCompileOutcome, CompileError> {
    if !supported(ast) {
        return Ok(LocalCompileOutcome::Unsupported(
            UnsupportedReason::GlobalProperties,
        ));
    }
    let mut base = ast.clone();
    base.properties_filter = None;
    match mail::compile(&base, request, view, links, viewer)? {
        LocalCompileOutcome::Supported(query) => add_properties(ast, query, mail_profile()),
        unsupported => Ok(unsupported),
    }
}
