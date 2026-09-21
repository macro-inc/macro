use super::*;
use agent_fold::domain::model_selection::model_selection;

const SELECTED_MODEL: &str = "other-model";

#[tokio::test]
async fn model_change_advertises_the_model_used_by_the_first_prompt() {
    let engine = Arc::new(ScriptedEngine::new(vec![]));
    let (_, initial_config, changed_config) =
        with_agent(Arc::clone(&engine), async |connection, session| {
            let changed = connection
                .send_request(SetSessionConfigOptionRequest::new(
                    session.clone(),
                    MODEL_CONFIG_ID,
                    SELECTED_MODEL,
                ))
                .block_task()
                .await
                .expect("the model change should succeed");
            connection
                .send_request(text_prompt(&session, "first prompt"))
                .block_task()
                .await
                .expect("the first prompt should complete");
            changed.config_options
        })
        .await;

    let initial = model_selection(&initial_config).expect("the initial model is advertised");
    let changed = model_selection(&changed_config)
        .expect("the accepted change must advertise its model to the UI and session projection");
    assert_eq!(changed.current, SELECTED_MODEL);
    assert_eq!(changed.options, initial.options);
    assert_eq!(engine.requests()[0].model, changed.current);
}

#[tokio::test]
async fn resume_advertises_the_current_model_without_resetting_it() {
    let engine = Arc::new(ScriptedEngine::new(vec![]));
    let (_, _, resumed_config) = with_agent(Arc::clone(&engine), async |connection, session| {
        connection
            .send_request(SetSessionConfigOptionRequest::new(
                session.clone(),
                MODEL_CONFIG_ID,
                SELECTED_MODEL,
            ))
            .block_task()
            .await
            .expect("the model change should succeed");
        let resumed = connection
            .send_request(ResumeSessionRequest::new(session.clone(), "/"))
            .block_task()
            .await
            .expect("the session should resume");
        connection
            .send_request(text_prompt(&session, "after resume"))
            .block_task()
            .await
            .expect("the resumed prompt should complete");
        resumed.config_options.unwrap_or_default()
    })
    .await;

    let resumed = model_selection(&resumed_config)
        .expect("resume must report the current model even if earlier metadata was stale");
    assert_eq!(resumed.current, SELECTED_MODEL);
    assert_eq!(engine.requests()[0].model, resumed.current);
}
