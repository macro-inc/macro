#!/usr/bin/env bash
PACKAGE=$1
rg -l "@$PACKAGE" | xargs sed -i "s|@$PACKAGE|../../packages/$PACKAGE|g"
