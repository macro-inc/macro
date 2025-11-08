# deploys branch passed to dev, defaulting to current branch. if branch has not been push, gives user the option
# to push it before deploying
[no-cd]
deploy-dev SERVICE_NAME BRANCH="$(git branch --show-current)":
    #!/usr/bin/env bash
    set +e
    echo "Attempting to deploy {{SERVICE_NAME}} from branch {{BRANCH}} to dev environment..."
    output=$(gh workflow run deploy-service-generic.yml --ref {{BRANCH}} --field service={{SERVICE_NAME}} --field environment=dev 2>&1)
    status=$?

    if [ $status -ne 0 ]; then
        if echo "$output" | grep -q "No ref found for"; then
            echo -e "\n⚠️ Branch {{BRANCH}} has not been pushed to remote."
            read -p "Would you like to push this branch now? (y/n): " answer
            if [[ "$answer" == "y" || "$answer" == "Y" ]]; then
                echo "Pushing branch {{BRANCH}}..."
                git push -u origin {{BRANCH}}
                echo "Re-running workflow dispatch..."
                gh workflow run deploy-service-generic.yml --ref {{BRANCH}} --field service={{SERVICE_NAME}} --field environment=dev
            else
                echo "Deployment canceled. Push your branch first before deploying."
                exit 1
            fi
        else
            echo "An error occurred during deployment:"
            echo "$output"
            exit 1
        fi
    else
        echo "Deployment workflow triggered successfully!"
    fi