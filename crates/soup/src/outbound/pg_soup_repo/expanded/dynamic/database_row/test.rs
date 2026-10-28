use super::*;

#[test]
fn include_renders_true_without_removing_other_filters() {
    let table = uuid::Uuid::from_u128(0x7ab00000_0000_0000_0000_000000000002);
    assert_eq!(
        build_database_row_filter(Some(&Expr::and(
            Expr::val(DatabaseRowLiteral::Include),
            Expr::is_not(Expr::val(DatabaseRowLiteral::TableId(table))),
        ))),
        format!(" AND ((TRUE AND NOT (r.table_id = '{table}')))")
    );
}
