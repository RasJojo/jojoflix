package com.rasjojo.jojoflix

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class PlaybackActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        MainActivity.dispatchPlaybackAction(action)
    }
}
