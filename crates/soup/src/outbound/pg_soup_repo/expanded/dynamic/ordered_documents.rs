use item_filters::ast::EntityFilterAst;
use models_pagination::SimpleSortMethod;

use super::SOURCE_IDS_SQL;

pub(super) struct OrderedDocuments {
    pub ctes: String,
    pub arm: String,
}

pub(super) const PROBE_ALL_FALLBACK: &str =
    "                AND NOT (SELECT ok FROM doc_ordered_ok)\n";

fn strategy() -> String {
    format!(
        r#"doc_strategy AS MATERIALIZED (
    SELECT walk_budget, (
        SELECT count(*) >= walk_budget FROM (
            SELECT 1 FROM entity_access ea
            WHERE ea.source_id = ANY({SOURCE_IDS_SQL}) AND ea.entity_type = 'document'
            LIMIT walk_budget
        ) s
    ) AS dense
    FROM (
        SELECT 2 * ceil(sqrt($3::float8 * greatest(c.reltuples, 1)))::bigint AS walk_budget
        FROM pg_class c WHERE c.oid = '"Document"'::regclass
    ) k
),
"#
    )
}

const DENSE: &str = "(SELECT dense FROM doc_strategy)";

const UNVIEWED: &str = r#"NOT EXISTS (
            SELECT 1 FROM "UserHistory" uh
            WHERE uh."userId" = $1 AND uh."itemType" = 'document' AND uh."itemId" = w.id
        )"#;

const WALK_PAGE_FULL: &str =
    "(SELECT dense FROM doc_strategy) AND (SELECT count(*) FROM doc_walk) >= $3";

const VIEWED_PAGE_FULL: &str = "(SELECT count(*) FROM doc_viewed) >= $3";

fn ordered_ok(page_complete: &str) -> String {
    format!(
        r#"doc_ordered_ok AS MATERIALIZED (
    SELECT {page_complete} AS ok
),
"#
    )
}

/// `order` names raw columns (no casts) so the planner reads
/// `idx_document_updated_at_id`.
#[derive(Clone, Copy)]
struct Walk {
    ts: &'static str,
    order: &'static str,
    cursor: &'static str,
    gate: &'static str,
    filter: &'static str,
    outer_order: &'static str,
}

const UPDATED_WALK: Walk = Walk {
    ts: r#"d."updatedAt""#,
    order: r#"d."updatedAt" DESC, d.id DESC"#,
    cursor: r#"($4::timestamptz IS NULL OR (d."updatedAt", d.id) < ($4::timestamp, $5))"#,
    gate: DENSE,
    filter: "TRUE",
    outer_order: "w.ts DESC, w.id DESC",
};

const VIEWED_AT_WALK: Walk = Walk {
    ts: "'1970-01-01 00:00:00'::timestamp",
    order: "d.id DESC",
    cursor: "($4::timestamptz IS NULL OR $4::timestamp > '1970-01-01 00:00:00'::timestamp OR ($4::timestamp = '1970-01-01 00:00:00'::timestamp AND d.id < $5))",
    gate: "(SELECT dense FROM doc_strategy) AND (SELECT count(*) FROM doc_viewed) < $3",
    filter: UNVIEWED,
    outer_order: "w.id DESC",
};

pub(super) fn ordered_document_strategy(
    filter_ast: &EntityFilterAst,
    exclude_frecency: bool,
    sort_method: SimpleSortMethod,
) -> Option<OrderedDocuments> {
    if exclude_frecency
        || filter_ast.document_filter.is_some()
        || filter_ast.properties_filter.is_some()
    {
        return None;
    }
    let (viewed_gate, walk, page_complete) = match sort_method {
        SimpleSortMethod::CreatedAt => return None,
        SimpleSortMethod::UpdatedAt => (None, UPDATED_WALK, WALK_PAGE_FULL.to_string()),
        SimpleSortMethod::ViewedUpdated => (
            Some(DENSE),
            Walk {
                filter: UNVIEWED,
                ..UPDATED_WALK
            },
            WALK_PAGE_FULL.to_string(),
        ),
        SimpleSortMethod::ViewedAt => (
            Some("TRUE"),
            VIEWED_AT_WALK,
            format!("{VIEWED_PAGE_FULL} OR ({WALK_PAGE_FULL})"),
        ),
    };
    let viewed = viewed_gate.map(viewed_cte).unwrap_or_default();
    let ctes = [
        strategy().as_str(),
        viewed.as_str(),
        walk.cte().as_str(),
        ordered_ok(&page_complete).as_str(),
    ]
    .concat();
    let sources = if viewed_gate.is_some() {
        "SELECT id, ts FROM doc_viewed UNION ALL SELECT id, ts FROM doc_walk"
    } else {
        "SELECT id, ts FROM doc_walk"
    };
    let arm = format!(
        r#"
                SELECT 'document'::text AS item_type, o.id, o.ts::timestamptz AS sort_ts
                FROM ({sources}) o
                WHERE (SELECT ok FROM doc_ordered_ok)
"#
    );
    Some(OrderedDocuments { ctes, arm })
}

impl Walk {
    fn cte(self) -> String {
        let Walk {
            ts,
            order,
            cursor,
            gate,
            filter,
            outer_order,
        } = self;
        let granted = access_probe("w.id");
        format!(
            r#"doc_walk AS MATERIALIZED (
    SELECT w.id, w.ts FROM (
        SELECT d.id, {ts} AS ts
        FROM "Document" d
        WHERE {gate}
        AND d."deletedAt" IS NULL
        AND {cursor}
        ORDER BY {order}
        LIMIT (SELECT walk_budget FROM doc_strategy)
    ) w
    {granted}
    WHERE {filter}
    ORDER BY {outer_order}
    LIMIT $3
),
"#
        )
    }
}

/// A `LIMIT 1` lateral rather than `EXISTS`: the planner flattens `EXISTS`
/// into a hash semi join that consumes the whole walk window.
fn access_probe(id_sql: &str) -> String {
    format!(
        r#"CROSS JOIN LATERAL (
        SELECT 1 FROM entity_access ea
        WHERE ea.source_id = ANY({SOURCE_IDS_SQL}) AND ea.entity_type = 'document'
        AND ea.entity_id::text = {id_sql}
        LIMIT 1
    ) granted"#
    )
}

fn viewed_cte(gate: &str) -> String {
    let granted = access_probe("h.id");
    format!(
        r#"doc_viewed AS MATERIALIZED (
    SELECT h.id, h.ts FROM (
        SELECT uh."itemId" AS id, uh."updatedAt" AS ts
        FROM "UserHistory" uh
        WHERE {gate}
        AND uh."userId" = $1 AND uh."itemType" = 'document'
        AND ($4::timestamptz IS NULL OR (uh."updatedAt", uh."itemId") < ($4::timestamp, $5))
        ORDER BY uh."updatedAt" DESC, uh."itemId" DESC
    ) h
    CROSS JOIN LATERAL (
        SELECT 1 FROM "Document" d WHERE d.id = h.id AND d."deletedAt" IS NULL LIMIT 1
    ) live
    {granted}
    ORDER BY h.ts DESC, h.id DESC
    LIMIT $3
),
"#
    )
}
