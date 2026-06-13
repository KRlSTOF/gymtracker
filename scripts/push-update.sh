#!/usr/bin/env bash
set -e

MESSAGE="${1:-Update app}"

git status
git add .
git commit -m "$MESSAGE"
git push
