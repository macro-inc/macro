//! Compile the indexed document subset of Soup's filter expressions.

use filter_ast::Expr;
use item_filters::ast::{
    date::DateLiteral,
    document::DocumentLiteral,
    properties::{PropertiesLiteral, PropertyEntityType, PropertyMatchValue},
};
use opensearch_query_builder::{BoolQueryBuilder, QueryType};

use super::{
    PropertyDateRange, PropertyFilterArg, build_property_filter,
    build_property_filter_with_constraint,
};

/// A Soup predicate whose semantics the document index cannot represent.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum FilterExpressionError {
    /// The document predicate is not indexed for expression filtering.
    #[error("unsupported document predicate in search filter expression")]
    DocumentPredicate,
    /// The index does not preserve this explicit property namespace.
    #[error("unsupported property namespace in search filter expression")]
    PropertyNamespace,
    /// The property predicate could not produce an indexed condition.
    #[error("unsupported property predicate in search filter expression")]
    PropertyPredicate,
}

/// An owned, validated expression that can be rendered into any query lifetime.
#[derive(Debug, Clone)]
pub struct CompiledFilterExpression {
    documents: Option<Expr<DocumentLiteral>>,
    properties: Option<Expr<PropertiesLiteral>>,
}

impl CompiledFilterExpression {
    /// Render the validated predicates without borrowing the expression's storage.
    pub fn to_query<'a>(&self) -> Result<QueryType<'a>, FilterExpressionError> {
        build_expression(self.documents.as_ref(), self.properties.as_ref())
    }
}

/// Compile required document and property expressions without changing access filters.
///
/// Supports indexed ID, owner, subtype, file type, update time, attachment flags,
/// and property predicates. Other Soup predicates fail rather than broaden results.
pub fn compile_filter_expression(
    documents: Option<&Expr<DocumentLiteral>>,
    properties: Option<&Expr<PropertiesLiteral>>,
) -> Result<CompiledFilterExpression, FilterExpressionError> {
    let _: QueryType<'static> = build_expression(documents, properties)?;
    Ok(CompiledFilterExpression {
        documents: documents.cloned(),
        properties: properties.cloned(),
    })
}

fn build_expression<'a>(
    documents: Option<&Expr<DocumentLiteral>>,
    properties: Option<&Expr<PropertiesLiteral>>,
) -> Result<QueryType<'a>, FilterExpressionError> {
    let mut required = BoolQueryBuilder::new();
    if let Some(expr) = documents {
        required.filter(compile_tree(expr, &document_literal)?);
    }
    if let Some(expr) = properties {
        required.filter(compile_tree(expr, &property_literal)?);
    }
    Ok(required.build().into())
}

fn compile_tree<'a, T>(
    expr: &Expr<T>,
    literal: &impl Fn(&T) -> Result<QueryType<'a>, FilterExpressionError>,
) -> Result<QueryType<'a>, FilterExpressionError> {
    let mut query = BoolQueryBuilder::new();
    match expr {
        Expr::Literal(value) => return literal(value),
        Expr::And(left, right) => {
            query.filter(compile_tree(left, literal)?);
            query.filter(compile_tree(right, literal)?);
        }
        Expr::Or(left, right) => {
            query.should(compile_tree(left, literal)?);
            query.should(compile_tree(right, literal)?);
            query.minimum_should_match(1);
        }
        Expr::Not(inner) => {
            query.must_not(compile_tree(inner, literal)?);
        }
    }
    Ok(query.build().into())
}

