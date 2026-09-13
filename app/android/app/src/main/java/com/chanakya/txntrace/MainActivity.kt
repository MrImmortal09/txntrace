package com.chanakya.txntrace

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.UpdateAvailability

class MainActivity : ReactActivity() {

  private var appUpdateManager: AppUpdateManager? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    appUpdateManager = AppUpdateManagerFactory.create(this)
  }

  override fun onResume() {
    super.onResume()
    appUpdateManager?.appUpdateInfo?.addOnSuccessListener { appUpdateInfo ->
      if (appUpdateInfo.updateAvailability() ==
          UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS
      ) {
        // If an immediate update is already in progress, resume it
        appUpdateManager?.startUpdateFlowForResult(
          appUpdateInfo,
          this,
          AppUpdateOptions.newBuilder(AppUpdateType.IMMEDIATE).build(),
          PlayStoreUpdateModule.REQUEST_CODE_IMMEDIATE_UPDATE
        )
      }
    }
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "TxnTrace"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
