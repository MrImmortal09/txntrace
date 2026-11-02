#!/usr/bin/env bash
# Build the iOS app for the App Store and upload it to App Store Connect, where it shows up in
# TestFlight and can be sent for review. Runs on a Mac with Xcode and CocoaPods; the
# "Create iOS Release (App Store Connect)" workflow (ios-app-store.yml) runs it too.
#
#   PROVISIONING_PROFILE=~/Downloads/TxnTrace_App_Store.mobileprovision scripts/ios-release.sh
#
# Inputs:
#
#   VERSION_NAME          shown on the App Store                (default: app/package.json's version)
#   BUILD_NUMBER          must rise with every upload of a version   (default: minutes since 1970)
#   UPLOAD                0 exports the .ipa into dist-ios/ instead of uploading       (default: 1)
#   PROVISIONING_PROFILE  path to an App Store provisioning profile (.mobileprovision) for the app.
#                         The bundle ID, team and App Group are read from it, and the app is signed
#                         by hand as Apple Distribution, whose certificate must be in a keychain.
#   BUNDLE_ID / TEAM_ID / APP_GROUP
#                         without PROVISIONING_PROFILE, what to sign for. Xcode then signs by itself
#                         through the account signed in under Xcode > Settings > Accounts, making
#                         the profile it needs for an App ID and App Group that already exist.
#   ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH
#                         an App Store Connect API key (.p8). Used for signing and uploading in
#                         place of the Xcode account; a machine with none, like CI, needs one.
#
# Output lands in dist-ios/: the archive always, which Xcode's Organizer can open to upload by
# hand if the upload fails, and the .ipa with UPLOAD=0.
#
# The App Group is written into the entitlements and the Swift sources that name it for the length
# of the build, and they are put back afterwards, so leave app/ios alone while it runs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/app"
IOS="$APP/ios"
OUT="$ROOT/dist-ios"

die() { echo "error: $*" >&2; exit 1; }

# --- inputs -------------------------------------------------------------------------------

command -v xcodebuild > /dev/null || die 'xcodebuild not found: install Xcode'
command -v pod > /dev/null || die 'CocoaPods not found: brew install cocoapods'
[ -d "$APP/node_modules" ] || die 'run npm ci in app/ first'

WORK="$(mktemp -d -t txntrace-ios)"
# The sources the App Group is written into are copied here first, and copied back on the way out.
trap '[ -d "$WORK/originals" ] && cp -R "$WORK/originals/." "$ROOT/"; rm -rf "$WORK"' EXIT

