# Macro DB Client

This crate handles all database queries for Macro DB.

## Testing

**Prerequisite** Ensure you have your local macrodb running in docker before attempting to run tests.
Also, ensure you have populated your local macrodb with all necessary tables via prisma.

To ensure your local macrodb is up to date you can run the following:

```bash
cd cloud-storage
just setup_macrodb
```

To test, you must first run `just prepare_db` in the `macro_db_client` directory.
Then you can run `cargo test` to run the tests.
