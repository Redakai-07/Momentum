# Momentum

> A local-first personal command center for making consistent progress.

Momentum helps answer three questions without turning productivity into a complicated system:

1. **What should I do next?** See today's scheduled work, reminders, and due tasks.
2. **How much time will it take?** Track estimates, remaining time, and partial time logs.
3. **How am I doing?** Review performance, focus totals, activity, and streaks.

## Features

- Daily, reminder, occasional, and custom-schedule task sections
- Recurring schedules by weekday, monthly date, or monthly weekday
- Time estimates, partial logging, completion tracking, descriptions, and next actions
- Performance views across day, week, month, and year
- Streaks, recovery days, accomplishments, and context-aware reminders
- Local notifications with snooze, dismiss, deduplication, and cancel-on-complete behavior
- Offline-first storage in IndexedDB; user data stays on the device
- Installable PWA with responsive mobile and desktop layouts
- Capacitor Android and iOS projects for native app builds

## Stack

- Next.js 16 App Router and TypeScript
- Tailwind CSS v4 with light and dark themes
- Zustand for client state
- Dexie for the typed IndexedDB database
- Recharts for profile visualizations
- Capacitor for Android and iOS packaging
- Vitest for deterministic business-logic tests

## Getting started

Requires Node.js and npm.

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in a browser. The app seeds an example workspace when the local database is empty.

## Commands

```bash
npm run dev       # start the development server
npm run build     # create a production build
npm run start     # serve the production build
npm run lint      # run ESLint
npm test          # run the unit test suite
npx tsc --noEmit  # run TypeScript checking only
```

## Mobile builds

Build the static web export, then sync it into the native projects:

```bash
npm run build
npx cap sync
npx cap open android
npx cap open ios
```

Android builds require Android Studio and the Android SDK. iOS builds require macOS and Xcode.

## Icons

The app mark lives in `src/app/icon.svg`. It is the source for the PWA, Android, and iOS launcher icons. After changing it, regenerate every platform asset with:

```bash
node scripts/gen-icons.mjs
```

## Project structure

```text
src/app/              Next.js routes, metadata, and global styles
src/components/       App shell, task flows, dashboard, profile, and UI primitives
src/lib/              Database, state, scheduling, performance, notifications, and tests
public/               PWA manifest, service worker, and generated web icons
android/              Capacitor Android project
ios/                  Capacitor iOS project
scripts/               Asset generation utilities
```

Business rules are kept in pure functions under `src/lib` and covered by focused tests, so scheduling, workload, performance, and streak behavior stays deterministic.

## Build and install the Android APK on Windows

This produces a debug APK from the source code. You do not need Android Studio to run the Gradle command, but you do need the Android SDK and a compatible JDK installed and configured. Android Studio is the easiest way to install and configure those tools.

### Prerequisites

Install the following before starting:

- [Git](https://git-scm.com/download/win)
- [Node.js](https://nodejs.org/) (use the current LTS release; npm is included)
- [Android Studio](https://developer.android.com/studio), or the Android SDK command-line tools
- A JDK supported by Android Gradle Plugin 8.13 (JDK 17 or newer)
- Android SDK Platform 36 and the Android SDK build tools, with `ANDROID_HOME` or `ANDROID_SDK_ROOT` configured if the SDK is not in the default location

### Build the APK

Open Command Prompt or PowerShell and run:

```powershell
git clone https://github.com/Redakai-07/Momentum.git
cd Momentum
npm install
npm run build
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

The build may take a few minutes the first time because Gradle downloads its dependencies. The generated APK is here:

```text
android\app\build\outputs\apk\debug\app-debug.apk
```

### Install the APK on a connected Android device

Enable Developer options and USB debugging on the device, connect it by USB, then run this from the repository's `android` directory:

```powershell
adb install -r .\app\build\outputs\apk\debug\app-debug.apk
```

If `adb` is not recognized, add the Android SDK `platform-tools` directory to your `PATH`, or copy the APK to the phone and open it there. Android may require allowing installation from unknown sources for the app used to open the APK.

This is a debug build for testing. It is not signed for Play Store distribution.




### YOU CAN ALSO GET THE RELEASED VERSION IN THE 'released_apks' Directory