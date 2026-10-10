//! Candidate arms for documents, chats and projects that read `source_items`.
//!
//! `source_items` has a row per (source, item) the source can see, indexed by
//! `(source_id, kind, sort_ts DESC, entity_id DESC)`. An arm reads each of the
//! user's sources newest first and stops at the page, so its cost follows the
//! page and the number of sources rather than everything the user can see.
//!
//! Every arm that stops early has to apply the whole filter, the cursor and the
//! frecency exclusion before its `LIMIT`. An item outranked by fewer than a page
//! of matching items overall is outranked by fewer than a page within each of
//! its sources, so per-source limits cannot drop it, but only if the rows they
//! count are rows the page could show.

#[cfg(test)]
mod test;

use document_sub_type::DocumentSubType;
use filter_ast::{Expr, ExprFrame};
use item_filters::ast::{
    chat::ChatLiteral,
    date::DateLiteral,
    document::DocumentLiteral,
    project::ProjectLiteral,
    properties::{PropertiesLiteral, PropertyEntityType},
};
use models_pagination::SimpleSortMethod;
use recursion::CollapsibleExt;
use sqlx::{Postgres, QueryBuilder};

use super::{
    DOCUMENT_TASK_PROPERTY_JOINS, USER_HOLDS_GRANT_SOURCE, build_chat_filter,
    build_document_filter, build_project_filter, build_properties_filter,
    document_filter_needs_task_property_joins, properties_filter_can_apply_to, push_not_inward,
    push_union_separator,
};

/// The sort key main gives never-viewed items under `ViewedAt`.
const EPOCH: &str = "'1970-01-01 00:00:00'::timestamp::timestamptz";

/// The sorts `source_items` can serve. Its `sort_ts` is the item's
/// `"updatedAt"`, which says nothing about `CreatedAt`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FeedSort {
    UpdatedAt,
    ViewedUpdated,
    ViewedAt,
}

impl FeedSort {
    fn of(sort: SimpleSortMethod) -> Option<Self> {
        match sort {
            SimpleSortMethod::UpdatedAt => Some(FeedSort::UpdatedAt),
            SimpleSortMethod::ViewedUpdated => Some(FeedSort::ViewedUpdated),
            SimpleSortMethod::ViewedAt => Some(FeedSort::ViewedAt),
            SimpleSortMethod::CreatedAt => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FeedEntity {
    Document,
    Chat,
    Project,
}

impl FeedEntity {
    fn item_type(self) -> &'static str {
        match self {
            FeedEntity::Document => "document",
            FeedEntity::Chat => "chat",
            FeedEntity::Project => "project",
        }
    }

    fn table(self) -> &'static str {
        match self {
            FeedEntity::Document => r#""Document" d"#,
            FeedEntity::Chat => r#""Chat" c"#,
            FeedEntity::Project => r#""Project" p"#,
        }
    }

    fn alias(self) -> &'static str {
        match self {
            FeedEntity::Document => "d",
            FeedEntity::Chat => "c",
            FeedEntity::Project => "p",
        }
    }

    fn kinds(self) -> &'static [&'static str] {
        match self {
            FeedEntity::Document => &["document", "task"],
            FeedEntity::Chat => &["chat"],
            FeedEntity::Project => &["project"],
        }
    }
}

/// Where an arm finds its items.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Driver {
    /// The user's sources in `source_items`, read in sort order.
    Sources,
    /// `"Document"(owner, "updatedAt" DESC, id DESC)`, read in sort order, for
    /// a filter on one owner.
    Owner,
    /// The `NotificationItems` CTE, for a filter on notification state. The
    /// set is the user's notifications, sorted whole.
    Notifications,
    /// The item table's own indexes, for a filter that pins every row to an id
    /// or a parent project. The few matches are sorted whole.
    Lookup,
}

impl Driver {
    fn reads_in_order(self) -> bool {
        match self {
            Driver::Sources | Driver::Owner => true,
            Driver::Notifications | Driver::Lookup => false,
        }
    }
}

/// The items an arm lists and the order it reads them in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    /// Every item, by `"updatedAt"`.
    All,
    /// Items the user never viewed, by `"updatedAt"`.
    Unviewed,
    /// Items the user never viewed, by id, all with the `EPOCH` sort key.
    Tail,
}

