use super::*;

async fn file_names(prefix: &str) -> Vec<String> {
    let script = Function::new_with_args(
        "prefix",
        "return (async () => {
          const names = [];
          const root = await navigator.storage.getDirectory();
          for await (const name of root.keys()) if (name.startsWith(prefix)) names.push(name);
          return names.sort();
        })()",
    );
    let names = script
        .call1(&JsValue::UNDEFINED, &JsValue::from_str(prefix))
        .expect("list OPFS")
        .unchecked_into::<Promise>();
    js_sys::Array::from(&JsFuture::from(names).await.expect("list OPFS"))
        .iter()
        .map(|name| name.as_string().expect("file name"))
        .collect()
}

#[wasm_bindgen_test]
async fn a_side_file_outlives_wipes_and_ends_with_its_database() {
    let nonce = js_sys::Date::now() as u64;
    let database = format!("sidecar-{nonce}.db");
    let (wal, side) = (format!("{database}-wal"), format!("{database}-salvage"));
    let owner = OpfsOwner::acquire(&database).await.expect("owner");
    let sidecar = owner.sidecar();
    assert_eq!(sidecar.read().await.expect("no file"), b"");
    assert!(
        file_names(&database).await.is_empty(),
        "reading creates nothing"
    );
    sidecar.remove().await.expect("nothing to remove");

    sidecar.write_tail(0, b"first").await.expect("write");
    sidecar.write_tail(5, b" second").await.expect("append");
    assert_eq!(sidecar.read().await.expect("read"), b"first second");
    sidecar.replace(b"1st").await.expect("replace it all");
    assert_eq!(sidecar.read().await.expect("read"), b"1st");
    sidecar.replace(b"first second").await.expect("grow");
    sidecar.write_tail(5, b"!").await.expect("replace the tail");

    let owner = owner.recovery_wipe().await.expect("recovery wipe");
    let connected = connect_ready(open_ready(owner).await);
    assert_eq!(sidecar.read().await.expect("read while open"), b"first!");
    let owner = connected
        .try_close()
        .expect("close")
        .reset()
        .await
        .expect("reset");
    assert_eq!(sidecar.read().await.expect("read"), b"first!");
    assert_eq!(file_names(&database).await, [&*database, &side, &wal]);

    // Only the holder of the lock may touch it.
    owner.release().await.expect("release");
    for refused in [
        sidecar.read().await.map(drop),
        sidecar.write_tail(0, b"late").await,
        sidecar.replace(b"late").await,
        sidecar.remove().await,
    ] {
        assert_eq!(refused.expect_err("lock").kind(), OpfsErrorKind::Lock);
    }
    let owner = OpfsOwner::acquire(&database).await.expect("next owner");
    assert_eq!(owner.sidecar().read().await.expect("read"), b"first!");
    owner.sidecar().remove().await.expect("remove");
    assert_eq!(file_names(&database).await, [&*database, &wal]);
    owner
        .sidecar()
        .write_tail(0, b"again")
        .await
        .expect("write");
    owner.remove_and_release().await.expect("remove all");
    assert!(file_names(&database).await.is_empty());

    let reserved = OpfsOwner::acquire(&side).await.expect_err("reserved name");
    assert_eq!(reserved.kind(), OpfsErrorKind::InvalidName);
}
