package com.chanakya.txntrace

import android.app.ActivityManager
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.install.model.InstallStatus
import java.util.concurrent.TimeUnit

/**
 * Installs a downloaded Play Store update while the phone is idle.
 *
 * Installing replaces the package: the app is killed and cannot receive SMS for a few seconds.
 * Doing that the moment the user switches away would drop whatever they were in the middle of
 * (an OTP login, a sync) and line the gap up with the bank SMS for a payment they just left to
 * make, so the install waits until the phone has been sitting unused.
 */
class UpdateInstallJobService : JobService() {

    companion object {
        private const val JOB_ID = 53010

        // Safety net for phones that never report themselves idle
        private val MAX_WAIT_MS = TimeUnit.HOURS.toMillis(24)

        fun schedule(context: Context) {
            val job = JobInfo.Builder(JOB_ID, ComponentName(context, UpdateInstallJobService::class.java))
                .setRequiresDeviceIdle(true)
                .setOverrideDeadline(MAX_WAIT_MS)
                .build()
            context.getSystemService(JobScheduler::class.java)?.schedule(job)
        }
    }

    override fun onStartJob(params: JobParameters): Boolean {
        val appUpdateManager = AppUpdateManagerFactory.create(applicationContext)
        appUpdateManager.appUpdateInfo
            .addOnSuccessListener { info ->
                val status = info.installStatus()
                val downloading = status == InstallStatus.PENDING || status == InstallStatus.DOWNLOADING
                val downloaded = status == InstallStatus.DOWNLOADED
                val canInstall = downloaded && !isAppOnScreen() && !SmsHeadlessTaskService.isRunning
                if (canInstall) {
                    // With none of our activities visible, Play installs without showing any UI
                    appUpdateManager.completeUpdate()
                }
                // Whatever is still outstanding gets another go in a later idle window
                jobFinished(params, downloading || (downloaded && !canInstall))
            }
            .addOnFailureListener { jobFinished(params, true) }
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean = true

    private fun isAppOnScreen(): Boolean {
        val state = ActivityManager.RunningAppProcessInfo()
        ActivityManager.getMyMemoryState(state)
        return state.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE
    }
}
