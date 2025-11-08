# Search Processing Service

This service is responsible for processing search text extraction messages and updating the OpenSearch content for cloud storage items.

## Running Locally

To run the service locally, you need to have aws cli setup with valid credentials for Macro.

Copy the `.env.sample` file to `.env` and fill in the values for the environment variables.

Run the following command to start the service:

```bash
cargo run
```

To run without processing queue messages, you can run the following command:

```bash
cargo run --features disable_processing
```
