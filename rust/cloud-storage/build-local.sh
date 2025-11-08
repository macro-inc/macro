#!/bin/bash
set -euo pipefail

# Background:
# Useful for local development as it uses incremental compilation to speed up builds,
# which is not available in CI/CD. Build speeds will go from 10-20 minutes to seconds.

# Pre-requisites:
# You will need to install cross (https://github.com/cross-rs/cross).

# What this script does:
# Builds a local binary cross-compiled for Linux and then builds a Docker image from it
# and pushes it to ECR under the 'local' tag ('latest' is reserved). 
# To deploy the image run `USE_EXISTING_IMAGE=true pulumi up` in the stack directory

# Usage: ./build-local.sh <SERVICE_NAME> <ECR_REPO> [AWS_REGION] [IMAGE_TAG]
# Example: ./build-local.sh insight_service 569036502058.dkr.ecr.us-east-1.amazonaws.com/insight-service-dev

SERVICE_NAME=${1:-}
ECR_REPO=${2:-}
IMAGE_TAG="local"

if [ -z "$SERVICE_NAME" ] || [ -z "$ECR_REPO" ]; then
  echo "Usage: $0 <SERVICE_NAME> <ECR_REPO>"
  exit 1
fi

# Build locally for maximum incremental speed
echo "Building $SERVICE_NAME for Linux using docker locally with incremental compilation..."
cross build --release --bin "${SERVICE_NAME}" --target x86_64-unknown-linux-gnu --target-dir target
echo "✅ Local build complete"

echo "🐳 Building Docker image from release..."
docker buildx build \
  --platform=linux/amd64 \
  --build-context release=target/x86_64-unknown-linux-gnu/release \
  --build-arg SERVICE_NAME="$SERVICE_NAME" \
  -t "$ECR_REPO:$IMAGE_TAG" \
  -f Dockerfile.prebuilt . \
  --push

echo "✅ Built and pushed $ECR_REPO:$IMAGE_TAG"
