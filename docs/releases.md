# Releases and updates

How a new version of TxnTrace gets built, published, and onto users' phones.

Most of this page is about Android, because that is where the app itself decides how an update is delivered: quietly in the background, or as a forced update. That decision is driven by one number you choose when you cut a release, the **update priority**.

## At a glance

| What | When it runs | Workflow |
| --- | --- | --- |
| Android app | Manually, from the Actions tab | [android-release.yml](../.github/workflows/android-release.yml) |
| iOS app | Every push to `main`, or manually | [ios-release.yml](../.github/workflows/ios-release.yml) |
| Server | Every push to `main`, or manually | [deploy.yml](../.github/workflows/deploy.yml) |

## Cutting an Android release

Go to **Actions → Create Android Release (APK & AAB) → Run workflow** and fill in three inputs.

| Input | Default | What it controls |
| --- | --- | --- |
| `bump_type` | `patch` | How the version in `app/package.json` is bumped: `patch`, `minor`, `major`, or `none` to rebuild the current version. |
| `track` | `alpha` | Which Google Play track gets the build: `internal`, `alpha`, `beta` or `production`. |
| `update_priority` | `0` | How strongly the app pushes this update on existing users. See [Update priority](#update-priority). |

The run then does the following, in order:

1. **Bumps the version** (unless `bump_type` is `none`). It commits `chore(release): bump version to vX.Y.Z`, tags it `vX.Y.Z`, and pushes both.
2. **Builds a signed APK and AAB.**
   - The version name is the version from `app/package.json`.
   - The version code is the workflow's run number, so every run produces a higher code than the last. Google Play compares version codes to decide whether an update exists.
3. **Publishes a GitHub Release** `vX.Y.Z` with both files attached and the list of commits since the previous tag.
4. **Uploads the AAB to Google Play** on the chosen track, fully rolled out, with the chosen update priority. This step only runs when the `PLAY_STORE_CREDENTIALS` secret is set. Without it the step is skipped and nothing reaches Play.

## Update priority

### What it is

Update priority is a number from 0 to 5 that Google Play stores against a release. Play does nothing with it on its own. It hands the number to the app when the app asks "is there an update?", and the app decides how hard to push.

### How TxnTrace uses it

| Priority | Kind of update | What the user gets |
| --- | --- | --- |
| 0 to 3 | Normal | The update downloads in the background and installs by itself. The app is never blocked. |
| 4 to 5 | Critical | The update is forced. The app cannot be used until it is installed. |

The app only looks at which side of the line a release falls on. Today 0, 1, 2 and 3 all behave the same, and so do 4 and 5.

### Which to pick

Leave it at **0** for almost every release: features, UI changes, new bank parsers, ordinary bug fixes.

Use **4 or 5** only when staying on the old version does harm, for example:

- a parser bug that records wrong amounts or drops transactions
- a database migration bug that corrupts or loses data
- a security fix
- a server change that older app versions cannot talk to

### Rules worth knowing

- **It is fixed when the release is published.** You cannot change a release's priority afterwards. To escalate, publish a new release with a higher priority.
- **Skipped versions count.** Play reports the highest priority among every version between the one the user has and the latest, across all tracks. A critical release stays critical for anyone who has not taken it yet, even after later routine releases. The reverse also holds: a priority 5 build on the internal track makes the next production update forced for every user still behind it.
- **It can only be set by the workflow.** Priority goes through the Play Developer API, which the upload step uses. A build uploaded by hand in Play Console gets priority 0.
- **Only installs from Google Play get in-app updates.** Someone who installed the APK from the GitHub Release is not offered updates this way and has to install the next APK themselves.

### Where the number travels

1. You pick `update_priority` when running the workflow.
2. The upload step passes it to Google Play as `inAppUpdatePriority`, and Play stores it on the release.
3. When the app checks for an update, Play returns it as `updatePriority`. The native module [PlayStoreUpdateModule.kt](../app/android/app/src/main/java/com/chanakya/txntrace/PlayStoreUpdateModule.kt) forwards it to JavaScript unchanged.
4. `checkForAppUpdate` in [playStoreUpdate.ts](../app/src/services/playStoreUpdate.ts) compares it with `CRITICAL_UPDATE_PRIORITY` (currently 4) and picks the normal or the critical path.

To move the line between normal and critical, change `CRITICAL_UPDATE_PRIORITY` and the description of the `update_priority` input in the workflow.

## How an update reaches the user

The app asks Google Play for an update on launch and every time it returns to the foreground.

### Normal update (priority 0 to 3)

1. Play shows its own "Update available" prompt. This prompt belongs to Play and cannot be skipped or restyled.
2. If the user accepts, the update downloads in the background while they keep using the app. **More → Settings → App Updates** shows the progress.
3. When the download finishes, an **Update ready** bar appears above the tab bar with a **Restart** button. The user can restart straight away or dismiss the bar.
4. If they do not restart, the update installs silently the next time the phone is idle, roughly after the screen has been off for about half an hour. As a fallback it installs after 24 hours even if the phone never reports itself idle.
5. If the user declines Play's prompt, the same version is not offered again for 3 days, or until a newer version is published. **Check for Play Store Updates** in Settings always offers it, whatever was declined.

The silent install never runs while the app is on screen or while an incoming SMS is being processed.

#### Why it waits for the phone to be idle

Installing an update replaces the app. The app is closed, and for a few seconds it cannot receive SMS. Android has no way to re-read an SMS the app missed, so a bank message arriving in that gap is lost for good.

Installing the moment the user leaves the app would put that gap right where a payment SMS is most likely, and would also throw away whatever they were in the middle of, such as an OTP login or a sync. Waiting until the phone is idle avoids both.

### Critical update (priority 4 to 5)

1. Play shows its full-screen update screen. The app cannot be used until the update is installed.
2. If the user backs out, the app shows an **Update Required** dialog with two choices: **Update Now** or **Exit App**.
3. If Play cannot run the full-screen flow on that device, the update downloads in the background instead, and the app then shows a **Restart Now** dialog that cannot be dismissed.

## Testing an update

In-app updates only work for a build that was installed from Google Play, so this cannot be tested with a debug build or a sideloaded APK. On those, the update check fails quietly and logs a warning, which is expected.

1. Run the workflow with `track` set to `internal`. Install that build on a test phone from the Play internal testing link.
2. Run the workflow again with the `update_priority` you want to try. The version code goes up automatically.
3. Open the app. Play's update prompt, or the forced update screen, should appear.

Play can take a while to notice a new build. Opening **Manage apps & device** in the Play Store app usually makes it refresh.

To see the silent install, accept the update, let it download, then leave the phone with the screen off.

## Where the code lives

| File | Role |
| --- | --- |
| [android-release.yml](../.github/workflows/android-release.yml) | Builds the release and uploads it to Play with the update priority. |
| [playStoreUpdate.ts](../app/src/services/playStoreUpdate.ts) | Decides what to do with an available update. Holds the priority threshold and the 3-day decline period. |
| [PlayStoreUpdateModule.kt](../app/android/app/src/main/java/com/chanakya/txntrace/PlayStoreUpdateModule.kt) | Bridge to Google Play's in-app update SDK. |
| [UpdateInstallJobService.kt](../app/android/app/src/main/java/com/chanakya/txntrace/UpdateInstallJobService.kt) | Installs a downloaded update when the phone is idle. |
| [UpdateBanner.tsx](../app/src/components/UpdateBanner.tsx) | The "Update ready" bar above the tab bar. |
| [playStoreUpdate.test.ts](../app/__tests__/playStoreUpdate.test.ts) | Tests for the update decisions. |

## iOS and server

- **iOS.** Every push to `main` builds a signed IPA and publishes it on GitHub Releases as an over-the-air install. A manual run can also bump the version. The in-app update flow described on this page is Android only.
- **Server.** Every push to `main` connects to the server, pulls `main`, installs the Python requirements and restarts the service.

Because both run on every push to `main`, an Android-only change pushed to `main` still triggers an iOS build and a server redeploy.
