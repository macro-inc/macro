# Project Instructions

## panko - Code Review Comments

This project uses `panko` for code review comments. Use these commands to manage review feedback:

```bash
panko comments                      # List all comments
panko comments --status open        # List unresolved comments
panko resolve <id>                  # Mark comment as resolved
panko reply <id> --message "text"   # Reply to a comment
```

When addressing review comments:
1. List open comments: `panko comments --status open`
2. Make the code changes to address each comment
3. Reply explaining what you did: `panko reply <id> --message "Fixed by..."`
4. Resolve: `panko resolve <id>`
