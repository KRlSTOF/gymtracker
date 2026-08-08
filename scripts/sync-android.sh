#!/usr/bin/env bash
set -e

echo "Pulling latest changes..."
git pull

echo "Installing dependencies..."
npm install

echo "Building React app for Capacitor..."
npm run build -- --mode capacitor

echo "Syncing Capacitor Android project..."
npx cap sync android

echo "Done. Now commit and push if files changed:"
echo "  git status"
echo "  git add ."
echo "  git commit -m \"Update Android build\""
echo "  git push"
