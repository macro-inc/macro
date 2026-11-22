use super::*;

#[test]
fn a_job_update_is_logged_as_a_macro_extension_notification() {
    let update = JobUpdatedNotification {
        job_id: "0192f7a0-0000-7000-8000-000000000001".parse().unwrap(),
        title: "Checking routine".into(),
        status: JobStatus::TimedOut,
    };

    assert_eq!(
        serde_json::to_value(update.to_server_message()).unwrap(),
        serde_json::json!({
            "type": "acp",
            "jsonrpc": "2.0",
            "method": "_macro/job_updated",
            "params": {
                "jobId": "0192f7a0-0000-7000-8000-000000000001",
                "title": "Checking routine",
                "status": "timed_out",
            },
        })
    );
}

#[test]
fn the_job_list_escapes_titles() {
    let xml = jobs_context(&[BackgroundJobSummary {
        job_id: "0192f7a0-0000-7000-8000-000000000001".parse().unwrap(),
        title: "Scan <inbox> & \"trash\"".into(),
        status: JobStatus::Running,
        started_at: "2026-11-19T10:00:00Z".into(),
    }]);
    assert_eq!(
        xml,
        "<background_jobs><job id=\"0192f7a0-0000-7000-8000-000000000001\" status=\"running\" started=\"2026-11-19T10:00:00Z\">Scan &lt;inbox&gt; &amp; &quot;trash&quot;</job></background_jobs>"
    );
}
