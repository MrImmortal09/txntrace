This is a new [**React Native**](https://reactnative.dev) project, bootstrapped using [`@react-native-community/cli`](https://github.com/react-native-community/cli).

# Getting Started

> **Note**: Make sure you have completed the [Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment) guide before proceeding.

## Step 1: Start Metro

First, you will need to run **Metro**, the JavaScript build tool for React Native.

To start the Metro dev server, run the following command from the root of your React Native project:

```sh
# Using npm
npm run ios -- --device "Om’s iPhone"

# OR using Yarn
yarn start
```

## Step 2: Build and run your app

With Metro running, open a new terminal window/pane from the root of your React Native project, and use one of the following commands to build and run your Android or iOS app:

### Android

```sh
# Using npm
npm run android

# OR using Yarn
yarn android
```

### iOS

For iOS, remember to install CocoaPods dependencies (this only needs to be run on first clone or after updating native deps).

The first time you create a new project, run the Ruby bundler to install CocoaPods itself:

```sh
bundle install
```

Then, and every time you update your native dependencies, run:

```sh
bundle exec pod install
```

For more information, please visit [CocoaPods Getting Started guide](https://guides.cocoapods.org/using/getting-started.html).

```sh
# Using npm
npm run ios

# OR using Yarn
yarn ios
```

If everything is set up correctly, you should see your new app running in the Android Emulator, iOS Simulator, or your connected device.

This is one way to run your app — you can also build it directly from Android Studio or Xcode.

## Step 3: Modify your app

Now that you have successfully run the app, let's make changes!

Open `App.tsx` in your text editor of choice and make some changes. When you save, your app will automatically update and reflect these changes — this is powered by [Fast Refresh](https://reactnative.dev/docs/fast-refresh).

When you want to forcefully reload, for example to reset the state of your app, you can perform a full reload:

- **Android**: Press the <kbd>R</kbd> key twice or select **"Reload"** from the **Dev Menu**, accessed via <kbd>Ctrl</kbd> + <kbd>M</kbd> (Windows/Linux) or <kbd>Cmd ⌘</kbd> + <kbd>M</kbd> (macOS).
- **iOS**: Press <kbd>R</kbd> in iOS Simulator.

## Standalone install on your iPhone (no laptop needed afterward)

The steps above run a **Debug** build, which fetches its JavaScript from Metro on your Mac at runtime — it stops working the moment you disconnect or Metro isn't reachable. A **Release** build bundles the JS directly into the app package instead, so once it's installed the app runs entirely on the phone: no Mac, no Wi-Fi, no cable.

1. Find your iPhone's UDID (only needed once, unless you use a different device):
   ```sh
   xcrun xctrace list devices
   ```
   Look for your iPhone under "Devices" — the ID in parentheses is the UDID.

2. From the `app/` directory, build, sign, install, and launch a Release build in one step:
   ```sh
   npx react-native run-ios --udid <YOUR_DEVICE_UDID> --mode Release
   ```
   This does not need Metro running.

3. **First install only** — trust the developer certificate on the phone: **Settings → General → VPN & Device Management → tap your Apple ID entry under "Developer App" → Trust**. Without this the app installs but refuses to open.

4. Launch TxnTrace from the Home Screen. From now on it runs standalone.

### Re-installing after code changes

Re-run the command from step 2 whenever you want the phone to pick up new code. It rebuilds, re-signs, and reinstalls in place — your local SQLite data (transactions, SMS logs) is preserved across reinstalls as long as you keep using the same signing identity, which happens automatically.

### Important: 7-day expiry on a free Apple ID

This project is signed with a free personal Apple Developer account (no $99/year enrollment). Apple limits apps built this way to a provisioning profile that **expires after 7 days** — after that the app refuses to launch until you repeat step 2 (no code changes required, just rebuild and reinstall). A paid Apple Developer Program membership removes this limit for about a year per build; there's no way around it on a free account.

## Congratulations! :tada:

You've successfully run and modified your React Native App. :partying_face:

### Now what?

- If you want to add this new React Native code to an existing application, check out the [Integration guide](https://reactnative.dev/docs/integration-with-existing-apps).
- If you're curious to learn more about React Native, check out the [docs](https://reactnative.dev/docs/getting-started).

# Troubleshooting

If you're having issues getting the above steps to work, see the [Troubleshooting](https://reactnative.dev/docs/troubleshooting) page.

# Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.
