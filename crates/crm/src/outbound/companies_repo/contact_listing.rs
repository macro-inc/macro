//! Contact filtering and keyset pagination over viewer-authorized team records.

use chrono::{DateTime, Utc};
use filter_ast::Expr;
use item_filters::ast::crm_contact::CrmContactLiteral;
use sqlx::{Postgres, QueryBuilder};
use uuid::Uuid;

use super::CompaniesRepositoryImpl;
use crate::domain::{
    companies_repo::CrmCompanyListSort,
    contact_listing::{
        CrmContactForSoup, CrmContactListQuery, CrmContactListScope, contact_hidden_requested,
        contact_ids_only,
    },
    model::{CrmContact, CrmError},
};

#[derive(sqlx::FromRow)]
struct ContactRow {
    id: Uuid,
    company_id: Uuid,
    team_id: Uuid,
    company_name: String,
    email: String,
    name: Option<String>,
    hidden: bool,
    first_interaction: DateTime<Utc>,
    last_interaction: DateTime<Utc>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    viewed_at: Option<DateTime<Utc>>,
}

impl CompaniesRepositoryImpl {
    pub(super) async fn query_contacts_for_soup(
        &self,
        scope: CrmContactListScope<'_>,
        viewer_id: &str,
        query: &CrmContactListQuery,
    ) -> Result<Vec<CrmContactForSoup>, CrmError> {
        // Arbitrary boolean filter trees require dynamic SQL. Every value is
        // bound, and all SQL identifiers/operators come from closed Rust enums.
        let mut sql = QueryBuilder::<Postgres>::new(include_str!("contact_listing/candidates.sql"));
        sql.push_bind(viewer_id.to_owned());
        match scope {
            CrmContactListScope::Viewer(user_id) => {
                sql.push(" JOIN team_user tu ON tu.team_id = co.team_id AND tu.user_id = ")
                    .push_bind(user_id.to_owned())
                    .push(" WHERE (NOT (ct.hidden OR co.hidden) OR tu.team_role <> 'member')");
            }
            CrmContactListScope::Team {
                team_id,
                include_hidden,
            } => {
                sql.push(" WHERE co.team_id = ").push_bind(team_id);
                if !include_hidden {
                    sql.push(" AND NOT (ct.hidden OR co.hidden)");
                }
            }
        }
        if !contact_hidden_requested(&query.filter) && !contact_ids_only(&query.filter) {
            sql.push(" AND NOT (ct.hidden OR co.hidden)");
        }
        sql.push(" AND ");
        push_filter(&mut sql, &query.filter);
        sql.push(") SELECT id, company_id, team_id, company_name, email, name, hidden, first_interaction, last_interaction, created_at, updated_at, viewed_at FROM candidates WHERE ");
        sql.push(if contact_ids_only(&query.filter) {
            "TRUE"
        } else {
            "email_rank = 1"
        });
        let sort = match query.sort {
            CrmCompanyListSort::CreatedAt => "first_interaction",
            CrmCompanyListSort::UpdatedAt => "last_interaction",
            CrmCompanyListSort::ViewedAt => "COALESCE(viewed_at, '1970-01-01'::timestamptz)",
            CrmCompanyListSort::ViewedUpdated => "COALESCE(viewed_at, last_interaction)",
        };
        if let Some(cursor) = query.cursor {
            sql.push(" AND (")
                .push(sort)
                .push(", id) ")
                .push(if query.ascending { ">" } else { "<" })
                .push(" (")
                .push_bind(cursor.last_sort_ts)
                .push(", ")
                .push_bind(cursor.last_id)
                .push(")");
        }
        let direction = if query.ascending { " ASC" } else { " DESC" };
        sql.push(" ORDER BY ")
            .push(sort)
            .push(direction)
            .push(", id")
            .push(direction)
            .push(" LIMIT ")
            .push_bind(i64::from(query.limit));
        let rows = sql
            .build_query_as::<ContactRow>()
            .fetch_all(&self.pool)
            .await
            .map_err(|error| CrmError::StorageLayerError(error.into()))?;
        Ok(rows
            .into_iter()
            .map(|row| CrmContactForSoup {
                contact: CrmContact {
                    id: row.id,
                    company_id: row.company_id,
                    email: row.email,
                    name: row.name,
                    hidden: row.hidden,
                    first_interaction: row.first_interaction,
                    last_interaction: row.last_interaction,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                },
                team_id: row.team_id,
                company_name: row.company_name,
                viewed_at: row.viewed_at,
            })
            .collect())
    }
}

fn push_filter(sql: &mut QueryBuilder<'_, Postgres>, filter: &Expr<CrmContactLiteral>) {
    sql.push("(");
    match filter {
        Expr::And(a, b) | Expr::Or(a, b) => {
            push_filter(sql, a);
            sql.push(if matches!(filter, Expr::And(..)) {
                " AND "
            } else {
                " OR "
            });
            push_filter(sql, b);
        }
        Expr::Not(inner) => {
            sql.push("NOT ");
            push_filter(sql, inner);
        }
        Expr::Literal(literal) => match literal {
            CrmContactLiteral::Include => {
                sql.push("TRUE");
            }
            CrmContactLiteral::Id(id) => {
                sql.push("ct.id = ").push_bind(*id);
            }
            CrmContactLiteral::CompanyId(id) => {
                sql.push("ct.company_id = ").push_bind(*id);
            }
            CrmContactLiteral::TeamId(id) => {
                sql.push("co.team_id = ").push_bind(*id);
            }
            CrmContactLiteral::Email(email) => {
                sql.push("LOWER(BTRIM(ct.email)) = ")
                    .push_bind(email.trim().to_lowercase());
            }
            CrmContactLiteral::Search(query) => {
                let query = query.trim().to_lowercase();
                sql.push("STRPOS(LOWER(ct.email), ")
                    .push_bind(query.clone())
                    .push(") > 0 OR STRPOS(LOWER(COALESCE(ct.name, '')), ")
                    .push_bind(query)
                    .push(") > 0");
            }
            CrmContactLiteral::Hidden(hidden) => {
                sql.push("(ct.hidden OR co.hidden) = ").push_bind(*hidden);
            }
        },
    }
    sql.push(")");
}
