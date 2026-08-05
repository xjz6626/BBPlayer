package expo.modules.orpheus.service

import android.app.PendingIntent
import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.annotation.OptIn
import androidx.core.net.toUri
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.CommandButton
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import expo.modules.orpheus.R
import expo.modules.orpheus.manager.FloatingLyricsManager
import expo.modules.orpheus.manager.LyricsConsumer
import expo.modules.orpheus.manager.LyriconBackend
import expo.modules.orpheus.manager.MeizuStatusBarLyricsBackend
import expo.modules.orpheus.manager.StatusBarLyricsManager
import expo.modules.orpheus.manager.SuperLyricBackend
import expo.modules.orpheus.manager.TrackAudioEffectManager
import expo.modules.orpheus.manager.UnifiedLyricsManager
import expo.modules.orpheus.model.LyricsData
import expo.modules.orpheus.model.LyricsLine
import expo.modules.orpheus.model.TrackRecord
import expo.modules.orpheus.util.CustomCommands
import expo.modules.orpheus.util.DownloadUtil
import expo.modules.orpheus.util.GeneralStorage
import expo.modules.orpheus.util.GlideBitmapLoader
import expo.modules.orpheus.util.LoudnessStorage
import expo.modules.orpheus.util.SleepTimeController
import expo.modules.orpheus.util.TrackAudioEffectStorage
import expo.modules.orpheus.util.calculateLoudnessGain
import expo.modules.orpheus.util.fadeInTo
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.math.abs

class OrpheusMusicService : MediaLibraryService() {

    var player: ExoPlayer? = null
    private var mediaSession: MediaLibrarySession? = null
    private var sleepTimerManager: SleepTimeController? = null
    private var volumeFadeJob: Job? = null
    private var currentLoudnessGain = 1.0f
    private var scope = MainScope()
    private val trackAudioEffectManager = TrackAudioEffectManager()

    lateinit var floatingLyricsManager: FloatingLyricsManager
    lateinit var statusBarLyricsManager: StatusBarLyricsManager
    private val serviceHandler = android.os.Handler(android.os.Looper.getMainLooper())

    private var lastTrackFinishedAt: Long = 0
    private var lastFinishedMediaId: String? = null
    private val durationCache = mutableMapOf<String, Long>()
    lateinit var shuffleManager: ShuffleManager
    lateinit var lyricsManager: UnifiedLyricsManager
    private var currentMediaId: String? = null
    private val json = Json { ignoreUnknownKeys = true }

    private val lyricsUpdateRunnable = object : Runnable {
        override fun run() {
            player?.let { p ->
                if (p.isPlaying) {
                    val seconds = p.currentPosition / 1000.0
                    lyricsManager.updateTime(seconds)
                }
            }
            serviceHandler.postDelayed(this, 200)
        }
    }