#[derive(Debug)]
pub(super) struct FeedArm {
    entity: FeedEntity,
    /// The `source_items` kinds the filter can match. Empty when it matches none.
    kinds: Vec<&'static str>,
    driver: Driver,
    /// Joins `filter` needs, after the entity's table.
    joins: String,
    /// ` AND ...` predicates on the entity's table alias.
    filter: String,
    /// Needs only the item's id, so scans test it without reading the item's table.
    properties: Option<Expr<PropertiesLiteral>>,
    /// Top-level bounds on `"updatedAt"`, which `source_items` reads can range on.
    updated_at_bounds: Vec<DateLiteral>,
}

impl FeedArm {
    pub(super) fn document(
        filter_ast: Option<&Expr<DocumentLiteral>>,
        properties: Option<&Expr<PropertiesLiteral>>,
        notified: bool,
    ) -> Self {
        // A document's properties are stored as TASK exactly when it is a task,
        // and its sub type is fixed when it is created.
        let mut document =
            properties_filter_can_apply_to(properties, &[PropertyEntityType::Document]);
        let mut task = properties_filter_can_apply_to(properties, &[PropertyEntityType::Task]);
        let mut owner = false;
        let mut updated_at_bounds = Vec::new();
        for conjunct in Conjuncts::of(filter_ast).iter() {
            match conjunct {
                Expr::Literal(DocumentLiteral::SubType(DocumentSubType::Task))
                | Expr::Literal(DocumentLiteral::Importance(false))
                | Expr::Literal(DocumentLiteral::IncludeCbmAtmNc(true)) => document = false,
                Expr::Literal(DocumentLiteral::SubType(_)) => task = false,
                Expr::Not(inner)
                    if matches!(
                        **inner,
                        Expr::Literal(DocumentLiteral::SubType(DocumentSubType::Task))
                    ) =>
                {
                    task = false
                }
                Expr::Literal(DocumentLiteral::Owner(_)) => owner = true,
                Expr::Literal(DocumentLiteral::UpdatedAt(lit)) => {
                    updated_at_bounds.push(lit.clone())
                }
                _ => {}
            }
        }
        let driver = if notified {
            Driver::Notifications
        } else if pins_rows(filter_ast, |lit| {
            matches!(lit, DocumentLiteral::Id(_) | DocumentLiteral::ProjectId(_))
        }) {
            Driver::Lookup
        } else if owner {
            Driver::Owner
        } else {
            Driver::Sources
        };
        // `Importance` and `IncludeCbmAtmNc` filters read these aliases.
        let joins = if document_filter_needs_task_property_joins(filter_ast) {
            format!(
                "\n                LEFT JOIN document_sub_type dt ON dt.document_id = d.id{DOCUMENT_TASK_PROPERTY_JOINS}"
            )
        } else {
            String::new()
        };
        FeedArm {
            entity: FeedEntity::Document,
            kinds: [("document", document), ("task", task)]
                .into_iter()
                .filter_map(|(kind, possible)| possible.then_some(kind))
                .collect(),
            driver,
            joins,
            filter: build_document_filter(filter_ast),
            properties: properties.cloned(),
            updated_at_bounds,
        }
    }

    pub(super) fn chat(
        filter_ast: Option<&Expr<ChatLiteral>>,
        properties: Option<&Expr<PropertiesLiteral>>,
        notified: bool,
    ) -> Self {
        let updated_at_bounds = Conjuncts::of(filter_ast)
            .iter()
            .filter_map(|conjunct| match conjunct {
                Expr::Literal(ChatLiteral::UpdatedAt(lit)) => Some(lit.clone()),
                _ => None,
            })
            .collect();
        let pinned = pins_rows(filter_ast, |lit| {
            matches!(lit, ChatLiteral::ChatId(_) | ChatLiteral::ProjectId(_))
        });
        FeedArm::single_kind(
            FeedEntity::Chat,
            build_chat_filter(filter_ast),
            properties,
            notified,
            pinned,
            updated_at_bounds,
        )
    }

