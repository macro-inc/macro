#[derive(sqlx::FromRow, serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "snake_case")]
pub struct NumericID {
    pub id: i64,
}