    companion object {
        var instance: OrpheusMusicService? = null
            private set(value) {
                field = value
                if (value != null) {
                    listeners.forEach { it(value) }
                }
            }

        private val listeners = CopyOnWriteArrayList<(OrpheusMusicService) -> Unit>()

        fun addOnServiceReadyListener(listener: (OrpheusMusicService) -> Unit) {
            instance?.let { listener(it) }
            listeners.add(listener)
        }

        fun removeOnServiceReadyListener(listener: (OrpheusMusicService) -> Unit) {
            listeners.remove(listener)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        return START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        val player = mediaSession?.player
        if (player == null || !player.playWhenReady || player.mediaItemCount == 0) {
            stopSelf()
        }
        super.onTaskRemoved(rootIntent)
    }

    override fun onUpdateNotification(session: MediaSession, startInForegroundRequired: Boolean) {
        super.onUpdateNotification(session, true)
    }

    @OptIn(UnstableApi::class)
    override fun onCreate() {
        super.onCreate()
        instance = this

        GeneralStorage.initialize(this)
        LoudnessStorage.initialize(this)
        TrackAudioEffectStorage.initialize(this)

        setMediaNotificationProvider(object : DefaultMediaNotificationProvider(this) {
            override fun getMediaButtons(
                session: MediaSession,
                playerCommands: Player.Commands,
                customLayout: ImmutableList<CommandButton>,
                showPlaying: Boolean
            ): ImmutableList<CommandButton> {
                val builder = ImmutableList.builder<CommandButton>()
                val player = session.player

                // Previous
                builder.add(
                    CommandButton.Builder(CommandButton.ICON_UNDEFINED)
                        .setPlayerCommand(Player.COMMAND_SEEK_TO_PREVIOUS)
                        .setCustomIconResId(R.drawable.outline_skip_previous_24)
                        .setDisplayName("Previous")
                        .setEnabled(playerCommands.contains(Player.COMMAND_SEEK_TO_PREVIOUS))
                        .build()
                )

                // Play/Pause
                if (showPlaying) {
                    builder.add(
                        CommandButton.Builder(CommandButton.ICON_UNDEFINED)
                            .setPlayerCommand(Player.COMMAND_PLAY_PAUSE)
                            .setCustomIconResId(R.drawable.outline_pause_24)
                            .setDisplayName("Pause")
                            .setEnabled(playerCommands.contains(Player.COMMAND_PLAY_PAUSE))
                            .build()
                    )
                } else {
                    builder.add(
                        CommandButton.Builder(CommandButton.ICON_UNDEFINED)
                            .setPlayerCommand(Player.COMMAND_PLAY_PAUSE)
                            .setCustomIconResId(R.drawable.outline_play_arrow_24)
                            .setDisplayName("Play")
                            .setEnabled(playerCommands.contains(Player.COMMAND_PLAY_PAUSE))
                            .build()
                    )
                }

                // Next
                builder.add(
                    CommandButton.Builder(CommandButton.ICON_UNDEFINED)
                        .setPlayerCommand(Player.COMMAND_SEEK_TO_NEXT)
                        .setCustomIconResId(R.drawable.outline_skip_next_24)
                        .setDisplayName("Next")
                        .setEnabled(playerCommands.contains(Player.COMMAND_SEEK_TO_NEXT))
                        .build()
                )

                // Repeat Mode Toggle
                val repeatIcon = when (player.repeatMode) {
                    Player.REPEAT_MODE_ONE -> R.drawable.outline_repeat_one_24
                    Player.REPEAT_MODE_ALL -> R.drawable.outline_repeat_24
                    else -> R.drawable.outline_repeat_off_24
                }

                builder.add(
                    CommandButton.Builder(CommandButton.ICON_UNDEFINED)
                        .setSessionCommand(
                            SessionCommand(
                                CustomCommands.CMD_TOGGLE_REPEAT_MODE,
                                Bundle.EMPTY
                            )
                        )
                        .setCustomIconResId(repeatIcon)
                        .setDisplayName("Repeat Mode")
                        .setEnabled(true)
                        .build()
                )

                return builder.build()
            }
        })

        initializePlayer()
    }

    /**
     * 创建/重建 ExoPlayer、MediaSession 及相关组件。
     * 可多次调用，每次调用前应确保旧 player 已释放或为 null。
     */
    @OptIn(UnstableApi::class)
    private fun initializePlayer() {
        val dataSourceFactory = DownloadUtil.getPlayerDataSourceFactory(this)

        val mediaSourceFactory = DefaultMediaSourceFactory(this)
            .setDataSourceFactory(dataSourceFactory)

        val renderersFactory = DefaultRenderersFactory(this)
            .experimentalSetMediaCodecAsyncCryptoFlagEnabled(false)

        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(
                DefaultLoadControl.DEFAULT_MIN_BUFFER_MS,
                DefaultLoadControl.DEFAULT_MAX_BUFFER_MS,
                1_000,
                2_000
            )
            .build()

        player = ExoPlayer.Builder(this, renderersFactory)
            .setMediaSourceFactory(mediaSourceFactory)
            .setLoadControl(loadControl)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                    .build(),
                true
            )
            .setHandleAudioBecomingNoisy(true)
            .build()

        shuffleManager = ShuffleManager { player }

        floatingLyricsManager = FloatingLyricsManager(this, player)
        floatingLyricsManager.onClearLyricsRequested = { trackId ->
            lyricEventListeners.forEach { it.onLyricCleared(trackId) }
            sendRequestClearLyricsEvent(trackId)
        }
        if (GeneralStorage.isDesktopLyricsShown()) {
            serviceHandler.post { floatingLyricsManager.show() }
        }

        statusBarLyricsManager = StatusBarLyricsManager(this)
        statusBarLyricsManager.backend = createStatusBarBackend(GeneralStorage.getStatusBarLyricsProvider())
        statusBarLyricsManager.enabled = GeneralStorage.isStatusBarLyricsEnabled()
        lyricsManager = UnifiedLyricsManager(
            floatingLyricsManager = floatingLyricsManager,
            statusBarLyricsManager = statusBarLyricsManager,
            currentPlaybackSeconds = { player?.currentPosition?.toDouble()?.div(1000.0) },
            onCarLyricsChanged = ::updateCurrentMetadata,
        )

        setupListeners()

        var launchIntent = packageManager.getLaunchIntentForPackage(packageName)

        if (launchIntent == null) {
            launchIntent = Intent().apply {
                setClassName(packageName, "$packageName.MainActivity")
            }
        }

        launchIntent.apply {
            action = Intent.ACTION_VIEW
            data = "orpheus://player".toUri()
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }

        val contentIntent = launchIntent.let {
            PendingIntent.getActivity(
                this,
                0,
                it,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
        }

        mediaSession = MediaLibrarySession.Builder(this, player!!, callback)
            .setId("OrpheusSession")
            .setSessionActivity(contentIntent)
            .setBitmapLoader(GlideBitmapLoader(this))
            .build()

        restorePlayerState(GeneralStorage.isRestoreEnabled())
        sleepTimerManager = SleepTimeController(player!!)
    }

    /**
     * 检查 player 是否存在，不存在则重建。
     * 供外部（如 ExpoOrpheusModule）调用。
     */
    @OptIn(UnstableApi::class)
    fun ensurePlayer(): ExoPlayer {
        if (player == null) {
            Log.w("OrpheusMusicService", "Player was null, reinitializing...")
            initializePlayer()
        }
        return player!!
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? {
        return mediaSession
    }

    override fun onDestroy() {
        serviceHandler.removeCallbacks(lyricsUpdateRunnable)
        floatingLyricsManager.hide()
        statusBarLyricsManager.onStop()
        volumeFadeJob?.cancel()
        trackAudioEffectManager.release()
        scope.cancel()
        instance = null

        mediaSession?.run {
            player.release()
            release()
            mediaSession = null
        }
        this.player = null
        super.onDestroy()
    }

    /**
     * Enable or disable shuffle mode. Delegates to ShuffleManager which uses
     * Media3's built-in shuffleModeEnabled flag for zero-cost queue traversal.
     */
    fun applyShuffleMode(enabled: Boolean) {
        shuffleManager.setShuffleEnabled(enabled)
    }

    fun startSleepTimer(durationMs: Long) {
        sleepTimerManager?.start(durationMs)
    }

    fun cancelSleepTimer() {
        sleepTimerManager?.cancel()
    }

    fun getSleepTimerRemaining(): Long? {
        return sleepTimerManager?.getStopTimeMs()
    }

    var callback: MediaLibrarySession.Callback = @UnstableApi
    object : MediaLibrarySession.Callback {

        @OptIn(UnstableApi::class)
        override fun onConnect(
            session: MediaSession,
            controller: MediaSession.ControllerInfo
        ): MediaSession.ConnectionResult {
            val sessionCommands = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon()
                .add(SessionCommand(CustomCommands.CMD_TOGGLE_REPEAT_MODE, Bundle.EMPTY))
                .build()

            return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                .setAvailableSessionCommands(sessionCommands)
                .build()
        }

        @OptIn(UnstableApi::class)
        override fun onCustomCommand(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
            customCommand: SessionCommand,
            args: Bundle
        ): ListenableFuture<SessionResult> {
            if (customCommand.customAction == CustomCommands.CMD_TOGGLE_REPEAT_MODE) {
                val player = session.player
                val newMode = when (player.repeatMode) {
                    Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL
                    Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE
                    Player.REPEAT_MODE_ONE -> Player.REPEAT_MODE_OFF
                    else -> Player.REPEAT_MODE_OFF
                }
                player.repeatMode = newMode
                return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
            }
            return super.onCustomCommand(session, controller, customCommand, args)
        }

        override fun onPlaybackResumption(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            isPlayback: Boolean
        ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            return Futures.immediateFuture(
                MediaSession.MediaItemsWithStartPosition(
                    emptyList(), // 没有媒体项
                    C.INDEX_UNSET, // 索引未定
                    C.TIME_UNSET   // 进度未定
                )
            )
        }
    }

    @OptIn(UnstableApi::class)
    private fun restorePlayerState(restorePosition: Boolean) {
        val player = player ?: return

        val restoredItems = GeneralStorage.restoreQueue(this)

        if (restoredItems.isNotEmpty()) {
            val savedIndex = GeneralStorage.getSavedIndex()
            val savedPosition = GeneralStorage.getSavedPosition()
            val savedShuffleMode = GeneralStorage.getShuffleMode()
            val savedRepeatMode = GeneralStorage.getRepeatMode()
            val savedMediaId = restoredItems.getOrNull(savedIndex)?.mediaId
            val uniqueRestoredItems = restoredItems.distinctBy { item -> item.mediaId }
            val queueWasDeduplicated = uniqueRestoredItems.size != restoredItems.size

            if (queueWasDeduplicated) {
                Log.i(
                    "OrpheusMusicService",
                    "Removed ${restoredItems.size - uniqueRestoredItems.size} duplicate queue items during restore"
                )
                GeneralStorage.saveQueue(uniqueRestoredItems)
            }

            player.setMediaItems(uniqueRestoredItems)

            val restoredIndex = savedMediaId
                ?.let { mediaId -> uniqueRestoredItems.indexOfFirst { item -> item.mediaId == mediaId } }
                ?: C.INDEX_UNSET

            if (restoredIndex != C.INDEX_UNSET) {
                if (queueWasDeduplicated) {
                    GeneralStorage.savePosition(restoredIndex, savedPosition)
                }
                player.seekTo(restoredIndex, if (restorePosition) savedPosition else C.TIME_UNSET)
            } else {
                if (queueWasDeduplicated) {
                    GeneralStorage.savePosition(0, 0L)
                }
                player.seekTo(0, 0L)
            }

            // Restore shuffle state without re-shuffling the saved queue order
            shuffleManager.restoreShuffleEnabled(savedShuffleMode)
            player.repeatMode = savedRepeatMode

            currentMediaId = player.currentMediaItem?.mediaId

            player.playWhenReady = GeneralStorage.isAutoplayOnStartEnabled()
            player.prepare()

            // 软件冷启动时，恢复的歌曲并不会触发 onMediaTransition 事件，我们需要手动补发一个
            if (player.currentMediaItem != null) {
                sendTrackStartEvent(
                    player.currentMediaItem,
                    Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED
                )
            }
        }
    }

    interface TrackEventListener {
        fun onTrackStarted(trackId: String, reason: Int)
        fun onTrackFinished(trackId: String, finalPosition: Double, duration: Double)
    }

    interface LyricEventListener {
        fun onLyricCleared(trackId: String)
    }

    private val trackEventListeners = CopyOnWriteArrayList<TrackEventListener>()
    private val lyricEventListeners = CopyOnWriteArrayList<LyricEventListener>()

    fun addTrackEventListener(listener: TrackEventListener) {
        trackEventListeners.add(listener)
    }

    fun removeTrackEventListener(listener: TrackEventListener) {
        trackEventListeners.remove(listener)
    }

    fun addLyricEventListener(listener: LyricEventListener) {
        lyricEventListeners.add(listener)
    }

    fun removeLyricEventListener(listener: LyricEventListener) {
        lyricEventListeners.remove(listener)
    }

    @OptIn(UnstableApi::class)
    private fun sendTrackStartEvent(mediaItem: androidx.media3.common.MediaItem?, reason: Int) {
        if (mediaItem == null) return

        // Notify local listeners
        trackEventListeners.forEach { it.onTrackStarted(mediaItem.mediaId, reason) }

        try {
            val intent = Intent(this, OrpheusHeadlessTaskService::class.java)
            intent.putExtra("eventName", "onTrackStarted")
            intent.putExtra("trackId", mediaItem.mediaId)
            intent.putExtra("reason", reason)
            startService(intent)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun sendTrackFinishedEvent(trackId: String, finalPosition: Double, duration: Double) {
        // Notify local listeners
        trackEventListeners.forEach { it.onTrackFinished(trackId, finalPosition, duration) }

        try {
            val intent = Intent(this, OrpheusHeadlessTaskService::class.java)
            intent.putExtra("eventName", "onTrackFinished")
            intent.putExtra("trackId", trackId)
            intent.putExtra("finalPosition", finalPosition)
            intent.putExtra("duration", duration)
            startService(intent)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun resolveDurationMs(mediaItem: MediaItem, runtimeDurationMs: Long = C.TIME_UNSET): Long? {
        if (runtimeDurationMs != C.TIME_UNSET && runtimeDurationMs > 0) {
            durationCache[mediaItem.mediaId] = runtimeDurationMs
            return runtimeDurationMs
        }

        durationCache[mediaItem.mediaId]?.let { return it }
        return extractTrackRecord(mediaItem)?.duration
            ?.takeIf { it > 0 }
            ?.times(1000)
            ?.toLong()
    }

    private fun finishTrack(
        mediaItem: MediaItem,
        finalPositionMs: Long,
        runtimeDurationMs: Long = C.TIME_UNSET
    ) {
        val durationMs = resolveDurationMs(mediaItem, runtimeDurationMs) ?: return
        val currentTime = System.currentTimeMillis()
        if (
            mediaItem.mediaId == lastFinishedMediaId &&
            currentTime - lastTrackFinishedAt < 500
        ) {
            return
        }

        lastFinishedMediaId = mediaItem.mediaId
        lastTrackFinishedAt = currentTime
        sendTrackFinishedEvent(
            mediaItem.mediaId,
            finalPositionMs.coerceAtLeast(0) / 1000.0,
            durationMs / 1000.0
        )
    }

    private fun sendTrackPausedEvent() {
        try {
            val intent = Intent(this, OrpheusHeadlessTaskService::class.java)
            intent.putExtra("eventName", "onTrackPaused")
            startService(intent)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun sendTrackResumedEvent() {
        try {
            val intent = Intent(this, OrpheusHeadlessTaskService::class.java)
            intent.putExtra("eventName", "onTrackResumed")
            startService(intent)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun sendRequestClearLyricsEvent(trackId: String) {
        try {
            val intent = Intent(this, OrpheusHeadlessTaskService::class.java)
            intent.putExtra("eventName", "onRequestClearLyrics")
            intent.putExtra("trackId", trackId)
            startService(intent)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun setupListeners() {
        player?.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                android.util.Log.d("StatusBarLyrics", "[Service] onIsPlayingChanged: $isPlaying | state=${player?.playbackState} mediaId=${player?.currentMediaItem?.mediaId}")
                lyricsManager.setPlaybackState(isPlaying)
                if (isPlaying) {
                    serviceHandler.removeCallbacks(lyricsUpdateRunnable)
                    serviceHandler.post(lyricsUpdateRunnable)
                    sendTrackResumedEvent()
                } else {
                    serviceHandler.removeCallbacks(lyricsUpdateRunnable)
                    sendTrackPausedEvent()
                }
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                val currentPlayer = player ?: return
                val currentItem = currentPlayer.currentMediaItem ?: return
                if (playbackState == Player.STATE_READY) {
                    resolveDurationMs(currentItem, currentPlayer.duration)
                } else if (playbackState == Player.STATE_ENDED) {
                    finishTrack(
                        currentItem,
                        currentPlayer.currentPosition,
                        currentPlayer.duration
                    )
                }
            }

            @OptIn(UnstableApi::class)
            override fun onMediaItemTransition(
                mediaItem: androidx.media3.common.MediaItem?,
                reason: Int
            ) {
                val mediaId = mediaItem?.mediaId
                val reasonStr = when (reason) {
                    Player.MEDIA_ITEM_TRANSITION_REASON_AUTO -> "AUTO"
                    Player.MEDIA_ITEM_TRANSITION_REASON_SEEK -> "SEEK"
                    Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED -> "PLAYLIST_CHANGED"
                    Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT -> "REPEAT"
                    else -> "UNKNOWN($reason)"
                }
                android.util.Log.d("StatusBarLyrics", "[Service] onMediaItemTransition: id=$mediaId reason=$reasonStr ts=${System.currentTimeMillis()}")

                // If the same track is still current (e.g. an item was added/removed elsewhere
                // in the queue causing a PLAYLIST_CHANGED transition with the same media ID),
                // we should NOT reset lyrics or notify JS as it causes a UI flash and audio stutter.
                if (reason != Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT && mediaId == currentMediaId) {
                    Log.d("OrpheusMusicService", "Ignoring onMediaItemTransition as track hasn't changed.")
                    saveCurrentQueue()
                    prefetchNextTrack()
                    return
                }
                currentMediaId = mediaId

                sendTrackStartEvent(mediaItem, reason)

                lyricsManager.clearConsumers(LyricsConsumer.all())
                lyricsManager.setPlaybackState(player?.isPlaying == true)
                floatingLyricsManager.syncTrackInfo()

                saveCurrentQueue()
                prefetchNextTrack()
                val uri = mediaItem?.localConfiguration?.uri?.toString()
                val volumeData = uri?.let(LoudnessStorage::getLoudnessData) ?: 0.0
                applyVolumeForCurrentItem(volumeData)
            }

            @OptIn(UnstableApi::class)
            override fun onAudioSessionIdChanged(audioSessionId: Int) {
                if (audioSessionId != C.AUDIO_SESSION_ID_UNSET) {
                    applyCurrentTrackAudioEffects(animateVolume = false)
                }
            }

            override fun onTimelineChanged(timeline: Timeline, reason: Int) {
                saveCurrentQueue()
                val player = player ?: return
                prefetchNextTrack()
                val currentItem = player.currentMediaItem ?: return
                val duration = player.duration
                if (duration != C.TIME_UNSET && duration > 0) {
                    durationCache[currentItem.mediaId] = duration
                }
            }

            @OptIn(UnstableApi::class)
            override fun onPositionDiscontinuity(
                oldPosition: Player.PositionInfo,
                newPosition: Player.PositionInfo,
                reason: Int
            ) {
                val isAutoTransition = reason == Player.DISCONTINUITY_REASON_AUTO_TRANSITION
                val isIndexChanged = oldPosition.mediaItemIndex != newPosition.mediaItemIndex
                val lastMediaItem = oldPosition.mediaItem ?: return

                if (isAutoTransition || isIndexChanged) {
                    finishTrack(lastMediaItem, oldPosition.positionMs)
                }
            }
        })
    }

    private fun saveCurrentQueue() {
        val player = player ?: return
        val queue = List(player.mediaItemCount) { i -> player.getMediaItemAt(i) }
        if (queue.isNotEmpty()) {
            GeneralStorage.saveQueue(queue)
        }
    }

    @OptIn(UnstableApi::class)
    private fun prefetchNextTrack() {
        val currentPlayer = player ?: return
        val nextIndex = currentPlayer.nextMediaItemIndex
        if (nextIndex == C.INDEX_UNSET) return
        val nextUri = currentPlayer.getMediaItemAt(nextIndex).localConfiguration?.uri
        DownloadUtil.prefetchBilibiliUri(nextUri)
    }

    fun createStatusBarBackend(provider: String): expo.modules.orpheus.manager.StatusBarLyricsBackend {
        return when {
            provider == "lyricon" && android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O_MR1 -> {
                LyriconBackend(this)
            }
            provider == "meizu" -> {
                MeizuStatusBarLyricsBackend(this)
            }
            else -> {
                SuperLyricBackend(this)
            }
        }
    }

    fun setCarLyricsEnabled(enabled: Boolean) {
        lyricsManager.setCarLyricsEnabled(enabled)
    }

    fun setCarLyrics(lyrics: List<LyricsLine>, offset: Double = 0.0) {
        lyricsManager.submitLyrics(
            LyricsData(lyrics = lyrics, offset = offset),
            setOf(LyricsConsumer.CAR),
        )
    }

    fun clearCarLyrics() {
        lyricsManager.clearConsumers(setOf(LyricsConsumer.CAR))
    }

    private fun updateCurrentMetadata(currentLyric: String?) {
        val player = player ?: return
        val currentIndex = player.currentMediaItemIndex
        if (currentIndex == C.INDEX_UNSET || currentIndex >= player.mediaItemCount) return

        val currentItem = player.getMediaItemAt(currentIndex)
        val updatedMetadata = buildPlaybackMetadata(currentItem, currentLyric)
        if (currentItem.mediaMetadata == updatedMetadata) return

        val updatedItem = currentItem.buildUpon()
            .setMediaMetadata(updatedMetadata)
            .build()

        // Lyric-only metadata refresh should not trigger extra queue persistence.
        player.replaceMediaItem(currentIndex, updatedItem)
    }

    private fun buildPlaybackMetadata(item: MediaItem, currentLyric: String?): MediaMetadata {
        val originalTrack = extractTrackRecord(item)
        val baseTitle = originalTrack?.title ?: item.mediaMetadata.title?.toString().orEmpty()
        val baseArtist = originalTrack?.artist ?: item.mediaMetadata.artist?.toString().orEmpty()
        val displayArtist = listOf(baseTitle, baseArtist)
            .filter { it.isNotBlank() }
            .joinToString(" - ")

        return MediaMetadata.Builder()
            .setTitle(currentLyric?.takeIf { it.isNotBlank() } ?: baseTitle)
            .setArtist(
                if (currentLyric.isNullOrBlank()) {
                    baseArtist
                } else {
                    displayArtist
                }
            )
            .setArtworkUri(item.mediaMetadata.artworkUri)
            .setExtras(item.mediaMetadata.extras)
            .build()
    }

    private fun extractTrackRecord(item: MediaItem): TrackRecord? {
        val trackJson = item.mediaMetadata.extras?.getString("track_json") ?: return null
        return try {
            json.decodeFromString<TrackRecord>(trackJson)
        } catch (_: Exception) {
            null
        }
    }

    @OptIn(UnstableApi::class)
    private fun applyVolumeForCurrentItem(measuredI: Double) {
        Log.d("LoudnessNormalization", "measuredI: $measuredI")
        val isLoudnessNormalizationEnabled = GeneralStorage.isLoudnessNormalizationEnabled()
        currentLoudnessGain = if (isLoudnessNormalizationEnabled) {
            val target = -14.0 // bilibili 的这个值似乎是固定的
            if (measuredI == 0.0) 1.0f else calculateLoudnessGain(measuredI, target)
        } else {
            1.0f
        }
        applyCurrentTrackAudioEffects(animateVolume = true)
    }

    private fun applyCurrentTrackAudioEffects(animateVolume: Boolean) {
        val player = player ?: return
        val trackId = player.currentMediaItem?.mediaId ?: return
        val profile = TrackAudioEffectStorage.getProfile(trackId)
        val targetVolume = trackAudioEffectManager.apply(player, profile, currentLoudnessGain)
        val currentVolume = player.volume

        volumeFadeJob?.cancel()
        if (abs(currentVolume - targetVolume) < 0.001f) return

        if (animateVolume) {
            volumeFadeJob = player.fadeInTo(targetVolume, 600L, scope)
        } else {
            player.volume = targetVolume
        }
    }

    fun setTrackAudioEffectProfile(trackId: String, volumeDb: Double, vocalStrength: Double) {
        TrackAudioEffectStorage.setProfile(trackId, volumeDb, vocalStrength)
        if (player?.currentMediaItem?.mediaId == trackId) {
            applyCurrentTrackAudioEffects(animateVolume = false)
        }
    }

    fun resetTrackAudioEffectProfile(trackId: String) {
        TrackAudioEffectStorage.resetProfile(trackId)
        if (player?.currentMediaItem?.mediaId == trackId) {
            applyCurrentTrackAudioEffects(animateVolume = false)
        }
    }
}
