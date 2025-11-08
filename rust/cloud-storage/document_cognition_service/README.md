# Document Cognition Service 

## Running locally

### Prerequisites

1. **Docker** - For running the local PostgreSQL database
2. **Doppler CLI** - For environment variable management

### Setup with Doppler (Recommended)

For local development, we recommend using Doppler to manage environment variables:

1. **Create your own Doppler environment**:
   - Fork the existing `lcl_gab_lcl_macrodb` config in the `document_cognition_service` project
      - this config is used for local development against a local macrodb database
      - if you want to use the dev database to have existing data, you can base your config off of `lcl_dev` config
   - Update the `LOCAL_USER_ID` to match your user (e.g., `macro|your-email@macro.com`)
   - Ensure all required environment variables are set

2. **Start the local database**:
   ```bash
   # cd into the root of the macro-api repo
   cd macro-api 
   # spin up the macrodb docker container
   docker-compose up macrodb
   ```

3. **Initialize the database with your user**:
   ```bash
   doppler run --command="just init_local_db" -p document_cognition_service -c YOUR_CONFIG_NAME
   ```
   This will:
   - Run the base database initialization
   - Create your user in the database with AI chat capabilities
   - Set up all necessary roles and permissions

4. **Run the service**:
   ```bash
   doppler run --command="just debug" -p document_cognition_service -c YOUR_CONFIG_NAME
   ```

5. **Connect from the frontend**:
   In the `app-monorepo` directory, run:
   ```bash
   bun run local-dcs
   ```

### Alternative: Manual Setup

If you prefer not to use Doppler:

You can run with .env file and setting the environment variables manually.
Copy the .env.sample file to .env and fill in the values.
Note that the .env.sample file is not necessarily up to date for running locally.

## Database

Document Cognition Service uses `macrodb`

Qeuries used by dcs, are split up between this crate and the `macro_db_client` crate.

After making changes to the queries, you have to prepare using the following command:

```bash
cargo sqlx prepare 
```

Note: for prepare to work properly, you need to have `DATABSE_URL` set locally.

## Swagger

Swagger UI is available locally at `http://localhost:8084/docs/` after running the service, e.g. `cargo run`.

Run the following command to validate the swagger file:
`npx @apidevtools/swagger-cli validate "http://localhost:8084/api-doc/openapi.json"`
