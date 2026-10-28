//! Batch positive OR membership without changing the property-filter AST.

use std::collections::BTreeMap;

use filter_ast::{Expr, ExprFrame};
use item_filters::ast::properties::{EntityRefId, PropertiesLiteral, PropertyMatchValue};
use recursion::CollapsibleExt;
use uuid::Uuid;

use super::{property_literal_predicate, sql_string_literal};

pub(super) fn predicate(expr: &Expr<PropertiesLiteral>, entity_id_sql: &str) -> String {
    // Fold once, retaining each maximal OR region until AND/NOT requires SQL.
    // Re-scanning subtrees for eligible leaves is quadratic on mixed skew trees.
    expr.collapse_frames(
        |frame: ExprFrame<Disjunction, PropertiesLiteral>| match frame {
            ExprFrame::And(left, right) => Disjunction::sql(format!(
                "({} AND {})",
                left.render(entity_id_sql),
                right.render(entity_id_sql)
            )),
            ExprFrame::Or(left, right) => left.merge(right),
            ExprFrame::Not(inner) => {
                Disjunction::sql(format!("(NOT {})", inner.render(entity_id_sql)))
            }
            ExprFrame::Literal(literal) => Disjunction::literal(literal, entity_id_sql),
        },
    )
    .render(entity_id_sql)
}

struct ReferenceGroup {
    first: PropertiesLiteral,
    ids: Vec<EntityRefId>,
}

#[derive(Default)]
struct Disjunction {
    references: BTreeMap<(Uuid, Option<String>), ReferenceGroup>,
    others: Vec<String>,
    terms: usize,
}

impl Disjunction {
    fn sql(sql: String) -> Self {
        Self {
            others: vec![sql],
            terms: 1,
            ..Self::default()
        }
    }

    fn literal(literal: PropertiesLiteral, entity_id_sql: &str) -> Self {
        let PropertyMatchValue::EntityRef(id) = &literal.value else {
            return Self::sql(property_literal_predicate(&literal, entity_id_sql));
        };
        let key = (
            literal.property_definition_id,
            literal.entity_type.map(|value| value.to_string()),
        );
        let group = ReferenceGroup {
            ids: vec![id.clone()],
            first: literal,
        };
        Self {
            references: BTreeMap::from([(key, group)]),
            others: Vec::new(),
            terms: 1,
        }
    }

    fn merge(mut self, mut other: Self) -> Self {
        // Move the smaller side into the larger side, including skew OR trees.
        if self.terms < other.terms {
            std::mem::swap(&mut self, &mut other);
        }
        for (key, mut group) in other.references {
            match self.references.entry(key) {
                std::collections::btree_map::Entry::Occupied(mut entry) => {
                    entry.get_mut().ids.append(&mut group.ids);
                }
                std::collections::btree_map::Entry::Vacant(entry) => {
                    entry.insert(group);
                }
            }
        }
        self.others.append(&mut other.others);
        self.terms += other.terms;
        self
    }

    fn render(self, entity_id_sql: &str) -> String {
        let mut predicates = self.others;
        predicates.extend(self.references.into_values().map(|group| {
            // Singleton groups retain their indexable JSON containment checks.
            if group.ids.len() == 1 {
                property_literal_predicate(&group.first, entity_id_sql)
            } else {
                membership_predicate(&group, entity_id_sql)
            }
        }));
        if predicates.len() == 1 {
            return predicates.pop().expect("one predicate");
        }
        format!("({})", predicates.join(" OR "))
    }
}

fn membership_predicate(group: &ReferenceGroup, entity_id_sql: &str) -> String {
    let ids = group
        .ids
        .iter()
        .map(|id| sql_string_literal(&id.to_string()))
        .collect::<Vec<_>>()
        .join(", ");
    let entity_type_clause = group
        .first
        .entity_type
        .map(|value| format!("AND ep_prop.entity_type = '{value}'"))
        .unwrap_or_default();
    let definition = group.first.property_definition_id;
    // The AST carries a variable-size set. Keep one membership predicate per
    // definition/type, rather than one correlated EXISTS per reference.
    // Guard both JSON kinds to retain @>'s behavior for non-array properties
    // and non-string entity IDs (->> alone would also match JSON numbers).
    format!(
        r#"EXISTS (
            SELECT 1 FROM entity_properties ep_prop
            CROSS JOIN LATERAL jsonb_array_elements(
                CASE WHEN jsonb_typeof(ep_prop.values->'value') = 'array'
                    THEN ep_prop.values->'value' ELSE '[]'::jsonb END
            ) ep_ref(value)
            WHERE ep_prop.entity_id = {entity_id_sql}
            {entity_type_clause}
            AND ep_prop.property_definition_id = '{definition}'
            AND jsonb_typeof(ep_ref.value->'entity_id') = 'string'
            AND ep_ref.value->>'entity_id' = ANY(ARRAY[{ids}]::text[])
        )"#
    )
}
