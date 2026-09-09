use super::*;

#[tokio::test]
async fn redis_directory_shares_owners_and_retirement_cannot_be_undone_by_a_late_heartbeat() {
    let url = crate::config::RedisUrl::new().expect("REDIS_URL for local tests");
    let namespace = format!("test-{}", macro_uuid::generate_uuid_v7());
    let a = RedisDirectory::new(url.as_ref(), &namespace).unwrap();
    let b = RedisDirectory::new(url.as_ref(), &namespace).unwrap();
    let owner = Owner {
        user: "alice".into(),
        process: "old".into(),
        address: "127.0.0.1:1234".parse().unwrap(),
    };
    a.heartbeat("old").await.unwrap();
    a.register("session", &owner).await.unwrap();
    assert_eq!(b.lookup("session").await.unwrap().unwrap().process, "old");
    a.retire("old").await.unwrap();
    assert!(a.heartbeat("old").await.is_err());
    assert!(b.lookup("session").await.unwrap().is_none());
    // A different incarnation at the same address has no claim to this session.
    b.heartbeat("replacement").await.unwrap();
    assert!(b.lookup("session").await.unwrap().is_none());
    b.remove("session").await.unwrap();
    let mut conn = a.connection().await.unwrap();
    let _: () = redis::cmd("DEL")
        .arg(format!("{}:process:old", a.prefix))
        .arg(format!("{}:process:replacement", a.prefix))
        .query_async(&mut conn)
        .await
        .unwrap();
}
