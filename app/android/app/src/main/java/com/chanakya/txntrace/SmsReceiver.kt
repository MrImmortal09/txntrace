package com.chanakya.txntrace

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import com.facebook.react.HeadlessJsTaskService
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        try {
            val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
            if (messages.isNullOrEmpty()) return

            // Standard Android SMS chunks are split into array elements.
            // For a single SMS, we join the bodies.
            val body = messages.joinToString(separator = "") { it?.displayMessageBody ?: "" }
            if (body.isBlank()) return

            val sender = messages[0]?.displayOriginatingAddress ?: messages[0]?.originatingAddress ?: ""
            val timestamp = messages[0]?.timestampMillis ?: System.currentTimeMillis()

            val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            }
            val receivedAt = sdf.format(Date(timestamp))

            val serviceIntent = Intent(context, SmsHeadlessTaskService::class.java).apply {
                putExtra("sender", sender)
                putExtra("body", body)
                putExtra("receivedAt", receivedAt)
            }

            HeadlessJsTaskService.acquireWakeLockNow(context)
            context.startService(serviceIntent)
        } catch (t: Throwable) {
            Log.e("SmsReceiver", "Error receiving SMS", t)
        }
    }
}

