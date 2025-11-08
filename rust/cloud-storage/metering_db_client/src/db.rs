use anyhow::Result;
use models_metering::{CreateUsageRecordRequest, Usage, UsageQuery, UsageReport};
use sqlx::PgPool;

#[derive(Debug, Clone)]
pub struct MeteringDb {
    pool: PgPool,
}

impl MeteringDb {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn create_usage_record(&self, request: CreateUsageRecordRequest) -> Result<Usage> {
        let (provider, model) = request.model.to_provider_model_string();
        let record = sqlx::query_as!(
            Usage,
            r#"
INSERT INTO usage_records (
   used_open_router, provider, model, usage,  user_id, service_name, operation_type,  input_tokens, output_tokens
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING id, used_open_router, provider, model, usage, user_id, service_name, operation_type, input_tokens, output_tokens,  created_at
            "#,
            request.used_open_router,
            provider,
            model,
            request.usage,
            request.user_id,
            request.service_name,
            request.operation_type,
            request.input_tokens,
            request.output_tokens,
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(record)
    }

    pub async fn get_usage_records(&self, query: UsageQuery) -> Result<UsageReport> {
        let limit = query.limit.unwrap_or(100).min(1000);
        let offset = query.offset.unwrap_or(0);

        // Build the base query with dynamic where conditions
        let mut query_builder = sqlx::QueryBuilder::new(
            "SELECT id,  used_open_router, provider, model, usage, user_id, service_name, operation_type, input_tokens, output_tokens, created_at FROM usage_records",
        );
        let mut count_builder = sqlx::QueryBuilder::new("SELECT COUNT(*) FROM usage_records");
        let mut totals_builder = sqlx::QueryBuilder::new(
            "SELECT COALESCE(SUM(input_tokens), 0) as total_input_tokens, COALESCE(SUM(output_tokens), 0) as total_output_tokens FROM usage_records",
        );

        if query.user_id.is_some()
            || query.service_name.is_some()
            || query.start_date.is_some()
            || query.end_date.is_some()
        {
            query_builder.push(" WHERE ");
            count_builder.push(" WHERE ");
            totals_builder.push(" WHERE ");
        }

        let mut first_condition = true;

        if let Some(user_id) = &query.user_id {
            if !first_condition {
                query_builder.push(" AND ");
                count_builder.push(" AND ");
                totals_builder.push(" AND ");
            }
            query_builder.push("user_id = ").push_bind(user_id);
            count_builder.push("user_id = ").push_bind(user_id);
            totals_builder.push("user_id = ").push_bind(user_id);
            first_condition = false;
        }

        if let Some(service_name) = &query.service_name {
            if !first_condition {
                query_builder.push(" AND ");
                count_builder.push(" AND ");
                totals_builder.push(" AND ");
            }
            query_builder
                .push("service_name = ")
                .push_bind(service_name);
            count_builder
                .push("service_name = ")
                .push_bind(service_name);
            totals_builder
                .push("service_name = ")
                .push_bind(service_name);
            first_condition = false;
        }

        if let Some(start_date) = query.start_date {
            if !first_condition {
                query_builder.push(" AND ");
                count_builder.push(" AND ");
                totals_builder.push(" AND ");
            }
            query_builder.push("created_at >= ").push_bind(start_date);
            count_builder.push("created_at >= ").push_bind(start_date);
            totals_builder.push("created_at >= ").push_bind(start_date);
            first_condition = false;
        }

        if let Some(end_date) = query.end_date {
            if !first_condition {
                query_builder.push(" AND ");
                count_builder.push(" AND ");
                totals_builder.push(" AND ");
            }
            query_builder.push("created_at <= ").push_bind(end_date);
            count_builder.push("created_at <= ").push_bind(end_date);
            totals_builder.push("created_at <= ").push_bind(end_date);
        }

        // Get total count
        let total_count: i64 = count_builder
            .build_query_scalar()
            .fetch_one(&self.pool)
            .await?;

        // Get totals
        let totals: (i64, i64) = totals_builder
            .build_query_as()
            .fetch_one(&self.pool)
            .await?;

        // Get records with pagination
        query_builder
            .push(" ORDER BY created_at DESC LIMIT ")
            .push_bind(limit);
        query_builder.push(" OFFSET ").push_bind(offset);

        let records = query_builder
            .build_query_as::<Usage>()
            .fetch_all(&self.pool)
            .await?;

        Ok(UsageReport {
            records,
            total_count,
            total_input_tokens: totals.0,
            total_output_tokens: totals.1,
        })
    }
}