fn document_literal<'a>(value: &DocumentLiteral) -> Result<QueryType<'a>, FilterExpressionError> {
    Ok(match value {
        DocumentLiteral::Id(id) => QueryType::term("entity_id", id.to_string()),
        DocumentLiteral::Owner(owner) => QueryType::term("owner_id", owner.principal_id()),
        DocumentLiteral::SubType(kind) => QueryType::term("sub_type", kind.to_string()),
        DocumentLiteral::FileType(kind) => QueryType::term("file_type", kind.to_string()),
        DocumentLiteral::IsEmailAttachment(true) => QueryType::term("is_email_attachment", true),
        DocumentLiteral::IsEmailAttachment(false) => {
            let mut absent = BoolQueryBuilder::new();
            absent.must_not(QueryType::term("is_email_attachment", true));
            absent.build().into()
        }
        DocumentLiteral::UpdatedAt(value) => {
            let mut range = QueryType::range("updated_at_millis");
            match value {
                DateLiteral::GreaterThan(value) => range.gt(value.timestamp_millis()),
                DateLiteral::LessThan(value) => range.lt(value.timestamp_millis()),
                DateLiteral::GreaterThanOrEqual(value) => range.gte(value.timestamp_millis()),
                DateLiteral::LessThanOrEqual(value) => range.lte(value.timestamp_millis()),
            };
            range.build().into()
        }
        DocumentLiteral::Property(value) => return property_literal(value),
        DocumentLiteral::CreatedAt(_)
        | DocumentLiteral::ProjectId(_)
        | DocumentLiteral::Importance(_)
        | DocumentLiteral::NotificationState(_)
        | DocumentLiteral::IncludeCbmAtmNc(_)
        | DocumentLiteral::EmailAttachmentParticipant(_)
        | DocumentLiteral::CrmAssociated(_)
        | DocumentLiteral::NameContains(_) => return Err(FilterExpressionError::DocumentPredicate),
    })
}

fn property_literal<'a>(value: &PropertiesLiteral) -> Result<QueryType<'a>, FilterExpressionError> {
    let namespace = match value.entity_type {
        None => None,
        Some(PropertyEntityType::Task) => Some("TASK"),
        Some(PropertyEntityType::Document) => Some("DOCUMENT"),
        _ => return Err(FilterExpressionError::PropertyNamespace),
    };
    let mut filter = PropertyFilterArg {
        definition_id: value.property_definition_id.to_string(),
        values: Vec::new(),
        date_range: None,
        has_date: None,
    };
    match &value.value {
        PropertyMatchValue::SelectOption(id) => filter.values.push(id.to_string()),
        PropertyMatchValue::EntityRef(id) => filter.values.push(id.to_string()),
        PropertyMatchValue::DateRange(range) => {
            if range.start.is_some() || range.end.is_some() {
                filter.date_range = Some(PropertyDateRange {
                    start: range.start,
                    end: range.end,
                });
            }
            filter.has_date = Some(true);
        }
    }
    let Some(namespace) = namespace else {
        return build_property_filter(&filter).ok_or(FilterExpressionError::PropertyPredicate);
    };
    let namespace_field = "properties.entity_type";
    let exact = build_property_filter_with_constraint(
        &filter,
        Some(QueryType::term(namespace_field, namespace.to_owned())),
    )
    .ok_or(FilterExpressionError::PropertyPredicate)?;

    // Older index entries omit namespaces and contain only the canonical
    // subtype's properties. Preserve those reads until the index is rebuilt.
    let mut missing_namespace = BoolQueryBuilder::new();
    missing_namespace.must_not(QueryType::Exists(namespace_field.into()));
    let legacy_property =
        build_property_filter_with_constraint(&filter, Some(missing_namespace.build().into()))
            .ok_or(FilterExpressionError::PropertyPredicate)?;
    let mut legacy = BoolQueryBuilder::new();
    if namespace == "TASK" {
        legacy.filter(QueryType::term("sub_type", "task".to_owned()));
    } else {
        legacy.must_not(QueryType::term("sub_type", "task".to_owned()));
    }
    legacy.filter(legacy_property);
    let mut alternatives = BoolQueryBuilder::new();
    alternatives.should(exact);
    alternatives.should(legacy.build().into());
    alternatives.minimum_should_match(1);
    Ok(alternatives.build().into())
}

#[cfg(test)]
mod test;
