package com.chanakya.txntrace

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Telephony
import android.util.Log

class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        try {
            val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
            if (messages.isEmpty()) return

            // Standard Android SMS chunks are split into array elements.
            // For a single SMS, we join the bodies.
            val sender = messages[0]?.displayOriginatingAddress ?: return
            val body = messages.joinToString(separator = "") { it?.displayMessageBody ?: "" }
            val timestamp = messages[0]?.timestampMillis ?: System.currentTimeMillis()

            val serviceIntent = Intent(context, SmsHeadlessTaskService::class.java)
            serviceIntent.putExtra("sender", sender)
            serviceIntent.putExtra("body", body)
            serviceIntent.putExtra("receivedAt", java.util.Date(timestamp).toInstant().toString())

            context.startService(serviceIntent)
            
            // If Android O or above and the app is completely killed, we might need startForegroundService,
            // but HeadlessJsTaskService handles wakelocks properly if started in background limits,
            // or we might need to handle it via a foreground service if background execution limits apply.
            // For now, startService usually works for SMS broadcast receivers because they are exempt or briefly whitelisted.
        } catch (e: Exception) {
            Log.e("SmsReceiver", "Error receiving SMS", e)
        }
    }
}
