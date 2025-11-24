use anyhow::Context;
use macro_entrypoint::MacroEntrypoint;
use opensearch_client::{
    OpensearchClient,
    date_format::EpochSeconds,
    upsert::{
        channel_message::UpsertChannelMessageArgs, chat_message::UpsertChatMessageArgs,
        document::UpsertDocumentArgs, email::UpsertEmailArgs, project::UpsertProjectArgs,
    },
};
use uuid::Uuid;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();
    let url = std::env::var("OPENSEARCH_URL").context("OPENSEARCH_URL not set")?;
    let username = std::env::var("OPENSEARCH_USERNAME")?;
    let password = std::env::var("OPENSEARCH_PASSWORD")?;

    let client = OpensearchClient::new(url, username, password)?;

    // Test user IDs array
    let test_users = [
        "user_alice_123",
        "user_bob_456",
        "user_charlie_789",
        "user_diana_012",
        "user_eve_345",
    ];

    // Varied document names for distinct search targets
    let document_names = [
        "Important Technical Architecture Blueprint",
        "Marketing Campaign Strategy (Test keyword for matching: Pineapple)",
        "Database Migration Guide",
        "User Interface Wireframes",
        "Security Audit Report",
    ];

    // Varied project names
    let project_names = [
        "Phoenix Redesign Initiative (Test keyword for matching: Pineapple)",
        "Apollo Data Pipeline",
        "Mercury Authentication System",
        "Venus Content Management",
        "Jupiter Analytics Platform",
    ];

    // Varied chat titles
    let chat_titles = [
        "Code Review Discussion",
        "Feature Planning Session",
        "Bug Triage Meeting (Test keyword for matching: Pineapple)",
        "Architecture Brainstorm",
    ];

    // Varied email subjects
    let email_subjects = [
        "Quarterly Performance Review",
        "Infrastructure Upgrade Notice (Test keyword for matching: Pineapple)",
        "Team Building Event Planning",
    ];

    // Test health
    println!("Testing OpenSearch health...");
    client.health().await?;
    println!("OpenSearch is healthy!");

    let now = chrono::Utc::now().timestamp();

    // Generate sample documents
    println!("Generating sample documents...");
    for i in 1..=5 {
        let doc_args = UpsertDocumentArgs {
            document_id: format!("doc_{}", i),
            node_id: format!("node_{}", i),
            document_name: document_names[(i - 1) % document_names.len()].to_string(),
            file_type: match i % 3 {
                0 => "pdf".to_string(),
                1 => "md".to_string(),
                _ => "docx".to_string(),
            },
            owner_id: test_users[(i - 1) % test_users.len()].to_string(),
            raw_content: if i % 2 == 0 {
                Some(format!(
                    r#"{{"type": "doc", "content": "Raw content for doc {}"}}"#,
                    i
                ))
            } else {
                None
            },
            content: format!(
                "This is the content of sample document {}. It contains important information about topic {} and references related concepts.",
                i,
                match i % 3 {
                    0 => "architecture",
                    1 => "implementation. test keyword: pineapple",
                    _ => "testing",
                }
            ),
            updated_at_seconds: EpochSeconds::new(now + (i as i64) * 60)?,
        };

        client.upsert_document(&doc_args).await?;
        println!("Upserted document {}", i);
    }

    // Generate sample projects
    println!("Generating sample projects...");
    for i in 1..=3 {
        let project_args = UpsertProjectArgs {
            project_id: format!("proj_{}", i),
            user_id: test_users[(i - 1) % test_users.len()].to_string(),
            project_name: project_names[(i - 1) % project_names.len()].to_string(),
            created_at_seconds: EpochSeconds::new(now - (i as i64) * 86400)?,
            updated_at_seconds: EpochSeconds::new(now - (i as i64) * 3600)?,
        };

        client.upsert_project(&project_args).await?;
        println!("Upserted project {}", i);
    }

    // Generate sample channel messages
    println!("Generating sample channel messages...");
    for i in 1..=4 {
        let channel_args = UpsertChannelMessageArgs {
            channel_id: format!("channel_{}", (i % 2) + 1),
            channel_type: "public".to_string(),
            org_id: Some(1),
            message_id: format!("msg_{}", i),
            thread_id: if i > 2 {
                Some("thread_1".to_string())
            } else {
                None
            },
            sender_id: test_users[(i - 1) % test_users.len()].to_string(),
            mentions: if i == 2 {
                vec![test_users[0].to_string(), test_users[2].to_string()]
            } else {
                vec![]
            },
            content: format!(
                "This is channel message {}. Hey everyone, let's discuss the {} topic! (Distinct keyword for matching tests: Pineapple)",
                i,
                match i % 3 {
                    0 => "project updates",
                    1 => "team meeting",
                    _ => "technical review",
                }
            ),
            created_at_seconds: EpochSeconds::new(now - (i as i64) * 1800)?,
            updated_at_seconds: EpochSeconds::new(now - (i as i64) * 1800)?,
        };

        client.upsert_channel_message(&channel_args).await?;
        println!("Upserted channel message {}", i);
    }

    // Generate sample chat messages
    println!("Generating sample chat messages...");
    for i in 1..=4 {
        let chat_args = UpsertChatMessageArgs {
            chat_id: format!("chat_{}", (i % 2) + 1),
            chat_message_id: format!("chat_msg_{}", i),
            user_id: test_users[(i - 1) % test_users.len()].to_string(),
            role: if i % 2 == 0 {
                "user".to_string()
            } else {
                "assistant".to_string()
            },
            created_at_seconds: EpochSeconds::new(now - (i as i64) * 900)?,
            updated_at_seconds: EpochSeconds::new(now - (i as i64) * 900)?,
            title: chat_titles[(i - 1) % chat_titles.len()].to_string(),
            content: format!(
                "This is chat message {}. {}",
                i,
                match i % 3 {
                    0 =>
                        "Can you help me understand how the authentication system works? (Distinct keyword for matching tests: Pineapple)",
                    1 =>
                        "Sure! The authentication system uses JWT tokens for session management. (Distinct test keyword: Pineapple)",
                    _ =>
                        "That makes sense. What about the database schema? (Distinct test keyword: Pineapple)",
                }
            ),
        };

        client.upsert_chat_message(&chat_args).await?;
        println!("Upserted chat message {}", i);
    }

    // Generate sample email messages
    println!("Generating sample email messages...");
    for i in 1..=3 {
        let email_args = UpsertEmailArgs {
            thread_id: format!("thread_{}", (i % 2) + 1),
            message_id: format!("email_{}", i),
            sender: format!(
                "{}@example.com",
                test_users[(i - 1) % test_users.len()].replace("user_", "")
            ),
            recipients: vec![
                format!("recipient{}@example.com", i),
                "team@example.com".to_string(),
            ],
            cc: if i == 2 {
                vec!["cc@example.com".to_string()]
            } else {
                vec![]
            },
            bcc: vec![],
            labels: vec![
                "work".to_string(),
                match i % 2 {
                    0 => "urgent".to_string(),
                    _ => "info".to_string(),
                },
            ],
            link_id: Uuid::new_v4().to_string(),
            user_id: test_users[(i - 1) % test_users.len()].to_string(),
            updated_at_seconds: EpochSeconds::new(now - (i as i64) * 7200)?,
            subject: Some(email_subjects[(i - 1) % email_subjects.len()].to_string()),
            sent_at_seconds: Some(EpochSeconds::new(now - (i as i64) * 7200)?),
            content: format!(
                "This is email message {}. Dear team, I wanted to update you on the {} status. Please review the attached details.",
                i,
                match i % 3 {
                    0 => "project milestone",
                    1 => "system deployment (test keyword: pineapple)",
                    _ => "quarterly review",
                }
            ),
        };

        client.upsert_email_message(&email_args).await?;
        println!("Upserted email message {}", i);
    }

    println!("\nSuccessfully generated and upserted sample data for all indices!");
    println!("Generated:");
    println!("- 5 documents");
    println!("- 3 projects");
    println!("- 4 channel messages");
    println!("- 4 chat messages");
    println!("- 3 email messages");

    Ok(())
}
