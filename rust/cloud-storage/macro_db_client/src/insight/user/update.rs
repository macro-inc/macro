use super::create_insights;
use anyhow::Result;
use chrono::Utc;
use model::insight_context::UserInsightRecord;
use sqlx::Executor;
use sqlx::Pool;
use sqlx::postgres::Postgres;

#[tracing::instrument(skip(db))]
pub async fn update_insights<'e, E>(
    db: E,
    user_id: &str,
    insights: Vec<UserInsightRecord>,
) -> Result<Vec<String>>
where
    E: Executor<'e, Database = Postgres>,
{
    if insights.iter().any(|insight| insight.id.is_none()) {
        return Err(anyhow::anyhow!("expected all updates to have ids"));
    }

    let now = Utc::now().naive_utc();
    let (id, c, g, created, s, e, confidence, source) = insights
        .into_iter()
        .map(|i| {
            (
                i.id.unwrap(),
                i.content,
                i.generated,
                i.created_at.naive_utc(),
                i.span_start.map(|t| t.naive_utc()),
                i.span_end.map(|t| t.naive_utc()),
                i.confidence,
                i.source.to_string(),
            )
        })
        .collect::<(
            Vec<_>,
            Vec<_>,
            Vec<_>,
            Vec<_>,
            Vec<_>,
            Vec<_>,
            Vec<_>,
            Vec<_>,
        )>();

    let records = sqlx::query!(
        r#"
      UPDATE "UserInsights" ui
      SET
        content = d.content,
        generated = d.generated,
        "updatedAt" = $10,
        "createdAt" = d.created_at,
        "spanStart" = d.span_start,
        "spanEnd" = d.span_end,
        source = d.source,
        confidence = d.confidence
    FROM (
        SELECT 
             UNNEST($1::TEXT[]) as id,  
             UNNEST($2::TEXT[]) as content,
             UNNEST($3::BOOLEAN[]) as generated,
             UNNEST($4::TIMESTAMP[]) as created_at,
             UNNEST($5::TIMESTAMP[]) as span_start,
             UNNEST($6::TIMESTAMP[]) as span_end,
             UNNEST($7::INT[]) as confidence,
             UNNEST($8::TEXT[]) as source
      ) AS d
    WHERE 
        ui.id = d.id 
    AND 
        ui."userId" = $9
    RETURNING
        ui.id
    "#,
        &id,
        &c,
        &g,
        &created,
        s.as_slice() as _,
        e.as_slice() as _,
        confidence.as_slice() as _,
        &source,
        user_id,
        now
    )
    .fetch_all(db)
    .await?;

    let updated_ids = records.into_iter().map(|rec| rec.id).collect();

    Ok(updated_ids)
}

#[tracing::instrument(skip(db))]
pub async fn replace_insights(
    db: &Pool<Postgres>,
    ids: &[String],
    insights: &Vec<UserInsightRecord>,
    user_id: &str,
) -> Result<(), sqlx::Error> {
    let mut tsx = db.begin().await?;
    sqlx::query!(
        r#"
                DELETE FROM
                    "UserInsights"
                WHERE
                    id = ANY($1)
            "#,
        ids
    )
    .execute(&mut *tsx)
    .await?;

    create_insights(&mut *tsx, insights, user_id).await?;

    tsx.commit().await?;
    Ok(())
}