    pub(super) fn project(
        filter_ast: Option<&Expr<ProjectLiteral>>,
        properties: Option<&Expr<PropertiesLiteral>>,
        notified: bool,
    ) -> Self {
        let updated_at_bounds = Conjuncts::of(filter_ast)
            .iter()
            .filter_map(|conjunct| match conjunct {
                Expr::Literal(ProjectLiteral::UpdatedAt(lit)) => Some(lit.clone()),
                _ => None,
            })
            .collect();
        let pinned = pins_rows(filter_ast, |lit| {
            matches!(
                lit,
                ProjectLiteral::ProjectId(_) | ProjectLiteral::ProjectIdSelf(_)
            )
        });
        FeedArm::single_kind(
            FeedEntity::Project,
            build_project_filter(filter_ast),
            properties,
            notified,
            pinned,
            updated_at_bounds,
        )
    }

    fn single_kind(
        entity: FeedEntity,
        filter: String,
        properties: Option<&Expr<PropertiesLiteral>>,
        notified: bool,
        pinned: bool,
        updated_at_bounds: Vec<DateLiteral>,
    ) -> Self {
        FeedArm {
            entity,
            kinds: entity.kinds().to_vec(),
            driver: if notified {
                Driver::Notifications
            } else if pinned {
                Driver::Lookup
            } else {
                Driver::Sources
            },
            joins: String::new(),
            filter,
            properties: properties.cloned(),
            updated_at_bounds,
        }
    }

    fn kind_clause(&self, column: &str) -> String {
        if self.kinds.len() == self.entity.kinds().len() {
            return String::new();
        }
        let kinds = self
            .kinds
            .iter()
            .map(|kind| format!("'{kind}'"))
            .collect::<Vec<_>>()
            .join(", ");
        format!(" AND {column} IN ({kinds})")
    }

    /// The constant is cast rather than the column, so the bound stays a range
    /// on the index.
    fn bounds(&self, sort_ts: &str) -> String {
        self.updated_at_bounds
            .iter()
            .map(|lit| {
                let (op, at) = match lit {
                    DateLiteral::GreaterThan(at) => (">", at),
                    DateLiteral::LessThan(at) => ("<", at),
                    DateLiteral::GreaterThanOrEqual(at) => (">=", at),
                    DateLiteral::LessThanOrEqual(at) => ("<=", at),
                };
                format!(
                    "\n                    AND {sort_ts} {op} '{}'::timestamptz::timestamp",
                    at.to_rfc3339()
                )
            })
            .collect()
    }

    /// Keeps rows the user can see through any source, and exposes the item's
    /// `sort_ts` as `acc.sort_ts`. Reads the item's grants, so its cost follows
    /// the item rather than the user's sources.
    fn access_lateral(&self, id_sql: &str) -> String {
        format!(
            r#"
                    CROSS JOIN LATERAL (
                        SELECT g.sort_ts FROM source_items g
                        WHERE g.entity_type = '{item_type}'
                        AND g.entity_id = {id_sql}
                        AND g.sort_ts IS NOT NULL{kinds}
                        AND {USER_HOLDS_GRANT_SOURCE}
                        LIMIT 1
                    ) acc"#,
            item_type = self.entity.item_type(),
            kinds = self.kind_clause("g.kind"),
        )
    }

    /// Keeps rows whose item matches the filter. A lateral rather than a join,
    /// so the filter runs once per row the arm reads, in its order.
    fn filter_lateral(&self, id_sql: &str) -> String {
        if self.filter.is_empty() {
            return String::new();
        }
        format!(
            r#"
                    CROSS JOIN LATERAL (
                        SELECT 1 FROM {table}{joins}
                        WHERE {alias}.id = {id_sql}{filter}
                        LIMIT 1
                    ) f"#,
            table = self.entity.table(),
            joins = self.joins,
            alias = self.entity.alias(),
            filter = self.filter,
        )
    }

    fn properties_clause(&self, id_sql: &str) -> String {
        build_properties_filter(self.properties.as_ref(), id_sql)
    }

    fn unviewed_clause(&self, id_sql: &str) -> String {
        format!(
            r#"
                    AND NOT EXISTS (
                        SELECT 1 FROM "UserHistory" seen
                        WHERE seen."userId" = $1
                        AND seen."itemType" = '{}'
                        AND seen."itemId" = {id_sql}
                    )"#,
            self.entity.item_type()
        )
    }

    fn frecency_clause(&self, id_sql: &str, exclude_frecency: bool) -> String {
        if !exclude_frecency {
            return String::new();
        }
        format!(
            r#"
                    AND NOT EXISTS (
                        SELECT 1 FROM frecency_aggregates fx
                        WHERE fx.user_id = $1
                        AND fx.entity_type = '{}'
                        AND fx.entity_id = {id_sql}
                    )"#,
            self.entity.item_type()
        )
    }

