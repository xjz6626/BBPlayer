package expo.modules.orpheus.util

import android.content.Context
import android.util.Base64
import android.util.Log
import com.tencent.mmkv.MMKV

data class TrackAudioEffectProfile(
    val volumeDb: Double = 0.0,
    val vocalStrength: Double = 0.0,
)

object TrackAudioEffectStorage {
    private const val TAG = "TrackAudioEffectStorage"
    private const val VOLUME_PREFIX = "volume_db::"
    private const val VOCAL_PREFIX = "vocal_strength::"

    private var kv: MMKV? = null

    @Synchronized
    fun initialize(context: Context) {
        if (kv == null) {
            MMKV.initialize(context)
            kv = MMKV.mmkvWithID("track_audio_effect_store")
        }
    }

    private val safeKv: MMKV
        get() = kv ?: throw IllegalStateException("TrackAudioEffectStorage not initialized")

    private fun encodedTrackId(trackId: String): String = Base64.encodeToString(
        trackId.toByteArray(Charsets.UTF_8),
        Base64.NO_WRAP or Base64.URL_SAFE,
    )

    fun getProfile(trackId: String): TrackAudioEffectProfile {
        if (trackId.isBlank()) return TrackAudioEffectProfile()
        val encodedId = encodedTrackId(trackId)
        return try {
            TrackAudioEffectProfile(
                volumeDb = safeKv.decodeDouble(VOLUME_PREFIX + encodedId, 0.0),
                vocalStrength = safeKv.decodeDouble(VOCAL_PREFIX + encodedId, 0.0),
            )
        } catch (error: Exception) {
            Log.e(TAG, "Failed to read profile for $trackId", error)
            TrackAudioEffectProfile()
        }
    }

    fun setProfile(trackId: String, volumeDb: Double, vocalStrength: Double) {
        if (trackId.isBlank()) return
        val encodedId = encodedTrackId(trackId)
        try {
            safeKv.encode(VOLUME_PREFIX + encodedId, volumeDb.coerceIn(-12.0, 6.0))
            safeKv.encode(VOCAL_PREFIX + encodedId, vocalStrength.coerceIn(0.0, 1.0))
        } catch (error: Exception) {
            Log.e(TAG, "Failed to save profile for $trackId", error)
        }
    }

    fun resetProfile(trackId: String) {
        if (trackId.isBlank()) return
        val encodedId = encodedTrackId(trackId)
        try {
            safeKv.removeValueForKey(VOLUME_PREFIX + encodedId)
            safeKv.removeValueForKey(VOCAL_PREFIX + encodedId)
        } catch (error: Exception) {
            Log.e(TAG, "Failed to reset profile for $trackId", error)
        }
    }
}
