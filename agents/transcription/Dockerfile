# This is an example Dockerfile that builds a minimal container for running LK Agents
# For more information on the build process, see https://docs.livekit.io/agents/ops/deployment/builds/
# syntax=docker/dockerfile:1

# Use the official Python base image with Python 3.13
# We use the slim variant to keep the image size smaller while still having essential tools
ARG PYTHON_VERSION=3.13
FROM python:${PYTHON_VERSION}-slim AS base

# Keeps Python from buffering stdout and stderr to avoid situations where
# the application crashes without emitting any logs due to buffering.
ENV PYTHONUNBUFFERED=1

# Disable pip version check to speed up builds
ENV PIP_DISABLE_PIP_VERSION_CHECK=1

# --- Build stage ---
# Install dependencies, build native extensions, and prepare the application
FROM base AS build

# Install build dependencies required for Python packages with native extensions
# gcc: C compiler needed for building Python packages with C extensions
# g++: C++ compiler needed for building Python packages with C++ extensions
# python3-dev: Python development headers needed for compilation
# We clean up the apt cache after installation to keep the image size down
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    python3-dev \
  && rm -rf /var/lib/apt/lists/*

# Create a new directory for our application code
# And set it as the working directory
WORKDIR /app

# Copy just the dependency files first, for more efficient layer caching
COPY requirements.txt ./

# Create a virtual environment and install Python dependencies
# The venv keeps dependencies in /app so they can be copied to the production stage
RUN python -m venv .venv
ENV PATH="/app/.venv/bin:$PATH"
RUN pip install --no-cache-dir -r requirements.txt

# Copy all remaining application files into the container
# This includes source code, configuration files, and dependency specifications
# (Excludes files specified in .dockerignore)
COPY . .

# Pre-download any ML models or files the agent needs
# This ensures the container is ready to run immediately without downloading
# dependencies at runtime, which improves startup time and reliability
RUN python "transcriber.py" download-files

# --- Production stage ---
# Build tools (gcc, g++, python3-dev) are not included in the final image
FROM base

# Create a non-privileged user that the app will run under.
# See https://docs.docker.com/build/building/best-practices/#user
ARG UID=10001
RUN adduser \
    --disabled-password \
    --gecos "" \
    --home "/app" \
    --shell "/sbin/nologin" \
    --uid "${UID}" \
    appuser

WORKDIR /app

# Copy the application and virtual environment with correct ownership in a single layer
# This avoids expensive recursive chown and excludes build tools from the final image
COPY --from=build --chown=appuser:appuser /app /app

# Activate virtual environment
ENV PATH="/app/.venv/bin:$PATH"

# Switch to the non-privileged user for all subsequent operations
# This improves security by not running as root
USER appuser

# Run the application
# The "start" command tells the worker to connect to LiveKit and begin waiting for jobs.
CMD ["python", "transcriber.py", "start"]
