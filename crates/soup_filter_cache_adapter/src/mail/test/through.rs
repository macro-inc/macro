use super::*;

fn key(n: u128) -> String {
    format!("{TYPE}:{}", id(n))
}

/// A thread in the viewer's first inbox, whatever `row` would place it in.
fn readable(n: u128) -> Value {
    let mut row = row(n);
    row["linkId"] = json!(id(1000));
    row["ownerId"] = json!(VIEWER);
    row
}

/// The same thread moved to an inbox the viewer cannot read, so it leaves Mail.
fn unreadable(n: u128) -> Value {
    let mut row = row(n);
    row["linkId"] = json!(id(9999));
    row["ownerId"] = json!("macro|other@example.com");
    row
}

async fn store<S: Storage>(engine: &mut Engine<S>, rows: Vec<Value>) {
    let data = json!({"user":{"id":VIEWER,"emailLinks":[{"id":id(1000)},{"id":id(1001)}],"soup":{"items":rows}}});
    write(engine, QUERY, &data).await;
}

async fn through<S: PredicateIndexStorage>(
    engine: &mut Engine<S>,
    generation: &str,
    through: &str,
) -> PageResult {
    through_at_least(engine, generation, through, 10).await
}

async fn through_at_least<S: PredicateIndexStorage>(
    engine: &mut Engine<S>,
    generation: &str,
    through: &str,
    fewest: u16,
) -> PageResult {
    page(
        engine,
        generation,
        filters(),
        "UPDATED_AT",
        "DESC",
        fewest,
        PageRequest {
            view: "ALL".into(),
            cursor: None,
            through: Some(through.into()),
        },
    )
    .await
    .unwrap()
}

/// Two loaded pages and the position of their last row.
async fn loaded<S: PredicateIndexStorage>(engine: &mut Engine<S>) -> (Vec<String>, String) {
    let PageResult::MailPage {
        mut keys,
        next_cursor: Some(cursor),
        ..
    } = read(engine, filters(), "ALL", None).await
    else {
        panic!("first page")
    };
    let PageResult::MailPage {
        keys: more,
        end_cursor: Some(edge),
        ..
    } = read(engine, filters(), "ALL", Some(cursor)).await
    else {
        panic!("second page")
    };
    keys.extend(more);
    (keys, edge)
}

async fn window_edge<S: PredicateIndexStorage>(storage: S) {
    let mut engine = Engine::new(storage);
    write(&mut engine, QUERY, &seed()).await;
    let all = all_keys(&mut engine, filters(), "ALL").await;
    let (shown, edge) = loaded(&mut engine).await;
    assert_eq!(shown, all[..20]);

    let PageResult::MailPage {
        keys,
        next_cursor,
        end_cursor,
        ..
    } = through(&mut engine, "generation", &edge).await
    else {
        panic!("window")
    };
    assert_eq!(keys, shown, "reads both pages back in one call");
    assert_eq!(end_cursor.as_deref(), Some(edge.as_str()));
    assert_eq!(next_cursor, end_cursor, "rows remain past the window");
    let PageResult::MailPage { keys, .. } =
        through_at_least(&mut engine, "generation", &edge, 30).await
    else {
        panic!("a position from a 10-row page reads at another size")
    };
    assert_eq!(keys, all[..30], "`limit` is the fewest rows");

    store(&mut engine, vec![readable(80)]).await;
    let PageResult::MailPage { keys, .. } = through(&mut engine, "generation", &edge).await else {
        panic!("window")
    };
    assert_eq!(keys[0], key(80));
    assert_eq!(
        keys[1..],
        shown,
        "a new row above the window keeps its last row"
    );

    store(&mut engine, vec![unreadable(66)]).await;
    let PageResult::MailPage { keys, .. } = through(&mut engine, "generation", &edge).await else {
        panic!("window")
    };
    assert!(!keys.contains(&key(66)));
    assert_eq!(
        keys.last(),
        shown.last(),
        "a removed row above the window pulls nothing up from below"
    );

    let last = shown.last().unwrap().clone();
    let n = uuid::Uuid::parse_str(last.split_once(':').unwrap().1)
        .unwrap()
        .as_u128();
    store(&mut engine, vec![unreadable(n)]).await;
    let PageResult::MailPage {
        keys, next_cursor, ..
    } = through(&mut engine, "generation", &edge).await
    else {
        panic!("a position outlives its row")
    };
    assert_eq!(keys.last(), shown.get(shown.len() - 2));
    assert!(next_cursor.is_some());

    assert!(matches!(
        through(&mut engine, "other-generation", &edge).await,
        PageResult::StaleCursor { .. }
    ));
    let both = page(
        &mut engine,
        "generation",
        filters(),
        "UPDATED_AT",
        "DESC",
        10,
        PageRequest {
            view: "ALL".into(),
            cursor: Some(edge.clone()),
            through: Some(edge),
        },
    )
    .await;
    assert!(both.is_err(), "a cursor and a position are exclusive");
}

#[test]
fn memory_window_keeps_its_last_row() {
    pollster::block_on(window_edge(InMemoryStorage::new()))
}

#[test]
fn turso_window_keeps_its_last_row() {
    pollster::block_on(window_edge(
        cache_turso::TursoStorage::open_in_memory("mail-through-test").unwrap(),
    ))
}

#[test]
fn a_short_window_still_fills_one_page() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        write(&mut engine, QUERY, &seed()).await;
        let all = all_keys(&mut engine, filters(), "ALL").await;
        let PageResult::MailPage {
            end_cursor: Some(edge),
            ..
        } = read(&mut engine, filters(), "ALL", None).await
        else {
            panic!("first page")
        };
        let first = uuid::Uuid::parse_str(all[0].split_once(':').unwrap().1)
            .unwrap()
            .as_u128();
        store(&mut engine, vec![unreadable(first)]).await;
        let PageResult::MailPage { keys, .. } = through(&mut engine, "generation", &edge).await
        else {
            panic!("window")
        };
        assert_eq!(keys, all[1..11]);
    });
}

#[test]
fn a_window_spans_several_index_pages() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        store(&mut engine, (1..=1_100).map(readable).collect()).await;
        let all = all_keys(&mut engine, filters(), "ALL").await;
        assert!(all.len() > 1_000);
        let mut cursor = None;
        let mut edge = None;
        for _ in 0..100 {
            let PageResult::MailPage {
                next_cursor,
                end_cursor,
                ..
            } = read(&mut engine, filters(), "ALL", cursor).await
            else {
                panic!("page")
            };
            cursor = next_cursor;
            edge = end_cursor;
        }
        let edge = edge.unwrap();
        let PageResult::MailPage {
            keys, next_cursor, ..
        } = through(&mut engine, "generation", &edge).await
        else {
            panic!("window")
        };
        assert_eq!(keys, all[..1_000]);
        assert!(next_cursor.is_some());
        let PageResult::MailPage { keys, .. } =
            through_at_least(&mut engine, "generation", &edge, 1_050).await
        else {
            panic!("window")
        };
        assert_eq!(keys, all[..1_050], "fewest rows past one index page");
    });
}