# Expanded as ${ASC_KEY[@]+"${ASC_KEY[@]}"}: macOS's own bash 3.2 calls an empty array unbound under set -u.
ASC_KEY=()
if [ -n "${ASC_KEY_ID:-}${ASC_ISSUER_ID:-}${ASC_KEY_PATH:-}" ]; then
  [ -n "${ASC_KEY_ID:-}" ] && [ -n "${ASC_ISSUER_ID:-}" ] && [ -n "${ASC_KEY_PATH:-}" ] \
    || die 'an App Store Connect key needs all three of ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH'
  [ -f "$ASC_KEY_PATH" ] || die "no key file at ASC_KEY_PATH ($ASC_KEY_PATH)"
  ASC_KEY=(-authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
fi

if [ -n "${PROVISIONING_PROFILE:-}" ]; then
  [ -f "$PROVISIONING_PROFILE" ] || die "no profile at PROVISIONING_PROFILE ($PROVISIONING_PROFILE)"
  security cms -D -i "$PROVISIONING_PROFILE" > "$WORK/profile.plist" 2> /dev/null \
    || die "PROVISIONING_PROFILE ($PROVISIONING_PROFILE) isn't a provisioning profile"
  # The value at a PlistBuddy key path, or nothing when the profile hasn't got it.
  profile() { local v; if v="$(/usr/libexec/PlistBuddy -c "Print :$1" "$WORK/profile.plist" 2> /dev/null)"; then echo "$v"; fi; }
  PROFILE_NAME="$(profile Name)"
  PROFILE_UUID="$(profile UUID)"
  TEAM_ID="$(profile TeamIdentifier:0)"
  APP_ID="$(profile Entitlements:application-identifier)"
  APP_ID_PREFIX="$(profile ApplicationIdentifierPrefix:0)"
  BUNDLE_ID="${APP_ID#"$APP_ID_PREFIX".}"
  APP_GROUP="$(profile Entitlements:com.apple.security.application-groups:0)"
  [[ "$PROFILE_UUID" =~ ^[0-9A-Fa-f-]{36}$ ]] || die "PROVISIONING_PROFILE ($PROVISIONING_PROFILE) has no UUID"
  # An App Store profile lists no devices and can't be attached to by a debugger.
  if [ -n "$(profile ProvisionedDevices)" ] || [ "$(profile ProvisionsAllDevices)" = true ] || [ "$(profile Entitlements:get-task-allow)" = true ]; then
    die "'$PROFILE_NAME' is a development, ad hoc or enterprise profile; make one under Distribution > App Store Connect"
  fi
  [[ "$BUNDLE_ID" != *'*'* ]] || die "'$PROFILE_NAME' is for a wildcard App ID; make it for the app's own App ID"
  [ -n "$APP_GROUP" ] || die "'$PROFILE_NAME' has no App Group: turn on App Groups for $BUNDLE_ID, pick the group, then make the profile again"
  # Xcode 16 and later read profiles from UserData; older ones from MobileDevice.
  for dir in "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles" "$HOME/Library/MobileDevice/Provisioning Profiles"; do
    mkdir -p "$dir"
    cp "$PROVISIONING_PROFILE" "$dir/$PROFILE_UUID.mobileprovision"
  done
else
  for name in BUNDLE_ID TEAM_ID APP_GROUP; do
    [ -n "${!name:-}" ] || die "set PROVISIONING_PROFILE, or else BUNDLE_ID, TEAM_ID and APP_GROUP for Xcode to sign with"
  done
fi
[[ "$TEAM_ID" =~ ^[A-Z0-9]{10}$ ]] || die "TEAM_ID must be a 10-character team ID, got '$TEAM_ID'"
[[ "$BUNDLE_ID" =~ ^[A-Za-z0-9.-]+$ ]] || die "BUNDLE_ID must be a reverse-DNS bundle ID, got '$BUNDLE_ID'"
[[ "$APP_GROUP" =~ ^group\.[A-Za-z0-9.-]+$ ]] || die "APP_GROUP must be group.<something>, got '$APP_GROUP'"

VERSION_NAME="${VERSION_NAME:-$(node -p "require('$APP/package.json').version")}"
[[ "$VERSION_NAME" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "VERSION_NAME must be X.Y.Z, got '$VERSION_NAME'"
# App Store Connect turns away a build number it has had for this version. Minutes since 1970 keep rising.
BUILD_NUMBER="${BUILD_NUMBER:-$(( $(date +%s) / 60 ))}"
[[ "$BUILD_NUMBER" =~ ^[0-9]+$ ]] || die "BUILD_NUMBER must be a number, got '$BUILD_NUMBER'"
UPLOAD="${UPLOAD:-1}"

# --- App Group ----------------------------------------------------------------------------

# The app and its Shortcuts intent pass messages through the App Group's container, and the group
# is spelled out in the entitlements and the Swift that opens it. The checked-in one belongs to the
# ad-hoc build's team; an App Store build needs one registered to its own.
CURRENT_GROUP="$(/usr/libexec/PlistBuddy -c 'Print :com.apple.security.application-groups:0' "$IOS/TxnTrace/TxnTrace.entitlements")"
if [ "$APP_GROUP" != "$CURRENT_GROUP" ]; then
  FILES=()
  while IFS= read -r file; do FILES+=("$file"); done < <(git -C "$ROOT" grep -lF "$CURRENT_GROUP" -- app/ios app/modules)
  [ "${#FILES[@]}" -gt 0 ] || die "can't find the files that name $CURRENT_GROUP: run this from a git checkout"
  for file in "${FILES[@]}"; do
    mkdir -p "$WORK/originals/$(dirname "$file")"
    cp "$ROOT/$file" "$WORK/originals/$file"
    OLD="$CURRENT_GROUP" NEW="$APP_GROUP" perl -pi -e 's/\Q$ENV{OLD}\E/$ENV{NEW}/g' "$ROOT/$file"
  done
  echo "App Group $APP_GROUP in place of $CURRENT_GROUP in ${FILES[*]}"
fi

# --- archive ------------------------------------------------------------------------------

echo "Building $BUNDLE_ID v$VERSION_NAME ($BUILD_NUMBER) for team $TEAM_ID"

(cd "$IOS" && pod install --repo-update)

if [ -n "${PROVISIONING_PROFILE:-}" ]; then
  # Read by the app target's Release configuration alone: given as CODE_SIGN_STYLE and the rest,
  # they would reach every CocoaPods target too, and a library given a profile fails the build.
  SIGN_ARCHIVE=(TXNTRACE_CODE_SIGN_STYLE=Manual 'TXNTRACE_CODE_SIGN_IDENTITY=Apple Distribution' "TXNTRACE_PROVISIONING_PROFILE=$PROFILE_UUID")
  SIGN_EXPORT=(${ASC_KEY[@]+"${ASC_KEY[@]}"})
  EXPORT_SIGNING="<key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>provisioningProfiles</key><dict><key>$BUNDLE_ID</key><string>$PROFILE_UUID</string></dict>"
else
  SIGN_ARCHIVE=(-allowProvisioningUpdates ${ASC_KEY[@]+"${ASC_KEY[@]}"})
  SIGN_EXPORT=(-allowProvisioningUpdates ${ASC_KEY[@]+"${ASC_KEY[@]}"})
  EXPORT_SIGNING="<key>signingStyle</key><string>automatic</string>"
fi

mkdir -p "$OUT"
NAME="txntrace-$VERSION_NAME-$BUILD_NUMBER"
ARCHIVE="$OUT/$NAME.xcarchive"
rm -rf "$ARCHIVE"

# A DerivedData folder of its own, so a release never picks up a dev build's leftovers. The version
# reaches the app's Info.plist through MARKETING_VERSION and CURRENT_PROJECT_VERSION.
xcodebuild archive -quiet \
  -workspace "$IOS/TxnTrace.xcworkspace" -scheme TxnTrace -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" -derivedDataPath "$WORK/DerivedData" \
  "MARKETING_VERSION=$VERSION_NAME" "CURRENT_PROJECT_VERSION=$BUILD_NUMBER" \
  "TXNTRACE_BUNDLE_ID=$BUNDLE_ID" "TXNTRACE_TEAM_ID=$TEAM_ID" \
  "${SIGN_ARCHIVE[@]}"

# --- export -------------------------------------------------------------------------------

[ "$UPLOAD" = 1 ] && DESTINATION=upload || DESTINATION='export'
cat > "$WORK/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$DESTINATION</string>
  <key>teamID</key><string>$TEAM_ID</string>
  $EXPORT_SIGNING
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
PLIST

xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" -exportOptionsPlist "$WORK/ExportOptions.plist" -exportPath "$WORK/export" \
  ${SIGN_EXPORT[@]+"${SIGN_EXPORT[@]}"}

echo
echo "Archive: $ARCHIVE"
if [ "$UPLOAD" = 1 ]; then
  echo "Uploaded v$VERSION_NAME ($BUILD_NUMBER) to App Store Connect. It shows in TestFlight once Apple has processed it."
else
  mv "$WORK"/export/*.ipa "$OUT/$NAME.ipa"
  echo "IPA: $OUT/$NAME.ipa"
fi