    /// Reads the arm's driving index in `phase` order.
    fn ordered_scan(&self, phase: Phase, exclude_frecency: bool) -> String {
        if self.driver == Driver::Owner {
            self.owner_scan(phase, exclude_frecency)
        } else {
            self.sources_scan(phase, exclude_frecency)
        }
    }

    /// Reads each of the user's sources in index order, then merges them.
    fn sources_scan(&self, phase: Phase, exclude_frecency: bool) -> String {
        let id = "si.entity_id";
        let (sort_ts, cursor, order) = match phase {
            Phase::All | Phase::Unviewed => (
                "max(t.sort_ts)::timestamptz",
                "($4::timestamptz IS NULL OR (si.sort_ts, si.entity_id) < ($4::timestamp, $5))"
                    .to_string(),
                "si.sort_ts DESC, si.entity_id DESC",
            ),
            Phase::Tail => (EPOCH, tail_cursor(id), "si.entity_id DESC"),
        };
        let unviewed = match phase {
            Phase::All => String::new(),
            Phase::Unviewed | Phase::Tail => self.unviewed_clause(id),
        };
        let gate = match phase {
            Phase::Tail => format!("\n                WHERE {TAIL_GATE}"),
            Phase::All | Phase::Unviewed => String::new(),
        };
        format!(
            r#"
                SELECT '{item_type}'::text AS item_type, t.entity_id AS id, {sort_ts} AS sort_ts
                FROM user_source_ids s
                CROSS JOIN (VALUES {kinds}) k(kind)
                CROSS JOIN LATERAL (
                    SELECT si.entity_id, si.sort_ts
                    FROM source_items si{filter}
                    WHERE si.source_id = s.source_id
                    AND si.kind = k.kind
                    AND si.sort_ts IS NOT NULL{bounds}
                    AND {cursor}{unviewed}{frecency}{properties}
                    ORDER BY {order}
                    LIMIT $3
                ) t{gate}
                GROUP BY t.entity_id
"#,
            item_type = self.entity.item_type(),
            kinds = self
                .kinds
                .iter()
                .map(|kind| format!("('{kind}')"))
                .collect::<Vec<_>>()
                .join(", "),
            filter = self.filter_lateral(id),
            bounds = self.bounds("si.sort_ts"),
            frecency = self.frecency_clause(id, exclude_frecency),
            properties = self.properties_clause(id),
        )
    }

    /// Reads the filtered owner's live documents in index order.
    fn owner_scan(&self, phase: Phase, exclude_frecency: bool) -> String {
        let id = "d.id";
        let (sort_ts, cursor, order) = match phase {
            Phase::All | Phase::Unviewed => (
                r#"d."updatedAt"::timestamptz"#,
                r#"($4::timestamptz IS NULL OR (d."updatedAt", d.id) < ($4::timestamp, $5))"#
                    .to_string(),
                r#"d."updatedAt" DESC, d.id DESC"#,
            ),
            Phase::Tail => (EPOCH, tail_cursor(id), "d.id DESC"),
        };
        let unviewed = match phase {
            Phase::All => String::new(),
            Phase::Unviewed | Phase::Tail => self.unviewed_clause(id),
        };
        let gate = match phase {
            Phase::Tail => format!("\n                    AND {TAIL_GATE}"),
            Phase::All | Phase::Unviewed => String::new(),
        };
        format!(
            r#"
                SELECT o.item_type, o.id, o.sort_ts FROM (
                    SELECT 'document'::text AS item_type, d.id, {sort_ts} AS sort_ts
                    FROM "Document" d{joins}{access}
                    WHERE d."deletedAt" IS NULL{filter}{properties}
                    AND {cursor}{unviewed}{frecency}{gate}
                    ORDER BY {order}
                    LIMIT $3
                ) o
"#,
            joins = self.joins,
            access = self.access_lateral(id),
            filter = self.filter,
            properties = self.properties_clause(id),
            frecency = self.frecency_clause(id, exclude_frecency),
        )
    }

