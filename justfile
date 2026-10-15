# Native builds of the mobile app via the React Native CLI. `run-*` builds, installs and
# starts Metro. Pass extra flags through, e.g. `just android --list-devices` or
# `just ios --device "Om’s iPhone"`.

set positional-arguments

mobile := "app"

default:
    @just --list

# Start the Metro bundler on its own
start *args:
    cd {{mobile}} && npx react-native start "$@"

# Build and run on an Android emulator or connected device
android *args:
    cd {{mobile}} && npx react-native run-android "$@"

# Build and run on the iOS simulator or a connected device
ios *args:
    cd {{mobile}} && npx react-native run-ios "$@"

# Standalone install on a connected iPhone: a Release build with the JS bundled in, so it
# runs without Metro, against the SERVER_URL in app/.env. Uses the first connected iPhone
# unless one is named. A free Apple ID signs it for 7 days; run this again to renew.
[doc("Standalone Release install on a connected iPhone (no Metro needed)")]
ios-install *args:
    cd {{mobile}} && npx react-native run-ios --mode Release --no-packager --device "$@"

# Reinstall CocoaPods after changing native dependencies
pods:
    cd {{mobile}}/ios && bundle exec pod install
