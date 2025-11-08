#!/usr/bin/env bash

# Function to create Docker volume
create_volume() {
    docker volume create --name $1
}

# Create Docker volumes
create_volume macro_db_volume
create_volume macro_cache_volume

# Opensearch
create_volume macro_opensearch_1
create_volume macro_opensearch_2
