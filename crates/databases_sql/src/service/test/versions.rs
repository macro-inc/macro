use super::*;

fn updated() -> OpResult {
    OpResult::Rows {
        table: GUESTS,
        table_version: TableVersion(3),
        change: RowsResult::Updated { affected: 1 },
    }
}

#[tokio::test]
async fn guarded_sql_writes_refuse_a_change_after_the_catalog_read() {
    let statements = [
        (
            format!("UPDATE Offsite.Guests SET Name = 'Stale' WHERE row_id = '{MARIA}'"),
            updated(),
        ),
        (
            format!("DELETE FROM Offsite.Guests WHERE row_id = '{MARIA}'"),
            OpResult::Rows {
                table: GUESTS,
                table_version: TableVersion(3),
                change: RowsResult::Deleted { affected: 1 },
            },
        ),
        (
            "INSERT INTO Offsite.Guests (Name) VALUES ('New guest')".into(),
            OpResult::Rows {
                table: GUESTS,
                table_version: TableVersion(3),
                change: RowsResult::Inserted {
                    rows: vec![RowId::new()],
                },
            },
        ),
        (
            "ALTER TABLE Offsite.Guests ALTER COLUMN Status TYPE text".into(),
            OpResult::Column {
                table: GUESTS,
                column: STATUS_COLUMN,
                table_version: TableVersion(3),
                change: ColumnResult::TypeChanged,
            },
        ),
    ];
    for (statement, answer) in statements {
        let world = world();
        {
            let mut state = world.lock().unwrap();
            state.versions_before_apply.insert(GUESTS, TableVersion(2));
            state.op_answers.push_back(Ok(vec![answer]));
        }
        let error = sql(&world)
            .execute(
                agent_for(OWNER),
                SqlRequest {
                    sql: statement.clone(),
                    scope: Some(OFFSITE),
                    base_versions: HashMap::from([(GUESTS, TableVersion(1))]),
                },
            )
            .await
            .expect_err("the guarded write must preserve the intervening edit");
        assert!(
            matches!(error, SqlError::VersionConflict { table_id } if table_id == GUESTS),
            "{statement}: {error:?}"
        );
        let state = world.lock().unwrap();
        assert!(state.applied.is_empty(), "{statement}");
        assert_eq!(state.databases[0].tables[0].table.version, TableVersion(2));
    }
}

#[tokio::test]
async fn sql_guards_only_the_table_it_writes() {
    let world = world();
    world
        .lock()
        .unwrap()
        .op_answers
        .push_back(Ok(vec![updated()]));
    sql(&world)
        .execute(
            agent_for(OWNER),
            SqlRequest {
                sql: format!("UPDATE Offsite.Guests SET Name = 'Updated' WHERE row_id = '{MARIA}'"),
                scope: Some(OFFSITE),
                base_versions: HashMap::from([
                    (GUESTS, TableVersion(1)),
                    (HALLS, TableVersion(99)),
                ]),
            },
        )
        .await
        .expect("versions of tables this statement does not write are ignored");
    let state = world.lock().unwrap();
    assert_eq!(state.applied.len(), 1);
    assert_eq!(
        state.guarded,
        vec![HashMap::from([(GUESTS, TableVersion(1))])]
    );
}

#[tokio::test]
async fn a_write_without_its_table_version_remains_a_blind_edit() {
    let world = world();
    {
        let mut state = world.lock().unwrap();
        state.versions_before_apply.insert(GUESTS, TableVersion(2));
        state.op_answers.push_back(Ok(vec![updated()]));
    }
    let outcome = sql(&world)
        .execute(
            agent_for(OWNER),
            SqlRequest {
                sql: format!("UPDATE Offsite.Guests SET Name = 'Updated' WHERE row_id = '{MARIA}'"),
                scope: Some(OFFSITE),
                base_versions: HashMap::from([(HALLS, TableVersion(99))]),
            },
        )
        .await
        .expect("an omitted version keeps intentional last-write-wins behavior");
    assert_eq!(outcome.changes_applied, 1);
    let state = world.lock().unwrap();
    assert_eq!(state.applied.len(), 1);
    assert_eq!(state.guarded, vec![HashMap::new()]);
}
