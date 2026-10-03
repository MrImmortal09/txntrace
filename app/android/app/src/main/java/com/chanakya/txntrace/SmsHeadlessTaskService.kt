package com.chanakya.txntrace

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class SmsHeadlessTaskService : HeadlessJsTaskService() {

    companion object {
        /** True from an SMS arriving until its JS task has finished; the service stops itself then. */
        @Volatile
        var isRunning = false
            private set
    }

    override fun onCreate() {
        super.onCreate()
        isRunning = true
    }

    override fun onDestroy() {
        isRunning = false
        super.onDestroy()
    }

    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
        val extras = intent?.extras ?: return null
        
        val sender = extras.getString("sender")
        val body = extras.getString("body")
        val receivedAt = extras.getString("receivedAt")

        if (sender != null && body != null) {
            val params = Arguments.createMap()
            params.putString("sender", sender)
            params.putString("body", body)
            params.putString("receivedAt", receivedAt)

            return HeadlessJsTaskConfig(
                "SmsTask",
                params,
                15000L, // timeout for the task (allows cold-start RN context initialization)
                true // optional: allowedInForeground
            )
        }
        return null
    }
}
