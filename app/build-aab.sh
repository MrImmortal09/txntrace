#!/bin/bash
set -e

# Load environment variables
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

echo "🧹 Cleaning previous builds..."
cd android
./gradlew clean

echo "🔨 Building the signed Android App Bundle (AAB)..."
# The credentials will be picked up from the environment via gradle.properties or direct env vars.
# Since we updated build.gradle to read project properties, we pass them here:
./gradlew bundleRelease \
  -PMYAPP_UPLOAD_STORE_FILE="${MYAPP_UPLOAD_STORE_FILE}" \
  -PMYAPP_UPLOAD_STORE_PASSWORD="${MYAPP_UPLOAD_STORE_PASSWORD}" \
  -PMYAPP_UPLOAD_KEY_ALIAS="${MYAPP_UPLOAD_KEY_ALIAS}" \
  -PMYAPP_UPLOAD_KEY_PASSWORD="${MYAPP_UPLOAD_KEY_PASSWORD}"

echo "✅ Done! Your AAB file is ready at:"
echo "   $(pwd)/app/build/outputs/bundle/release/app-release.aab"
