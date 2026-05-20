# Cloud Storage Cache

This stack creates an ECR repository for the Cloud Storage cache image.

Note: This stack only creates the legacy ECR repository for the Cloud Storage cache image.
The cache image is no longer rebuilt by CI; local development uses `Dockerfile.dev` via `just run_local`, and service deployments use prebuilt binaries.
