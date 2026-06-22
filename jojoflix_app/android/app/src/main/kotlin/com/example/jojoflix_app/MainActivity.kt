package com.rasjojo.jojoflix

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Rational
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity(), MethodChannel.MethodCallHandler {
    companion object {
        private const val CHANNEL_NAME = "jojoflix/native_playback"
        private const val NOTIFICATION_CHANNEL_ID = "jojoflix_playback"
        private const val NOTIFICATION_CHANNEL_NAME = "Lecture JojoFlix"
        private const val NOTIFICATION_ID = 42042

        const val ACTION_PLAY = "com.rasjojo.jojoflix.action.PLAY"
        const val ACTION_PAUSE = "com.rasjojo.jojoflix.action.PAUSE"
        const val ACTION_TOGGLE = "com.rasjojo.jojoflix.action.TOGGLE"
        const val ACTION_REWIND = "com.rasjojo.jojoflix.action.REWIND"
        const val ACTION_FAST_FORWARD = "com.rasjojo.jojoflix.action.FAST_FORWARD"

        private var activeInstance: MainActivity? = null

        fun dispatchPlaybackAction(action: String) {
            activeInstance?.postFlutterCommand(
                when (action) {
                    ACTION_PLAY -> "play"
                    ACTION_PAUSE -> "pause"
                    ACTION_TOGGLE -> "toggle"
                    ACTION_REWIND -> "seekBy"
                    ACTION_FAST_FORWARD -> "seekBy"
                    else -> return
                },
                deltaMs = when (action) {
                    ACTION_REWIND -> -15_000L
                    ACTION_FAST_FORWARD -> 15_000L
                    else -> null
                }
            )
        }
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    private var channel: MethodChannel? = null
    private var mediaSession: MediaSessionCompat? = null

    private var playerActive: Boolean = false
    private var pictureInPictureEnabled: Boolean = false
    private var isPlaying: Boolean = false
    private var isInPictureInPicture: Boolean = false
    private var title: String = "Jojoflix"
    private var subtitle: String = ""
    private var artworkUrl: String? = null
    private var positionMs: Long = 0L
    private var durationMs: Long = 0L
    private var videoWidth: Int = 16
    private var videoHeight: Int = 9

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        activeInstance = this
        createNotificationChannel()
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        channel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL_NAME)
        channel?.setMethodCallHandler(this)
    }

    override fun onDestroy() {
        if (activeInstance === this) {
            activeInstance = null
        }
        if (isFinishing) {
            deactivatePlaybackInternal()
            mediaSession?.release()
            mediaSession = null
        }
        channel?.setMethodCallHandler(null)
        channel = null
        super.onDestroy()
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "updatePlayback" -> {
                @Suppress("UNCHECKED_CAST")
                val args = call.arguments as? Map<String, Any?> ?: emptyMap()
                updatePlaybackState(args)
                result.success(null)
            }
            "deactivatePlayback" -> {
                deactivatePlaybackInternal()
                result.success(null)
            }
            "setPictureInPictureEnabled" -> {
                val args = call.arguments as? Map<*, *>
                pictureInPictureEnabled = args?.get("enabled") == true
                updatePictureInPictureParams()
                result.success(null)
            }
            "enterPictureInPicture" -> {
                result.success(enterPictureInPictureIfPossible())
            }
            else -> result.notImplemented()
        }
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            enterPictureInPictureIfPossible()
        }
    }

    override fun onPictureInPictureModeChanged(
        isInPictureInPictureMode: Boolean,
        newConfig: Configuration,
    ) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        isInPictureInPicture = isInPictureInPictureMode
        mainHandler.post {
            channel?.invokeMethod(
                "pictureInPictureChanged",
                mapOf("enabled" to isInPictureInPictureMode)
            )
        }
    }

    private fun updatePlaybackState(args: Map<String, Any?>) {
        playerActive = args["active"] as? Boolean ?: playerActive
        isPlaying = args["isPlaying"] as? Boolean ?: isPlaying
        title = (args["title"] as? String)?.takeIf { it.isNotBlank() } ?: "Jojoflix"
        subtitle = (args["subtitle"] as? String).orEmpty()
        artworkUrl = args["artworkUrl"] as? String
        positionMs = (args["positionMs"] as? Number)?.toLong() ?: positionMs
        durationMs = (args["durationMs"] as? Number)?.toLong() ?: durationMs
        videoWidth = ((args["videoWidth"] as? Number)?.toInt() ?: videoWidth).coerceAtLeast(1)
        videoHeight = ((args["videoHeight"] as? Number)?.toInt() ?: videoHeight).coerceAtLeast(1)

        if (!playerActive) {
            deactivatePlaybackInternal()
            return
        }

        ensureMediaSession()
        updateMediaSession()
        updatePictureInPictureParams()
        showNotification()
    }

    private fun ensureMediaSession() {
        if (mediaSession != null) {
            return
        }

        mediaSession = MediaSessionCompat(this, "JojoflixPlayback").apply {
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() {
                    dispatchPlaybackAction(ACTION_PLAY)
                }

                override fun onPause() {
                    dispatchPlaybackAction(ACTION_PAUSE)
                }

                override fun onFastForward() {
                    dispatchPlaybackAction(ACTION_FAST_FORWARD)
                }

                override fun onRewind() {
                    dispatchPlaybackAction(ACTION_REWIND)
                }

                override fun onSeekTo(pos: Long) {
                    postFlutterCommand("seekTo", positionMs = pos)
                }
            })
            isActive = true
        }
    }

    private fun updateMediaSession() {
        val session = mediaSession ?: return
        session.setMetadata(
            MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, subtitle)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs)
                .build()
        )
        session.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setActions(
                    PlaybackStateCompat.ACTION_PLAY or
                        PlaybackStateCompat.ACTION_PAUSE or
                        PlaybackStateCompat.ACTION_PLAY_PAUSE or
                        PlaybackStateCompat.ACTION_FAST_FORWARD or
                        PlaybackStateCompat.ACTION_REWIND or
                        PlaybackStateCompat.ACTION_SEEK_TO
                )
                .setState(
                    if (isPlaying) {
                        PlaybackStateCompat.STATE_PLAYING
                    } else {
                        PlaybackStateCompat.STATE_PAUSED
                    },
                    positionMs,
                    if (isPlaying) 1.0f else 0.0f,
                )
                .build()
        )
        session.isActive = true
    }

    private fun showNotification() {
        val session = mediaSession ?: return
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentIntent = launchIntent?.let {
            PendingIntent.getActivity(
                this,
                200,
                it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }

        val builder = NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(title)
            .setContentText(subtitle.ifBlank { "Lecture en cours" })
            .setContentIntent(contentIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setOngoing(isPlaying)
            .addAction(
                NotificationCompat.Action(
                    android.R.drawable.ic_media_rew,
                    "-15s",
                    playbackBroadcastIntent(ACTION_REWIND, 301),
                )
            )
            .addAction(
                NotificationCompat.Action(
                    if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                    if (isPlaying) "Pause" else "Lecture",
                    playbackBroadcastIntent(if (isPlaying) ACTION_PAUSE else ACTION_PLAY, 302),
                )
            )
            .addAction(
                NotificationCompat.Action(
                    android.R.drawable.ic_media_ff,
                    "+15s",
                    playbackBroadcastIntent(ACTION_FAST_FORWARD, 303),
                )
            )
            .setStyle(
                androidx.media.app.NotificationCompat.MediaStyle()
                    .setMediaSession(session.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2)
            )

        try {
            NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, builder.build())
        } catch (_: SecurityException) {
            // Notifications refusées ou politique système restrictive.
        }
    }

    private fun deactivatePlaybackInternal() {
        playerActive = false
        isPlaying = false
        isInPictureInPicture = false
        NotificationManagerCompat.from(this).cancel(NOTIFICATION_ID)
        mediaSession?.isActive = false
        mainHandler.post {
            channel?.invokeMethod(
                "pictureInPictureChanged",
                mapOf("enabled" to false)
            )
        }
    }

    private fun playbackBroadcastIntent(action: String, requestCode: Int): PendingIntent {
        val intent = Intent(this, PlaybackActionReceiver::class.java).apply {
            this.action = action
            setPackage(packageName)
        }
        return PendingIntent.getBroadcast(
            this,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }

        val channel = NotificationChannel(
            NOTIFICATION_CHANNEL_ID,
            NOTIFICATION_CHANNEL_NAME,
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Contrôles de lecture JojoFlix"
            setShowBadge(false)
        }
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(channel)
    }

    private fun updatePictureInPictureParams() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }

        val builder = PictureInPictureParams.Builder()
            .setAspectRatio(Rational(videoWidth.coerceAtLeast(1), videoHeight.coerceAtLeast(1)))
            .setActions(
                listOf(
                    remoteAction(
                        requestCode = 401,
                        action = ACTION_REWIND,
                        title = "-15s",
                        iconRes = android.R.drawable.ic_media_rew,
                    ),
                    remoteAction(
                        requestCode = 402,
                        action = if (isPlaying) ACTION_PAUSE else ACTION_PLAY,
                        title = if (isPlaying) "Pause" else "Lecture",
                        iconRes = if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                    ),
                    remoteAction(
                        requestCode = 403,
                        action = ACTION_FAST_FORWARD,
                        title = "+15s",
                        iconRes = android.R.drawable.ic_media_ff,
                    ),
                )
            )

        setPictureInPictureParams(builder.build())
    }

    private fun remoteAction(
        requestCode: Int,
        action: String,
        title: String,
        iconRes: Int,
    ): RemoteAction {
        val pendingIntent = playbackBroadcastIntent(action, requestCode)
        return RemoteAction(
            Icon.createWithResource(this, iconRes),
            title,
            title,
            pendingIntent,
        )
    }

    private fun enterPictureInPictureIfPossible(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return false
        }
        if (!pictureInPictureEnabled || !playerActive || !isPlaying || isInPictureInPicture) {
            return false
        }
        updatePictureInPictureParams()
        enterPictureInPictureMode()
        return true
    }

    private fun postFlutterCommand(
        action: String,
        deltaMs: Long? = null,
        positionMs: Long? = null,
    ) {
        mainHandler.post {
            val arguments = mutableMapOf<String, Any>("action" to action)
            if (deltaMs != null) {
                arguments["deltaMs"] = deltaMs
            }
            if (positionMs != null) {
                arguments["positionMs"] = positionMs
            }
            channel?.invokeMethod("command", arguments)
        }
    }
}
