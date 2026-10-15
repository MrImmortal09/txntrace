# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# op-sqlite: its JNI_OnLoad registers native methods on com.op.sqlite.OPSQLiteBridge by
# class name, so the package must keep its original names.
-keep class com.op.sqlite.** { *; }

# App code: manifest components, the headless SMS task and the Play update module. Tiny, and
# keeping it unrenamed means our own stack traces stay readable.
-keep class com.chanakya.txntrace.** { *; }
