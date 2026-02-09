use anyhow::Context;
use authentication_service::generate_random_password;
use futures::StreamExt;
use macro_entrypoint::MacroEntrypoint;
use sqlx::postgres::PgPoolOptions;
use std::borrow::Cow;

/// Backfills the macro_user table with all users in the database
/// LIMIT defaults to 1000
/// STARTING_CURSOR optional cursor to start from (User table id)
#[tokio::main]
pub async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    let database_url = std::env::var("DATABASE_URL").context("expected to find DATABASE_URL")?;
    let db = PgPoolOptions::new()
        .min_connections(5)
        .max_connections(25)
        .connect(&database_url)
        .await
        .context("could not connect to db")?;

    tracing::trace!("initialized db connection");

    let limit = std::env::var("LIMIT")
        .map(|s| s.parse::<i64>().unwrap())
        .unwrap_or(1000);
    let mut cursor: Option<String> = std::env::var("CURSOR").ok();

    let mut total = 0;

    let auth_client = authentication_service::FusionAuthClient::new(
        std::env::var("FUSIONAUTH_API_KEY").context("FUSIONAUTH_API_KEY env var not set")?,
        std::env::var("FUSIONAUTH_CLIENT_ID").context("FUSIONAUTH_CLIENT_ID env var not set")?,
        std::env::var("FUSIONAUTH_CLIENT_SECRET")
            .context("FUSIONAUTH_CLIENT_SECRET env var not set")?,
        std::env::var("FUSIONAUTH_APPLICATION_ID")
            .context("FUSIONAUTH_APPLICATION_ID env var not set")?,
        std::env::var("FUSIONAUTH_BASE_URL").context("FUSIONAUTH_BASE_URL env var not set")?,
        "FUSIONAUTH_OAUTH_REDIRECT_URI".to_string(), // not used in script so can be ignored
        "GOOGLE_CLIENT_ID".to_string(),              // not used in script so can be ignored
        "GOOGLE_CLIENT_SECRET".to_string(),          // not used in script so can be ignored
    );

    loop {
        // get batch of users email + stripe customer id with macro_user_id NULL
        let users =
            macro_db_client::user::get_all::get_all_user_ids_stripe_customer_id_with_null_macro_user_id(&db, limit, cursor.clone())
                .await
                .context("unable to get users")?;

        if users.is_empty() {
            tracing::trace!("no more users to process");
            break;
        }

        let last_user_id = users.last().map(|(id, _)| id.clone());

        let result = futures::stream::iter(users.iter())
            .then(|(user_id, stripe_customer_id)| {
                let db = db.clone();
                let auth_client = auth_client.clone();
                async move {
                    tracing::trace!(user_id=%user_id, stripe_customer_id=?stripe_customer_id, "processing user");
                    let stripe_customer_id = if let Some(stripe_customer_id) = stripe_customer_id {
                        stripe_customer_id.to_string()
                    } else {
                        return Err((user_id.to_string(), anyhow::anyhow!("no stripe customer id found")));
                    };

                    // strip the macro| from user id to get their email
                    let email = user_id.replace("macro|", "");

                    // get fusionauth user id by email
                    let fusionauth_user_id = if let Ok(fusionauth_user_id) = auth_client
                        .get_user_id_by_email(&email)
                        .await {
                            fusionauth_user_id
                    } else {
                        tracing::warn!("unable to get fusionauth user id by email {email}. creating user");
                        auth_client.create_user(authentication_service::User{
                            email: Cow::Borrowed(&email),
                            password: generate_random_password().into(),
                            username: None, // the username will automatically be set to the email
                        },
                        true,
                        )
                        .await
                        .map_err(|e| (user_id.to_string(), anyhow::Error::new(e)))?;

                        return Ok(());
                    };

                    tracing::trace!(fusionauth_user_id=?fusionauth_user_id, user_id=?user_id, stripe_customer_id=?stripe_customer_id, "user id found");

                    let mut transaction = db.begin().await.map_err(|e| {
                        (
                            user_id.to_string(),
                            anyhow::Error::new(e).context("unable to start transaction"),
                        )
                    })?;

                    // create macro user
                    macro_db_client::macro_user::create_macro_user(&mut transaction, &fusionauth_user_id, &email, &stripe_customer_id, &email).await.map_err(|e| (user_id.to_string(), e))?;

                    // update User table with macro_user_id
                    macro_db_client::user::update::upsert_macro_user_id(&mut transaction, user_id, &fusionauth_user_id).await.map_err(|e| (user_id.to_string(), e))?;

                    // move user profile to macro_user_info table
                    macro_db_client::user::update::migrate_macro_user_info(&mut transaction, &fusionauth_user_id, user_id).await.map_err(|e| (user_id.to_string(), e))?;

                    transaction.commit().await.map_err(|e| (user_id.to_string(), anyhow::Error::new(e)))?;

                    Ok(())
                }
            })
            .collect::<Vec<Result<(), (String, anyhow::Error)>>>()
            .await;

        let failed_results = result
            .into_iter()
            .filter_map(|r| r.err())
            .collect::<Vec<_>>();

        for (user_id, e) in failed_results {
            eprintln!("unable to process user {user_id}: reason: {e}");
        }

        if let Some(cursor) = cursor.as_deref() {
            println!("processed cursor {cursor} users");
        }

        cursor = last_user_id;
        total += users.len();
    }

    println!("done processed {total} users");

    Ok(())
}
