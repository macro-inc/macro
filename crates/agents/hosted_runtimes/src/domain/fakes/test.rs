use super::*;

#[tokio::test]
async fn scripted_process_answers_its_stdin_and_exits_with_the_scripted_code() {
    let mut process = scripted_process::<FakeError>(|stdin| {
        assert_eq!(stdin, b"{\"command\":\"status\",\"agent\":\"claude\"}\n");
        (
            b"{\"result\":\"signed_out\",\"agent\":\"claude\"}\n".to_vec(),
            0,
        )
    });

    process
        .stdin
        .write_all(b"{\"command\":\"status\",\"agent\":\"claude\"}\n")
        .await
        .unwrap();
    process.stdin.shutdown().await.unwrap();
    let mut stdout = String::new();
    process.stdout.read_to_string(&mut stdout).await.unwrap();

    assert_eq!(stdout, "{\"result\":\"signed_out\",\"agent\":\"claude\"}\n");
    assert_eq!(process.exit.await.unwrap(), 0);
}