    /// Reads the user's history of this entity type, most recent view first.
    fn viewed_scan(&self, exclude_frecency: bool) -> String {
        let id = r#"uh."itemId""#;
        format!(
            r#"
                SELECT v.item_type, v.id, v.sort_ts FROM (
                    SELECT '{item_type}'::text AS item_type, uh."itemId" AS id, uh."updatedAt"::timestamptz AS sort_ts
                    FROM "UserHistory" uh{access}{filter}
                    WHERE uh."userId" = $1
                    AND uh."itemType" = '{item_type}'
                    AND ($4::timestamptz IS NULL OR (uh."updatedAt", uh."itemId") < ($4::timestamp, $5)){frecency}{properties}
                    ORDER BY uh."updatedAt" DESC, uh."itemId" DESC
                    LIMIT $3
                ) v
"#,
            item_type = self.entity.item_type(),
            access = self.access_lateral(id),
            filter = self.filter_lateral(id),
            frecency = self.frecency_clause(id, exclude_frecency),
            properties = self.properties_clause(id),
        )
    }

    /// Lists every notified item the filter keeps.
    fn notifications_scan(&self, sort: FeedSort) -> String {
        let id = "ni.event_item_id";
        format!(
            r#"
                SELECT '{item_type}'::text AS item_type, {id} AS id, {sort_ts} AS sort_ts
                FROM NotificationItems ni{access}{filter}{history}
                WHERE ni.event_item_type = '{item_type}'{properties}
"#,
            item_type = self.entity.item_type(),
            sort_ts = whole_sort_key(sort, "acc.sort_ts"),
            access = self.access_lateral(id),
            filter = self.filter_lateral(id),
            history = self.history_join(sort, id),
            properties = self.properties_clause(id),
        )
    }

