#!/usr/bin/env bash
set -e
python3 - <<'P'
p='apps/web/src/lib/graphql-cache/generated/entity-resolver-schema.ts'; s=open(p).read()
old="""      argumentPaths: [
        ['channelId'],
        ['messageId'],
      ],"""
assert old in s
open(p,'w').write(s.replace(old,"      argumentPaths: [['channelId'], ['messageId']],"))
P
git commit -qa --amend --no-edit
