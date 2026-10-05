use super::*;

#[tokio::test]
async fn describe_needs_a_view_receipt() {
    let (context, calls) = context(FakeAccess::denying());
    let error = DescribeDatabase {
        database_id: DATABASE_ID,
        include_editing_metadata: true,
    }
    .call(ServiceContext(context), request_context())
    .await
    .expect_err("no access means no schema");

    assert!(
        error
            .description
            .contains("does not have permission to read"),
        "{}",
        error.description
    );
    assert_eq!(
        calls.lock().unwrap().described,
        0,
        "the service must not be reached without a receipt"
    );
}

#[test]
fn column_types_round_trip_through_the_property_system() {
    for column_type in [
        ColumnType::Text,
        ColumnType::Number,
        ColumnType::Boolean,
        ColumnType::Date,
        ColumnType::Link,
        ColumnType::Select,
        ColumnType::SelectNumber,
        ColumnType::Tag,
        ColumnType::Entity,
    ] {
        let stored: DataType = column_type.into();
        assert_eq!(
            ColumnType::from(stored),
            column_type,
            "{column_type:?} did not round trip"
        );
    }
}