    /// Lists every live item the filter keeps, found through the item table's
    /// indexes.
    fn lookup_scan(&self, sort: FeedSort) -> String {
        let alias = self.entity.alias();
        let id = format!("{alias}.id");
        format!(
            r#"
                SELECT '{item_type}'::text AS item_type, {id} AS id, {sort_ts} AS sort_ts
                FROM {table}{joins}{access}{history}
                WHERE {alias}."deletedAt" IS NULL{filter}{properties}
"#,
            item_type = self.entity.item_type(),
            sort_ts = whole_sort_key(sort, &format!(r#"{alias}."updatedAt""#)),
            table = self.entity.table(),
            joins = self.joins,
            access = self.access_lateral(&id),
            history = self.history_join(sort, &id),
            filter = self.filter,
            properties = self.properties_clause(&id),
        )
    }

    /// Exposes the user's view of each item as `uh`, for the sorts that read it.
    fn history_join(&self, sort: FeedSort, id_sql: &str) -> String {
        match sort {
            FeedSort::UpdatedAt => String::new(),
            FeedSort::ViewedUpdated | FeedSort::ViewedAt => format!(
                r#"
                    LEFT JOIN "UserHistory" uh
                        ON uh."userId" = $1
                        AND uh."itemType" = '{}'
                        AND uh."itemId" = {id_sql}"#,
                self.entity.item_type()
            ),
        }
    }
}

/// The sort key of an arm that sorts its items whole, from the item's
/// `"updatedAt"` and `history_join`.
fn whole_sort_key(sort: FeedSort, updated_at: &str) -> String {
    match sort {
        FeedSort::UpdatedAt => format!("{updated_at}::timestamptz"),
        FeedSort::ViewedUpdated => {
            format!(r#"COALESCE(uh."updatedAt", {updated_at})::timestamptz"#)
        }
        FeedSort::ViewedAt => {
            r#"COALESCE(uh."updatedAt", '1970-01-01 00:00:00'::timestamp)::timestamptz"#.to_string()
        }
    }
}

/// Whether every row `filter_ast` keeps must match a literal `pins` accepts.
fn pins_rows<T: Clone>(filter_ast: Option<&Expr<T>>, pins: fn(&T) -> bool) -> bool {
    filter_ast.is_some_and(|expr| {
        expr.collapse_frames(|frame| match frame {
            ExprFrame::And(a, b) => a || b,
            ExprFrame::Or(a, b) => a && b,
            ExprFrame::Not(_) => false,
            ExprFrame::Literal(lit) => pins(&lit),
        })
    })
}

/// Under `ViewedAt` never-viewed items sort below every viewed one, so the
/// tail only runs when the viewed items after the cursor cannot fill the page.
const TAIL_GATE: &str = "(SELECT count(*) FROM ViewedItems vi WHERE vi.sort_ts > '1970-01-01 00:00:00'::timestamp::timestamptz) < $3";

fn tail_cursor(id_sql: &str) -> String {
    format!("($4::timestamptz IS NULL OR ({EPOCH}, {id_sql}) < ($4::timestamptz, $5))")
}

/// The conjuncts a filter requires of every row, after `NOT` is pushed down to
/// the literals.
struct Conjuncts<T>(Option<Expr<T>>);

impl<T: Clone> Conjuncts<T> {
    fn of(expr: Option<&Expr<T>>) -> Self {
        Conjuncts(expr.map(|expr| push_not_inward(expr, false)))
    }

    fn iter(&self) -> impl Iterator<Item = &Expr<T>> {
        fn walk<'a, T>(expr: &'a Expr<T>, out: &mut Vec<&'a Expr<T>>) {
            match expr {
                Expr::And(a, b) => {
                    walk(a, out);
                    walk(b, out);
                }
                other => out.push(other),
            }
        }
        let mut out = Vec::new();
        if let Some(expr) = &self.0 {
            walk(expr, &mut out);
        }
        out.into_iter()
    }
}

/// The `TopItems` members for documents, chats and projects.
pub(super) struct Feed {
    arms: Vec<FeedArm>,
    sort: FeedSort,
    exclude_frecency: bool,
}

impl Feed {
    /// `None` for `CreatedAt`, which `source_items` cannot order.
    pub(super) fn new(
        sort: SimpleSortMethod,
        exclude_frecency: bool,
        arms: impl IntoIterator<Item = FeedArm>,
    ) -> Option<Self> {
        Some(Feed {
            arms: arms
                .into_iter()
                .filter(|arm| !arm.kinds.is_empty())
                .collect(),
            sort: FeedSort::of(sort)?,
            exclude_frecency,
        })
    }

    /// Under `ViewedAt`, the arms whose viewed items go in `ViewedItems`.
    fn viewed_items_arms(&self) -> impl Iterator<Item = &FeedArm> {
        let viewed_at = self.sort == FeedSort::ViewedAt;
        self.arms
            .iter()
            .filter(move |arm| viewed_at && arm.driver.reads_in_order())
    }

    /// Pushes `ViewedItems`, which the never-viewed tails read to decide
    /// whether they run.
    pub(super) fn push_ctes(&self, builder: &mut QueryBuilder<'_, Postgres>) {
        let mut arms = self.viewed_items_arms().peekable();
        if arms.peek().is_none() {
            return;
        }
        builder.push("ViewedItems AS MATERIALIZED (");
        let mut needs_separator = false;
        for arm in arms {
            push_union_separator(builder, &mut needs_separator);
            builder.push(arm.viewed_scan(self.exclude_frecency));
        }
        builder.push("), ");
    }

    pub(super) fn push_members(
        &self,
        builder: &mut QueryBuilder<'_, Postgres>,
        needs_separator: &mut bool,
    ) {
        let mut push = |sql: String| {
            push_union_separator(builder, needs_separator);
            builder.push(sql);
        };
        if self.viewed_items_arms().next().is_some() {
            push(
                "\n                SELECT vi.item_type, vi.id, vi.sort_ts FROM ViewedItems vi\n"
                    .to_string(),
            );
        }
        for arm in &self.arms {
            match (arm.driver, self.sort) {
                (Driver::Notifications, sort) => push(arm.notifications_scan(sort)),
                (Driver::Lookup, sort) => push(arm.lookup_scan(sort)),
                (Driver::Sources | Driver::Owner, FeedSort::UpdatedAt) => {
                    push(arm.ordered_scan(Phase::All, self.exclude_frecency))
                }
                (Driver::Sources | Driver::Owner, FeedSort::ViewedUpdated) => {
                    push(arm.viewed_scan(self.exclude_frecency));
                    push(arm.ordered_scan(Phase::Unviewed, self.exclude_frecency));
                }
                // The viewed items come from `ViewedItems`.
                (Driver::Sources | Driver::Owner, FeedSort::ViewedAt) => {
                    push(arm.ordered_scan(Phase::Tail, self.exclude_frecency))
                }
            }
        }
    }
}
