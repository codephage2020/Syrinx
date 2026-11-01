#!/bin/bash
# Syrinx — build the APK without Gradle.
#
# Needs a JDK 17 and the Android command-line tools (build-tools 34 + platform 28).
# Override the auto-detected locations with ANDROID_SDK and JAVA_HOME.
set -e

PROJ="$(cd "$(dirname "$0")" && pwd)"
SDK="${ANDROID_SDK:-/opt/homebrew/share/android-commandlinetools}"
# d8 (R8 8.2) crashes on class files produced by very new javac releases,
# so pin the whole build to a JDK 17 toolchain.
JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"

BT="$SDK/build-tools/34.0.0"
ANDROID_JAR="$SDK/platforms/android-28/android.jar"
OUT="$PROJ/build"
APK="$OUT/syrinx.apk"

# Signing: point SYRINX_KEYSTORE at your own release key, or leave it unset and
# the build falls back to the standard Android debug keystore, which keytool
# creates on first use. Never commit a keystore.
KS="${SYRINX_KEYSTORE:-$HOME/.android/debug.keystore}"
KS_ALIAS="${SYRINX_KEY_ALIAS:-androiddebugkey}"
KS_PASS="${SYRINX_KEYSTORE_PASS:-android}"
KEY_PASS="${SYRINX_KEY_PASS:-$KS_PASS}"

if [ ! -f "$KS" ]; then
  echo "==> creating debug keystore at $KS"
  mkdir -p "$(dirname "$KS")"
  keytool -genkeypair -keystore "$KS" -storepass "$KS_PASS" -keypass "$KEY_PASS" \
    -alias "$KS_ALIAS" -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Android Debug,O=Android,C=US" >/dev/null 2>&1
fi

rm -rf "$OUT"
mkdir -p "$OUT/compiled" "$OUT/gen" "$OUT/classes" "$OUT/dex"

echo "==> resources"
"$BT/aapt2" compile --dir "$PROJ/res" -o "$OUT/compiled/res.zip"

echo "==> link"
"$BT/aapt2" link \
  -o "$OUT/base.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$PROJ/AndroidManifest.xml" \
  -A "$PROJ/assets" \
  --java "$OUT/gen" \
  --min-sdk-version 24 \
  --target-sdk-version 28 \
  --auto-add-overlay \
  "$OUT/compiled/res.zip"

echo "==> javac"
SRCS=$(find "$PROJ/src" "$OUT/gen" -name '*.java')
if ! javac --release 8 -classpath "$ANDROID_JAR" -d "$OUT/classes" $SRCS 2>"$OUT/javac.err"; then
  echo "    --release 8 failed, retrying with --release 11"
  cat "$OUT/javac.err"
  javac --release 11 -classpath "$ANDROID_JAR" -d "$OUT/classes" $SRCS
fi

echo "==> d8"
find "$OUT/classes" -name '*.class' > "$OUT/classes.list"
"$BT/d8" --min-api 24 --lib "$ANDROID_JAR" --output "$OUT/dex" @"$OUT/classes.list"

echo "==> package"
cp "$OUT/base.apk" "$OUT/unsigned.apk"
(cd "$OUT/dex" && zip -q -X "$OUT/unsigned.apk" classes.dex)

echo "==> align + sign"
"$BT/zipalign" -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
"$BT/apksigner" sign \
  --ks "$KS" --ks-key-alias "$KS_ALIAS" \
  --ks-pass "pass:$KS_PASS" --key-pass "pass:$KEY_PASS" \
  --min-sdk-version 24 \
  --out "$APK" "$OUT/aligned.apk"

echo "==> done: $APK"
ls -lh "$APK"
