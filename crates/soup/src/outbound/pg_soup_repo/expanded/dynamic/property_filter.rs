//! Batch positive OR membership without changing the property-filter AST.

use std::collections::BTreeMap;

use filter_ast::{Expr, ExprFrame};
use item_filters::ast::properties::{EntityRefId, PropertiesLiteral, PropertyMatchValue};
use recursion::CollapsibleExt;
use uuid::Uuid;

use super::{PropertyProbe, property_literal_predicate, sql_string_literal};
use crate::outbound::pg_soup_repo::candidate_gates::PER_CANDIDATE;

#[cfg(test)]
mod test;

pub(super) fn predicate(
    expr: &Expr<PropertiesLiteral>,
    entity_id_sql: &str,
    probe: PropertyProbe,
) -> String {
    // Fold once, retaining each maximal OR region until AND/NOT requires SQL.
    // Re-scanning subtrees for eligible leaves is quadratic on mixed skew trees.
    expr.collapse_frames(
        |frame: ExprFrame<Disjunction, PropertiesLiteral>| match frame {
            ExprFrame::And(left, right) => Disjunction::sql(format!(
                "({} AND {})",
                left.render(entity_id_sql, probe),
                right.render(entity_id_sql, probe)
            )),
            ExprFrame::Or(left, right) => left.merge(right),
            ExprFrame::Not(inner) => {
                Disjunction::sql(format!("(NOT {})", inner.render(entity_id_sql, probe)))
            }
            ExprFrame::Literal(literal) => Disjunction::literal(literal, entity_id_sql, probe),
        },
    )
    .render(entity_id_sql, probe)
}

/// One property definition (and entity type) whose values an OR region
/// matches against several members.
struct MembershipGroup<T> {
    first: PropertiesLiteral,
    members: Vec<T>,
}

type GroupKey = (Uuid, Option<String>);

#[derive(Default)]
struct Disjunction {
    references: BTreeMap<GroupKey, MembershipGroup<EntityRefId>>,
    options: BTreeMap<GroupKey, MembershipGroup<Uuid>>,
    others: Vec<String>,
    terms: usize,
}

fn merge_groups<T>(
    into: &mut BTreeMap<GroupKey, MembershipGroup<T>>,
    from: BTreeMap<GroupKey, MembershipGroup<T>>,
) {
    for (key, mut group) in from {
        match into.entry(key) {
            std::collections::btree_map::Entry::Occupied(mut entry) => {
                entry.get_mut().members.append(&mut group.members);
            }
            std::collections::btree_map::Entry::Vacant(entry) => {
                entry.insert(group);
            }
        }
    }
}

impl Disjunction {
    fn sql(sql: String) -> Self {
        Self {
            others: vec![sql],
            terms: 1,
            ..Self::default()
        }
    }

    fn literal(literal: PropertiesLiteral, entity_id_sql: &str, probe: PropertyProbe) -> Self {
        let key = (
            literal.property_definition_id,
            literal.entity_type.map(|value| value.to_string()),
        );
        match &literal.value {
            PropertyMatchValue::EntityRef(id) => Self {
                references: BTreeMap::from([(
                    key,
                    MembershipGroup {
                        members: vec![id.clone()],
                        first: literal,
                    },
                )]),
                terms: 1,
                ..Self::default()
            },
            PropertyMatchValue::SelectOption(option_id) => Self {
                options: BTreeMap::from([(
                    key,
                    MembershipGroup {
                        members: vec![*option_id],
                        first: literal,
                    },
                )]),
                terms: 1,
                ..Self::default()
            },
            PropertyMatchValue::DateRange(_) => {
                Self::sql(property_literal_predicate(&literal, entity_id_sql, probe))
            }
        }
    }

    fn merge(mut self, mut other: Self) -> Self {
        // Move the smaller side into the larger side, including skew OR trees.
        if self.terms < other.terms {
            std::mem::swap(&mut self, &mut other);
        }
        merge_groups(&mut self.references, other.references);
        merge_groups(&mut self.options, other.options);
        self.others.append(&mut other.others);
        self.terms += other.terms;
        self
    }

    fn render(self, entity_id_sql: &str, probe: PropertyProbe) -> String {
        let mut predicates = self.others;
        // Singleton groups retain their indexable JSON containment checks.
        predicates.extend(self.references.into_values().map(|group| {
            if group.members.len() == 1 {
                property_literal_predicate(&group.first, entity_id_sql, probe)
            } else {
                reference_membership_predicate(&group, entity_id_sql, probe)
            }
        }));
        predicates.extend(self.options.into_values().map(|mut group| {
            // Sorted, so the SQL text does not depend on the shape of the OR
            // tree; deduplicated first, so `A OR A` keeps the singleton form.
            group.members.sort_unstable();
            group.members.dedup();
            if group.members.len() == 1 {
                property_literal_predicate(&group.first, entity_id_sql, probe)
            } else {
                option_membership_predicate(&group, entity_id_sql)
            }
        }));
        if predicates.len() == 1 {
            return predicates.pop().expect("one predicate");
        }
        format!("({})", predicates.join(" OR "))
    }
}

fn entity_type_clause(literal: &PropertiesLiteral) -> String {
    literal
        .entity_type
        .map(|value| format!("AND ep_prop.entity_type = '{value}'"))
        .unwrap_or_default()
}

fn reference_membership_predicate(
    group: &MembershipGroup<EntityRefId>,
    entity_id_sql: &str,
    probe: PropertyProbe,
) -> String {
    let ids = group
        .members
        .iter()
        .map(|id| sql_string_literal(&id.to_string()))
        .collect::<Vec<_>>()
        .join(", ");
    let entity_type_clause = entity_type_clause(&group.first);
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
            AND ep_ref.value->>'entity_id' = ANY(ARRAY[{ids}]::text[]){fence}
        )"#,
        fence = probe.fence(),
    )
}

fn option_membership_predicate(group: &MembershipGroup<Uuid>, entity_id_sql: &str) -> String {
    let options = group
        .members
        .iter()
        .map(|id| format!("'{id}'"))
        .collect::<Vec<_>>()
        .join(", ");
    let entity_type_clause = entity_type_clause(&group.first);
    let definition = group.first.property_definition_id;
    // `?|` is the OR of `?` over its array, so one EXISTS reads the entity's
    // row once. One EXISTS per option was planned as a hashed subplan each,
    // every one reading that option's rows across all entities.
    //
    // Fenced on every arm, whatever its `PropertyProbe`. Unlike that OR, a
    // single `EXISTS` can be pulled up into a semi-join, and Postgres drove
    // the Tasks list from the property index's matching rows across every
    // entity (misestimated ~40x), checking sub-type and access on each; cold,
    // that read every matching task in the database.
    format!(
        r#"EXISTS (
            SELECT 1 FROM entity_properties ep_prop
            WHERE ep_prop.entity_id = {entity_id_sql}
            {entity_type_clause}
            AND ep_prop.property_definition_id = '{definition}'
            AND ep_prop.values->'value' ?| ARRAY[{options}]::text[] {PER_CANDIDATE}
        )"#
    )
}
