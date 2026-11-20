use serde_json::{Value, json};

use crate::{CapsolverEmulator, Outcome};

async fn post(emulator: &CapsolverEmulator, method: &str, body: Value) -> (u16, Value) {
    let response = reqwest::Client::new()
        .post(format!("{}/{method}", emulator.base_url()))
        .json(&body)
        .send()
        .await
        .unwrap();
    let status = response.status().as_u16();
    (status, response.json().await.unwrap())
}

async fn create(emulator: &CapsolverEmulator, task_type: &str, site_key: &str) -> (u16, Value) {
    post(
        emulator,
        "createTask",
        json!({
            "clientKey": "key",
            "task": { "type": task_type, "websiteURL": "https://example.com/login", "websiteKey": site_key },
        }),
    )
    .await
}

async fn result(emulator: &CapsolverEmulator, task_id: &str) -> (u16, Value) {
    post(
        emulator,
        "getTaskResult",
        json!({ "clientKey": "key", "taskId": task_id }),
    )
    .await
}

#[tokio::test]
async fn a_recaptcha_task_is_ready_with_a_token_on_its_first_result() {
    let emulator = CapsolverEmulator::start().await.unwrap();

    let (status, created) = create(&emulator, "ReCaptchaV2TaskProxyLess", "site").await;
    assert_eq!(status, 200);
    assert_eq!(created["errorId"], 0);
    let task_id = created["taskId"].as_str().unwrap();

    let (status, polled) = result(&emulator, task_id).await;
    assert_eq!(status, 200);
    assert_eq!(polled["status"], "ready");
    assert_eq!(
        polled["solution"]["gRecaptchaResponse"],
        format!("emulated-token-{task_id}")
    );
    assert_eq!(emulator.polls(task_id), Some(1));
    let tasks = emulator.created_tasks();
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].client_key, "key");
    assert_eq!(tasks[0].task["websiteKey"], "site");
}

#[tokio::test]
async fn a_turnstile_task_answers_a_turnstile_token_after_processing() {
    let emulator = CapsolverEmulator::start().await.unwrap();
    emulator.set_outcome("slow", Outcome::ProcessingThenReady { polls: 2 });

    let (_, created) = create(&emulator, "AntiTurnstileTaskProxyLess", "slow").await;
    let task_id = created["taskId"].as_str().unwrap();

    assert_eq!(result(&emulator, task_id).await.1["status"], "processing");
    assert_eq!(result(&emulator, task_id).await.1["status"], "processing");
    let (_, ready) = result(&emulator, task_id).await;
    assert_eq!(ready["status"], "ready");
    assert_eq!(ready["solution"]["type"], "turnstile");
    assert_eq!(
        ready["solution"]["token"],
        format!("emulated-token-{task_id}")
    );
}

#[tokio::test]
async fn scripted_failures_answer_capsolvers_error_codes() {
    let emulator = CapsolverEmulator::start().await.unwrap();
    emulator.set_outcome("unsolvable", Outcome::Unsolvable);
    emulator.set_outcome("timeout", Outcome::Timeout);
    emulator.set_outcome("limited", Outcome::RateLimited);
    emulator.set_outcome("broke", Outcome::ZeroBalance);

    for (site_key, code) in [
        ("unsolvable", "ERROR_CAPTCHA_UNSOLVABLE"),
        ("timeout", "ERROR_TASK_TIMEOUT"),
    ] {
        let (_, created) = create(&emulator, "ReCaptchaV3TaskProxyLess", site_key).await;
        let (status, polled) = result(&emulator, created["taskId"].as_str().unwrap()).await;
        assert_eq!(status, 400);
        assert_eq!(polled["errorId"], 1);
        assert_eq!(polled["errorCode"], code);
    }
    for (site_key, code) in [
        ("limited", "ERROR_RATE_LIMIT"),
        ("broke", "ERROR_ZERO_BALANCE"),
    ] {
        let (status, created) = create(&emulator, "ReCaptchaV3TaskProxyLess", site_key).await;
        assert_eq!(status, 400);
        assert_eq!(created["errorCode"], code);
    }
    let (_, unsupported) = create(&emulator, "AntiCloudflareTask", "site").await;
    assert_eq!(unsupported["errorCode"], "ERROR_TASK_NOT_SUPPORTED");
    assert_eq!(emulator.created_tasks()[4].task_id, None);
}

#[tokio::test]
async fn the_control_api_scripts_an_outcome() {
    let emulator = CapsolverEmulator::start().await.unwrap();

    let response = reqwest::Client::new()
        .put(format!(
            "{}/_emulator/outcomes/forever",
            emulator.base_url()
        ))
        .json(&json!({ "outcome": "processing" }))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status().as_u16(), 204);

    let (_, created) = create(&emulator, "ReCaptchaV2TaskProxyLess", "forever").await;
    let task_id = created["taskId"].as_str().unwrap();
    assert_eq!(result(&emulator, task_id).await.1["status"], "processing");
    assert_eq!(result(&emulator, task_id).await.1["status"], "processing");

    let tasks: Value = reqwest::get(format!("{}/_emulator/tasks", emulator.base_url()))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(tasks[0]["taskId"], task_id);
    emulator.shutdown().await;
}
