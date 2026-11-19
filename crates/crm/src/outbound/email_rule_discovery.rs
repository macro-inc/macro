//! Bounded discovery on the caller's existing PostgreSQL transaction.
use crate::domain::{email_rule_discovery::*, email_rules::EmailInclusionRule, model::CrmError};
use sqlx::PgConnection;
use std::{collections::BTreeMap, time::Instant};
use uuid::Uuid;

/// Injected by composition roots into the email reader; owns no connection pool.
#[derive(Debug, Clone, Copy, Default)]
pub struct PgEmailRuleDiscovery;

#[async_trait::async_trait]
impl EmailRuleDiscoveryService<PgConnection> for PgEmailRuleDiscovery {
    async fn discover(
        &self,
        context: &mut PgConnection,
        request: EmailRuleDiscoveryRequest,
        deadline: Instant,
    ) -> Result<EmailRuleDiscovery, CrmError> {
        let deadline = deadline.min(
            Instant::now()
                + std::time::Duration::from_millis(EmailRuleWorkLimit::RequestDeadline.maximum()),
        );
        discover(
            &mut Reader {
                connection: context,
                deadline,
            },
            request,
            deadline,
        )
        .await
    }
}

struct InputRow {
    link_id: Uuid,
    user_id: Option<String>,
    role: Option<String>,
    revision: Option<i64>,
    kind: Option<String>,
    value: Option<String>,
}

fn inputs(rows: Vec<InputRow>) -> Result<RuleInputs, CrmError> {
    let mut result = RuleInputs {
        contributors: Vec::new(),
        rules: Vec::new(),
    };
    let mut seen = std::collections::HashSet::new();
    let malformed =
        || CrmError::StorageLayerError(anyhow::anyhow!("invalid stored email rule input"));
    for row in rows {
        if let Some(user_id) = row.user_id {
            let sees_hidden = row.role.ok_or_else(malformed)? != "member";
            if seen.insert(row.link_id) {
                result.contributors.push(RuleContributor {
                    link_id: row.link_id,
                    user_id,
                    sees_hidden,
                    revision: row.revision,
                });
            }
        }
        let Some(kind) = row.kind else {
            continue;
        };
        if kind == "contributor" {
            continue;
        }
        let value = row.value.ok_or_else(malformed)?;
        let id = || Uuid::parse_str(&value).map_err(|e| CrmError::StorageLayerError(e.into()));
        let rule = match kind.as_str() {
            "thread" => EmailInclusionRule::Thread { thread_id: id()? },
            "address" => EmailInclusionRule::Address { address: value },
            "contact" => EmailInclusionRule::Contact { contact_id: id()? },
            "domain" => EmailInclusionRule::Domain { domain: value },
            "company" => EmailInclusionRule::Company { company_id: id()? },
            _ => return Err(malformed()),
        };
        result.rules.push(ContributorRule {
            link_id: row.link_id,
            rule,
        });
    }
    Ok(result)
}

struct Reader<'a> {
    connection: &'a mut PgConnection,
    deadline: Instant,
}
fn db_error(error: sqlx::Error) -> CrmError {
    if error
        .as_database_error()
        .is_some_and(|e| e.code().as_deref() == Some("57014"))
    {
        let limit = EmailRuleWorkLimit::RequestDeadline;
        EmailRuleLimitExceeded {
            limit,
            maximum: limit.maximum(),
            observed: limit.maximum(),
        }
        .into()
    } else {
        CrmError::StorageLayerError(error.into())
    }
}
impl Reader<'_> {
    async fn limit_time(&mut self) -> Result<(), CrmError> {
        let remaining = self
            .deadline
            .saturating_duration_since(Instant::now())
            .as_millis();
        if remaining == 0 {
            let limit = EmailRuleWorkLimit::RequestDeadline;
            return Err(EmailRuleLimitExceeded {
                limit,
                maximum: limit.maximum(),
                observed: limit.maximum(),
            }
            .into());
        }
        sqlx::query!(
            "SELECT set_config('statement_timeout', $1, true)",
            format!("{remaining}ms")
        )
        .fetch_one(&mut *self.connection)
        .await
        .map_err(db_error)?;
        Ok(())
    }
}

