import './database.just'

mod sqlx './sqlx.just'

rust-check:
    RUSTFLAGS=-Dwarnings RUSTDOCFLAGS=-Dwarnings CARGO_TERM_COLOR=always SQLX_OFFLINE=true cargo check --workspace --all-features --exclude sync_service
    RUSTFLAGS="-Dwarnings -Dclippy::disallowed_methods" RUSTDOCFLAGS=-Dwarnings CARGO_TERM_COLOR=always SQLX_OFFLINE=true cargo check -p sync_service

clippy:
    RUSTFLAGS="-Dwarnings -Dclippy::disallowed_methods" RUSTDOCFLAGS=-Dwarnings CARGO_TERM_COLOR=always SQLX_OFFLINE=true cargo clippy --workspace --all-features --exclude sync_service
    RUSTFLAGS="-Dwarnings -Dclippy::disallowed_methods" RUSTDOCFLAGS=-Dwarnings CARGO_TERM_COLOR=always SQLX_OFFLINE=true cargo clippy -p sync_service -- -A clippy::unnecessary_map_or -A clippy::collapsible_if

# This can be used in any crate that uses macrodb under the hood
[no-cd]
prepare_db:
    just sqlx::prepare_db {{ DATABASE_URL }}

format:
    SQLX_OFFLINE=true cargo fmt

# Regenerate dependency-unification metadata after changing any Cargo.toml:
# the workspace-hack crate (feature unification, see .config/hakari.toml) and
# the per-artifact dep closure map consumed by the flake's deploy builds.
# Runs the lock-pinned generator in tooling/xtask/, so local runs always match CI.
# CI fails if either artifact is stale.
hakari:
    cargo run -p xtask -- deps

clean:
    cargo clean
    git restore target/lambda

build:
    SQLX_OFFLINE=true cargo build

# Build dev service Docker images to pre-warm the cache used by root `run_local`.
build_dev_service_images:
  docker build -f docker/Dockerfile.dev --target services_bundle -t macro-local-rust-services:dev .
  docker build -f docker/Dockerfile.search_processing_service.dev --target search_processing_service -t macro-local-search-processing-service:dev .

# Build all lambda functions
build_lambdas compiler="":
    ulimit -n 10240 && just services/docx_unzip_handler/build {{compiler}}
    ulimit -n 10240 && just services/call_recording_preview_handler/build {{compiler}}
    ulimit -n 10240 && just services/delete_chat_handler/build {{compiler}}
    ulimit -n 10240 && just services/organization_retention_handler/build {{compiler}}
    ulimit -n 10240 && just services/organization_retention_trigger/build {{compiler}}
    ulimit -n 10240 && just services/upload_extractor_lambda_trigger/build {{compiler}}
    ulimit -n 10240 && just services/upload_extractor_lambda_handler/build {{compiler}}
    ulimit -n 10240 && just services/worker_trigger/build {{compiler}}
    ulimit -n 10240 && just services/dataloss_prevention_handler/build {{compiler}}
    ulimit -n 10240 && just services/search_upload_handler/build {{compiler}}
    ulimit -n 10240 && just services/document_text_extractor/build {{compiler}}
    ulimit -n 10240 && just services/document_upload_finalizer_handler/build {{compiler}}
    ulimit -n 10240 && just services/email_suppression_handler/build {{compiler}}
    ulimit -n 10240 && just services/deleted_item_poller/build {{compiler}}
    ulimit -n 10240 && just services/email_refresh_handler/build {{compiler}}
    ulimit -n 10240 && just services/user_link_cleanup_handler/build {{compiler}}
    ulimit -n 10240 && just services/email_scheduled_handler/build {{compiler}}
    ulimit -n 10240 && just services/email_sfs_delete_handler/build {{compiler}}
    ulimit -n 10240 && just services/image_optimizer/build {{compiler}}
    ulimit -n 10240 && just services/ai_projections_refresh_handler/build {{compiler}}

# TESTING

# Copies over necessary .env files for sqlx tests
setup_test_envs:
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/contacts/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./services/delete_chat_handler/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./services/email_sfs_delete_handler/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./services/scheduled_action/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/notification_db_client/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/notification/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/macro_db_client/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/email_db_client/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./services/email_refresh_handler/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/comms_db_client/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./services/document_cognition_service/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./services/document_text_extractor/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./services/organization_retention_handler/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./services/organization_retention_trigger/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./services/organization_retention_handler/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./services/sha_cleanup_worker/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/roles_and_permissions/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/teams/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/frecency/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/favorites/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/soup/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/email/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/system_properties/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/properties/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/name_search/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./services/email_scheduled_handler/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/saved_views/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/channels/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/documents/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/projects/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/foreign_entity/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/stream/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/macro_project_utils/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/entity_access/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/github/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/referral/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/chat/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/memory/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/ai_usage/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/call/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/entity_access_management/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/mobile_welcome_email_db_client/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/entity_access_db_utils/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/mcp_client/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./services/document_storage_service/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/task_dedup/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/crm/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/bots/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./services/call_recording_preview_handler/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/share_permission_db_utils/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/ai_projections/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./services/ai_projections_refresh_handler/.env
    echo "DATABASE_URL={{ DATABASE_URL }}" >> ./crates/webhook/.env

setup_macrodb:
    just crates/macro_db_client/create_db
    just crates/macro_db_client/migrate_db

initialize_dbs: setup_macrodb
