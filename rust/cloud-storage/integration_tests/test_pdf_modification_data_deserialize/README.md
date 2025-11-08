# Running the tests

DATABASE_URL=$MACRODB_DEV_URL cargo run --bin test_placeable_thread_deserialization
DATABASE_URL=$MACRODB_DEV_URL cargo run --bin test_highlight_deserialization