impl EmailRuleDiscoveryReader for Reader<'_> {
    async fn inputs(
        &mut self,
        request: &EmailRuleDiscoveryRequest,
        contributor_limit: usize,
        rule_limit: usize,
    ) -> Result<RuleInputs, CrmError> {
        self.limit_time().await?;
        if request.proposed.is_none()
            && let Some(links) = &request.links
            && links.len() <= SMALL_CONTRIBUTORS
        {
            // A read already has its selected mailbox IDs. Narrow those by PK
            // before looking up consent, rather than scanning the team's inputs.
            // Empty policies occupy at most one row per link, so this total cap
            // still returns a rule-overflow sentinel without losing a header.
            let rows = sqlx::query_as!(InputRow, r#"
                SELECT l.id AS link_id,l.macro_id AS "user_id?",member.team_role::text AS "role?",
                    c.active_rule_revision AS revision,r.kind AS "kind?",r.value AS "value?"
                FROM unnest($2::uuid[]) selected(id)
                CROSS JOIN LATERAL (SELECT id,macro_id FROM email_links WHERE id=selected.id AND is_primary AND deleting_at IS NULL OFFSET 0)l
                CROSS JOIN LATERAL (SELECT active_rule_revision FROM crm_email_consent WHERE team_id=$1 AND user_id=l.macro_id AND link_id=l.id AND mode='selected' AND selected_enabled OFFSET 0)c
                CROSS JOIN LATERAL (SELECT team_role FROM team_user WHERE team_id=$1 AND user_id=l.macro_id OFFSET 0)member
                LEFT JOIN LATERAL (
                    SELECT 'thread'::text kind,thread_id::text value FROM crm_email_rule_threads WHERE team_id=$1 AND user_id=l.macro_id AND revision=c.active_rule_revision
                    UNION ALL SELECT 'address',address FROM crm_email_rule_addresses WHERE team_id=$1 AND user_id=l.macro_id AND revision=c.active_rule_revision
                    UNION ALL SELECT 'contact',contact_id::text FROM crm_email_rule_contacts WHERE team_id=$1 AND user_id=l.macro_id AND revision=c.active_rule_revision
                    UNION ALL SELECT 'domain',domain FROM crm_email_rule_domains WHERE team_id=$1 AND user_id=l.macro_id AND revision=c.active_rule_revision
                    UNION ALL SELECT 'company',company_id::text FROM crm_email_rule_companies WHERE team_id=$1 AND user_id=l.macro_id AND revision=c.active_rule_revision
                    OFFSET 0
                )r ON TRUE LIMIT $3
            "#,request.team_id,links,(rule_limit+links.len()) as i64)
                .fetch_all(&mut *self.connection).await.map_err(db_error)?;
            return inputs(rows);
        }
        let proposed_user = request.proposed.as_ref().map(|p| p.user_id.as_str());
        let proposed_link = request.proposed.as_ref().map(|p| p.link_id);
        // Headers preserve empty policies. A separate capped arm returns raw
        // selectors without repeating every contributor field per selector.
        // No live source is expanded before the domain chooses its strategy.
        let rows = sqlx::query_as!(InputRow, r#"
            WITH contributors AS MATERIALIZED (
                SELECT * FROM (
                    SELECT l.id AS link_id,c.user_id,member.team_role::text AS role,c.active_rule_revision AS revision
                    FROM crm_email_consent c
                    CROSS JOIN LATERAL (
                        SELECT id FROM email_links WHERE id=c.link_id AND macro_id=c.user_id
                            AND is_primary AND deleting_at IS NULL OFFSET 0
                    )l
                    CROSS JOIN LATERAL (
                        SELECT team_role FROM team_user WHERE team_id=c.team_id AND user_id=c.user_id OFFSET 0
                    )member
                    WHERE c.team_id=$1 AND c.mode='selected' AND c.selected_enabled
                        AND ($2::uuid[] IS NULL OR l.id=ANY($2))
                        AND ($3::text IS NULL OR c.user_id<>$3)
                    UNION ALL
                    SELECT l.id,member.user_id,member.team_role::text,NULL::bigint
                    FROM email_links l JOIN team_user member ON member.user_id=l.macro_id AND member.team_id=$1
                    WHERE l.id=$4 AND l.macro_id=$3 AND l.is_primary AND l.deleting_at IS NULL
                )scoped LIMIT $5
            ), rules AS (
                SELECT cb.link_id,r.kind,r.value FROM contributors cb
                CROSS JOIN LATERAL (
                    SELECT 'thread'::text kind,thread_id::text value FROM crm_email_rule_threads WHERE team_id=$1 AND user_id=cb.user_id AND revision=cb.revision
                    UNION ALL SELECT 'address',address FROM crm_email_rule_addresses WHERE team_id=$1 AND user_id=cb.user_id AND revision=cb.revision
                    UNION ALL SELECT 'contact',contact_id::text FROM crm_email_rule_contacts WHERE team_id=$1 AND user_id=cb.user_id AND revision=cb.revision
                    UNION ALL SELECT 'domain',domain FROM crm_email_rule_domains WHERE team_id=$1 AND user_id=cb.user_id AND revision=cb.revision
                    UNION ALL SELECT 'company',company_id::text FROM crm_email_rule_companies WHERE team_id=$1 AND user_id=cb.user_id AND revision=cb.revision
                    OFFSET 0
                )r
                WHERE cb.revision IS NOT NULL AND (SELECT count(*) FROM contributors)<$5
                LIMIT $6
            )
            SELECT link_id AS "link_id!",user_id AS "user_id?",role AS "role?",revision,
                'contributor'::text AS "kind?",NULL::text AS "value?" FROM contributors
            UNION ALL
            SELECT link_id,NULL,NULL,NULL,kind,value FROM rules
        "#,request.team_id,request.links.as_deref(),proposed_user,proposed_link,
            contributor_limit as i64,rule_limit as i64)
            .fetch_all(&mut *self.connection).await.map_err(db_error)?;
        inputs(rows)
    }

    async fn source_facts(
        &mut self,
        team: Uuid,
        sources: &[RuleSource],
    ) -> Result<Vec<RuleSourceFacts>, CrmError> {
        if sources.is_empty() {
            return Ok(Vec::new());
        }
        self.limit_time().await?;
        let contacts: Vec<_> = sources
            .iter()
            .filter_map(|s| {
                if let RuleSource::Contact(id) = s {
                    Some(*id)
                } else {
                    None
                }
            })
            .collect();
        let companies: Vec<_> = sources
            .iter()
            .filter_map(|s| {
                if let RuleSource::Company(id) = s {
                    Some(*id)
                } else {
                    None
                }
            })
            .collect();
        let rows=sqlx::query!(r#"
            SELECT 'contact'::text AS "kind!", c.id AS "id!",
                (c.team_id=$1 AND (c.company_id IS NULL OR co.team_id=$1)) IS TRUE AS "in_team!",
                (c.hidden OR co.hidden) IS TRUE AS "hidden!"
            FROM unnest($2::uuid[]) source(id)
            CROSS JOIN LATERAL (SELECT id,team_id,hidden,company_id FROM crm_contacts WHERE id=source.id OFFSET 0)c
            LEFT JOIN LATERAL (SELECT team_id,hidden FROM crm_companies WHERE id=c.company_id OFFSET 0)co ON TRUE
            UNION ALL
            SELECT 'company', c.id, c.team_id=$1, c.hidden
            FROM unnest($3::uuid[]) source(id)
            CROSS JOIN LATERAL (SELECT id,team_id,hidden FROM crm_companies WHERE id=source.id OFFSET 0)c
        "#,team,&contacts,&companies).fetch_all(&mut *self.connection).await.map_err(db_error)?;
        Ok(rows
            .into_iter()
            .map(|r| RuleSourceFacts {
                source: if r.kind == "contact" {
                    RuleSource::Contact(r.id)
                } else {
                    RuleSource::Company(r.id)
                },
                in_team: r.in_team,
                hidden: r.hidden,
            })
            .collect())
    }

    async fn source_values(
        &mut self,
        team: Uuid,
        source: RuleSource,
        after: Option<&str>,
        limit: usize,
        bytes: u64,
    ) -> Result<Vec<RuleSourceValue>, CrmError> {
        self.limit_time().await?;
        // Both identifiers are enum-selected, never supplied by the caller.
        let (id, table, parent, column, in_team, normalized) = match source {
            RuleSource::Contact(id) => (
                id,
                "crm_contact_emails",
                "contact_id",
                "email",
                "TRUE",
                "key",
            ),
            RuleSource::Company(id) => (
                id,
                "crm_domains",
                "company_id",
                "domain",
                "team_id=$6",
                "lower(key)",
            ),
        };
        // Parameterized LATERAL is essential under stale custom plans: a simple
        // constant parent comparison can scan and sort the whole source table.
        let continuation = if after.is_some() {
            format!(" AND ({parent},{column})>(source.id,$2)")
        } else {
            String::new()
        };
        let query = format!(
            r#"
            WITH raw AS MATERIALIZED (
                SELECT page.* FROM unnest(ARRAY[$1::uuid]) source(id)
                CROSS JOIN LATERAL (
                    SELECT CASE WHEN octet_length({column})<=$5 THEN {column} END AS key,
                        octet_length({column}) AS bytes, {in_team} AS in_team
                    FROM {table} WHERE {parent}=source.id {continuation}
                        AND $2::text IS NOT DISTINCT FROM $2 AND $6::uuid IS NOT NULL
                    ORDER BY {parent},{column} LIMIT $3 OFFSET 0
                )page
            ), sized AS (
                SELECT *,sum(bytes) OVER(ORDER BY key ROWS UNBOUNDED PRECEDING) running_bytes FROM raw
            ), normalized AS MATERIALIZED (
                SELECT *,CASE WHEN running_bytes<=$4 THEN {normalized} END AS value FROM sized
            ), measured AS (
                SELECT *,greatest(bytes,coalesce(octet_length(value),0)) AS measured_bytes FROM normalized
            ), bounded AS (
                SELECT *,sum(measured_bytes) OVER(ORDER BY key ROWS UNBOUNDED PRECEDING) normalized_bytes FROM measured
            )
            SELECT CASE WHEN normalized_bytes<=$4 THEN key END AS key,
                CASE WHEN normalized_bytes<=$4 AND measured_bytes<=$5 THEN value END AS value,
                measured_bytes::bigint AS bytes,in_team FROM bounded ORDER BY key
        "#
        );
        #[derive(sqlx::FromRow)]
        struct Value {
            key: Option<String>,
            value: Option<String>,
            bytes: i64,
            in_team: bool,
        }
        let rows = sqlx::QueryBuilder::<sqlx::Postgres>::new(query)
            .build_query_as::<Value>()
            .bind(id)
            .bind(after)
            .bind(limit as i64)
            .bind(bytes as i64)
            .bind(EmailRuleWorkLimit::SourceValueBytes.maximum() as i64)
            .bind(team)
            .fetch_all(&mut *self.connection)
            .await
            .map_err(db_error)?;
        Ok(rows
            .into_iter()
            .map(|r| RuleSourceValue {
                key: r.key,
                value: r.value,
                bytes: r.bytes as u64,
                in_team: r.in_team,
            })
            .collect())
    }

    async fn source_first_pages(
        &mut self,
        team: Uuid,
        sources: &[RuleSource],
        limit_per_source: usize,
        bytes: u64,
    ) -> Result<Vec<RuleSourcePage>, CrmError> {
        let mut pages: BTreeMap<_, Vec<RuleSourceValue>> = sources
            .iter()
            .copied()
            .map(|source| (source, Vec::new()))
            .collect();
        for company in [false, true] {
            let ids: Vec<_> = sources
                .iter()
                .filter_map(|source| match (company, source) {
                    (false, RuleSource::Contact(id)) | (true, RuleSource::Company(id)) => Some(*id),
                    _ => None,
                })
                .collect();
            if ids.is_empty() {
                continue;
            }
            self.limit_time().await?;
            let (table, parent, column, in_team, normalized) = if company {
                (
                    "crm_domains",
                    "company_id",
                    "domain",
                    "team_id=$5",
                    "lower(key)",
                )
            } else {
                ("crm_contact_emails", "contact_id", "email", "TRUE", "key")
            };
            // Each source is an ID-first index probe capped before the outer
            // sort/window. At most 128 * 8 raw values enter that work, including
            // duplicates and foreign-team domains. Empty sources keep empty pages.
            let query = format!(
                r#"
                WITH raw AS MATERIALIZED (
                    SELECT source.id AS source_id,page.* FROM unnest($1::uuid[]) source(id)
                    CROSS JOIN LATERAL (
                        SELECT CASE WHEN octet_length({column})<=$4 THEN {column} END AS key,
                            octet_length({column}) AS bytes,{in_team} AS in_team
                        FROM {table} WHERE {parent}=source.id AND $5::uuid IS NOT NULL
                        ORDER BY {parent},{column} LIMIT $2 OFFSET 0
                    )page
                ), sized AS (
                    SELECT *,sum(bytes) OVER(ORDER BY source_id,key ROWS UNBOUNDED PRECEDING) running_bytes FROM raw
                ), normalized AS MATERIALIZED (
                    SELECT *,CASE WHEN running_bytes<=$3 THEN {normalized} END AS value FROM sized
                ), measured AS (
                    SELECT *,greatest(bytes,coalesce(octet_length(value),0)) AS measured_bytes FROM normalized
                ), bounded AS (
                    SELECT *,sum(measured_bytes) OVER(ORDER BY source_id,key ROWS UNBOUNDED PRECEDING) normalized_bytes FROM measured
                )
                SELECT source_id,CASE WHEN normalized_bytes<=$3 THEN key END AS key,
                    CASE WHEN normalized_bytes<=$3 AND measured_bytes<=$4 THEN value END AS value,
                    measured_bytes::bigint AS bytes,in_team FROM bounded ORDER BY source_id,key
            "#
            );
            #[derive(sqlx::FromRow)]
            struct Value {
                source_id: Uuid,
                key: Option<String>,
                value: Option<String>,
                bytes: i64,
                in_team: bool,
            }
            let rows = sqlx::QueryBuilder::<sqlx::Postgres>::new(query)
                .build_query_as::<Value>()
                .bind(ids)
                .bind(limit_per_source as i64)
                .bind(bytes as i64)
                .bind(EmailRuleWorkLimit::SourceValueBytes.maximum() as i64)
                .bind(team)
                .fetch_all(&mut *self.connection)
                .await
                .map_err(db_error)?;
            for row in rows {
                let source = if company {
                    RuleSource::Company(row.source_id)
                } else {
                    RuleSource::Contact(row.source_id)
                };
                pages.entry(source).or_default().push(RuleSourceValue {
                    key: row.key,
                    value: row.value,
                    bytes: row.bytes as u64,
                    in_team: row.in_team,
                });
            }
        }
        Ok(pages
            .into_iter()
            .map(|(source, values)| RuleSourcePage { source, values })
            .collect())
    }

    async fn direct_contacts(
        &mut self,
        pairs: &[(Uuid, &str)],
        limit: usize,
    ) -> Result<Vec<RuleDirectContact>, CrmError> {
        self.limit_time().await?;
        let links: Vec<_> = pairs.iter().map(|(l, _)| *l).collect();
        let addresses: Vec<_> = pairs.iter().map(|(_, a)| *a).collect();
        let rows = sqlx::query!(
            r#"
            SELECT pairs.link_id AS "link_id!", c.id, c.bytes AS "bytes!"
            FROM unnest($1::uuid[],$2::text[]) pairs(link_id,address)
            CROSS JOIN LATERAL (
                SELECT id,octet_length(email_address) AS bytes FROM email_contacts
                WHERE link_id=pairs.link_id AND lower(email_address)=pairs.address LIMIT $3 OFFSET 0
            )c LIMIT $3
        "#,
            &links,
            &addresses as &[&str],
            limit as i64
        )
        .fetch_all(&mut *self.connection)
        .await
        .map_err(db_error)?;
        Ok(rows
            .into_iter()
            .map(|r| RuleDirectContact {
                link_id: r.link_id,
                id: r.id,
                bytes: r.bytes as u64,
            })
            .collect())
    }

    async fn mailbox_contacts(
        &mut self,
        link: Uuid,
        after: Option<&str>,
        limit: usize,
        bytes: u64,
    ) -> Result<Vec<RuleMailboxContact>, CrmError> {
        self.limit_time().await?;
        // Two query shapes keep a keyset continuation indexable with generic plans.
        let continuation = if after.is_some() {
            "AND email_address>$2"
        } else {
            "AND $2::text IS NULL"
        };
        let query = format!(
            r#"
            WITH raw AS MATERIALIZED (
                SELECT page.* FROM unnest(ARRAY[$1::uuid]) mailbox(link_id)
                CROSS JOIN LATERAL (
                    SELECT id,email_address AS key,octet_length(email_address) AS bytes
                    FROM email_contacts WHERE link_id=mailbox.link_id {continuation}
                    ORDER BY link_id,email_address LIMIT $3 OFFSET 0
                ) page
            ), sized AS (
                SELECT *,sum(bytes) OVER(ORDER BY key ROWS UNBOUNDED PRECEDING) running_bytes FROM raw
            ) SELECT id,CASE WHEN running_bytes<=$4 THEN key END AS key,
                CASE WHEN running_bytes<=$4 THEN lower(key) END AS address,
                CASE WHEN running_bytes<=$4 THEN lower(split_part(key,'@',2)) END AS domain,
                bytes::bigint AS bytes FROM sized ORDER BY key
        "#
        );
        #[derive(sqlx::FromRow)]
        struct Contact {
            id: Uuid,
            key: Option<String>,
            address: Option<String>,
            domain: Option<String>,
            bytes: i64,
        }
        let rows = sqlx::QueryBuilder::<sqlx::Postgres>::new(query)
            .build_query_as::<Contact>()
            .bind(link)
            .bind(after)
            .bind(limit as i64)
            .bind(bytes as i64)
            .fetch_all(&mut *self.connection)
            .await
            .map_err(db_error)?;
        Ok(rows
            .into_iter()
            .map(|r| RuleMailboxContact {
                id: r.id,
                key: r.key,
                address: r.address,
                domain: r.domain,
                bytes: r.bytes as u64,
            })
            .collect())
    }

    async fn small_matches(
        &mut self,
        link: Uuid,
        addresses: &[String],
        domains: &[String],
        limit: usize,
        bytes: u64,
        suffix_checks: u64,
    ) -> Result<RuleSmallMatches, CrmError> {
        self.limit_time().await?;
        let row=sqlx::query!(r#"
            WITH raw AS MATERIALIZED (
                SELECT page.* FROM unnest(ARRAY[$1::uuid]) mailbox(link_id)
                CROSS JOIN LATERAL (
                    SELECT id,email_address AS key,octet_length(email_address) AS bytes
                    FROM email_contacts WHERE link_id=mailbox.link_id
                    ORDER BY link_id,email_address LIMIT $4 OFFSET 0
                )page
            ), sized AS (
                SELECT *,sum(bytes) OVER(ORDER BY key ROWS UNBOUNDED PRECEDING) running_bytes FROM raw
            ), normalized AS MATERIALIZED (
                SELECT id,bytes,
                    CASE WHEN running_bytes<=$5 THEN lower(key) END AS address,
                    CASE WHEN running_bytes<=$5 THEN lower(split_part(key,'@',2)) END AS domain
                FROM sized
            ), charged AS (
                SELECT n.*,parts.labels,
                    sum(coalesce(cardinality(parts.labels),0)) OVER(ROWS UNBOUNDED PRECEDING) AS running_suffixes
                FROM normalized n
                CROSS JOIN LATERAL (
                    SELECT CASE WHEN cardinality($3::text[])>0 THEN string_to_array(n.domain,'.') END AS labels OFFSET 0
                )parts
            )
            SELECT count(*) AS "rows!", coalesce(sum(bytes),0)::bigint AS "bytes!",
                coalesce(sum(cardinality(n.labels)),0)::bigint AS "suffix_checks!",
                coalesce(array_agg(n.id) FILTER(WHERE CASE WHEN n.running_suffixes<=$6 THEN
                    (n.address IN (SELECT unnest($2::text[]))) IS TRUE
                    OR EXISTS(SELECT 1 FROM generate_subscripts(n.labels,1) part(i)
                        WHERE (array_to_string(n.labels[part.i:],'.') IN (SELECT unnest($3::text[]))) IS TRUE)
                    ELSE FALSE END
                ), ARRAY[]::uuid[]) AS "ids!"
            FROM charged n
        "#,link,addresses,domains,limit as i64,bytes as i64,suffix_checks as i64).fetch_one(&mut *self.connection).await.map_err(db_error)?;
        Ok(RuleSmallMatches {
            rows: row.rows as u64,
            bytes: row.bytes as u64,
            suffix_checks: row.suffix_checks as u64,
            ids: row.ids,
        })
    }
}

#[cfg(test)]
mod test;
