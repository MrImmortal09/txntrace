package com.chanakya.txntrace

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class SmsHeadlessTaskService : HeadlessJsTaskService() {
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
                5000, // timeout for the task
                true // optional: allowedInForeground
            )
        }
        return null
    }
}
