package com.chanakya.txntrace

import android.app.Activity
import android.content.Intent
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.android.play.core.appupdate.AppUpdateInfo
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.InstallState
import com.google.android.play.core.install.InstallStateUpdatedListener
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability

class PlayStoreUpdateModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    companion object {
        const val NAME = "PlayStoreUpdateModule"
        const val REQUEST_CODE_IMMEDIATE_UPDATE = 53001
        const val REQUEST_CODE_FLEXIBLE_UPDATE = 53002
    }

    private val appUpdateManager: AppUpdateManager by lazy {
        AppUpdateManagerFactory.create(reactContext)
    }

    private var pendingUpdatePromise: Promise? = null

    private val installStateUpdatedListener = InstallStateUpdatedListener { state: InstallState ->
        val params = Arguments.createMap().apply {
            putInt("installStatus", state.installStatus())
            putInt("installErrorCode", state.installErrorCode())
            putDouble("bytesDownloaded", state.bytesDownloaded().toDouble())
            putDouble("totalBytesToDownload", state.totalBytesToDownload().toDouble())
        }
        sendEvent("onInstallStateChanged", params)
    }

    init {
        reactContext.addActivityEventListener(this)
        appUpdateManager.registerListener(installStateUpdatedListener)
    }

    override fun getName(): String = NAME

    override fun invalidate() {
        super.invalidate()
        try {
            appUpdateManager.unregisterListener(installStateUpdatedListener)
            reactContext.removeActivityEventListener(this)
        } catch (ignored: Exception) {
        }
    }

    private fun sendEvent(eventName: String, params: WritableMap?) {
        if (reactContext.hasActiveReactInstance()) {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit(eventName, params)
        }
    }

    @ReactMethod
    fun checkForUpdate(promise: Promise) {
        try {
            appUpdateManager.appUpdateInfo
                .addOnSuccessListener { info: AppUpdateInfo ->
                    val result = Arguments.createMap().apply {
                        val isAvailable =
                            info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE
                        val inProgress =
                            info.updateAvailability() ==
                                UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS

                        putBoolean("updateAvailable", isAvailable)
                        putBoolean("developerTriggeredUpdateInProgress", inProgress)
                        putInt("availableVersionCode", info.availableVersionCode())
                        putBoolean(
                            "immediateAllowed",
                            info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)
                        )
                        putBoolean(
                            "flexibleAllowed",
                            info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)
                        )
                        putInt("updatePriority", info.updatePriority())
                        putInt("clientVersionStalenessDays", info.clientVersionStalenessDays() ?: 0)
                    }
                    promise.resolve(result)
                }
                .addOnFailureListener { e ->
                    promise.reject("CHECK_UPDATE_FAILED", e.message, e)
                }
        } catch (e: Exception) {
            promise.reject("CHECK_UPDATE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun startImmediateUpdate(promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "Current activity is null, cannot start immediate update.")
            return
        }

        try {
            appUpdateManager.appUpdateInfo
                .addOnSuccessListener { info: AppUpdateInfo ->
                    val isAvailable =
                        info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE ||
                            info.updateAvailability() ==
                                UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS

                    if (isAvailable && info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)) {
                        pendingUpdatePromise = promise
                        val options = AppUpdateOptions.newBuilder(AppUpdateType.IMMEDIATE).build()
                        val started =
                            appUpdateManager.startUpdateFlowForResult(
                                info,
                                activity,
                                options,
                                REQUEST_CODE_IMMEDIATE_UPDATE
                            )
                        if (!started) {
                            pendingUpdatePromise = null
                            promise.reject(
                                "UPDATE_FLOW_NOT_STARTED",
                                "Failed to start immediate update flow."
                            )
                        }
                    } else {
                        promise.reject(
                            "IMMEDIATE_UPDATE_NOT_ALLOWED",
                            "Immediate update is not allowed or not available."
                        )
                    }
                }
                .addOnFailureListener { e ->
                    promise.reject("APP_UPDATE_INFO_FAILED", e.message, e)
                }
        } catch (e: Exception) {
            promise.reject("START_UPDATE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun startFlexibleUpdate(promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "Current activity is null, cannot start flexible update.")
            return
        }

        try {
            appUpdateManager.appUpdateInfo
                .addOnSuccessListener { info: AppUpdateInfo ->
                    val isAvailable =
                        info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE

                    if (isAvailable && info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)) {
                        pendingUpdatePromise = promise
                        val options = AppUpdateOptions.newBuilder(AppUpdateType.FLEXIBLE).build()
                        val started =
                            appUpdateManager.startUpdateFlowForResult(
                                info,
                                activity,
                                options,
                                REQUEST_CODE_FLEXIBLE_UPDATE
                            )
                        if (!started) {
                            pendingUpdatePromise = null
                            promise.reject(
                                "UPDATE_FLOW_NOT_STARTED",
                                "Failed to start flexible update flow."
                            )
                        }
                    } else {
                        promise.reject(
                            "FLEXIBLE_UPDATE_NOT_ALLOWED",
                            "Flexible update is not allowed or not available."
                        )
                    }
                }
                .addOnFailureListener { e ->
                    promise.reject("APP_UPDATE_INFO_FAILED", e.message, e)
                }
        } catch (e: Exception) {
            promise.reject("START_UPDATE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun completeUpdate(promise: Promise) {
        try {
            appUpdateManager.completeUpdate()
                .addOnSuccessListener {
                    promise.resolve(true)
                }
                .addOnFailureListener { e ->
                    promise.reject("COMPLETE_UPDATE_FAILED", e.message, e)
                }
        } catch (e: Exception) {
            promise.reject("COMPLETE_UPDATE_ERROR", e.message, e)
        }
    }

    override fun onActivityResult(
        activity: Activity,
        requestCode: Int,
        resultCode: Int,
        data: Intent?
    ) {
        if (requestCode == REQUEST_CODE_IMMEDIATE_UPDATE || requestCode == REQUEST_CODE_FLEXIBLE_UPDATE) {
            val p = pendingUpdatePromise
            pendingUpdatePromise = null

            val isImmediate = requestCode == REQUEST_CODE_IMMEDIATE_UPDATE
            val eventName = if (isImmediate) "onImmediateUpdateResult" else "onFlexibleUpdateResult"

            when (resultCode) {
                Activity.RESULT_OK -> {
                    p?.resolve(true)
                    sendEvent(eventName, Arguments.createMap().apply {
                        putString("status", "RESULT_OK")
                    })
                }
                Activity.RESULT_CANCELED -> {
                    p?.resolve(false)
                    sendEvent(eventName, Arguments.createMap().apply {
                        putString("status", "RESULT_CANCELED")
                    })
                }
                else -> {
                    p?.reject("UPDATE_FAILED", "Update flow failed with result code: $resultCode")
                    sendEvent(eventName, Arguments.createMap().apply {
                        putString("status", "RESULT_FAILED")
                        putInt("resultCode", resultCode)
                    })
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        // No-op
    }
}
