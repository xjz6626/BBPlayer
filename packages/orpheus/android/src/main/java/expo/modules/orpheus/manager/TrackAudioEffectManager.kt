package expo.modules.orpheus.manager

import android.media.audiofx.Equalizer
import android.media.audiofx.LoudnessEnhancer
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import expo.modules.orpheus.util.TrackAudioEffectProfile
import kotlin.math.log10
import kotlin.math.pow
import kotlin.math.roundToInt

@OptIn(UnstableApi::class)
class TrackAudioEffectManager {
    private var equalizer: Equalizer? = null
    private var loudnessEnhancer: LoudnessEnhancer? = null
    private var attachedAudioSessionId = C.AUDIO_SESSION_ID_UNSET

    fun apply(
        player: ExoPlayer,
        profile: TrackAudioEffectProfile,
        loudnessGain: Float,
    ): Float {
        val audioSessionId = player.audioSessionId
        if (audioSessionId == C.AUDIO_SESSION_ID_UNSET) {
            releaseEffects()
            return calculatePlayerVolume(profile, loudnessGain)
        }

        if (attachedAudioSessionId != audioSessionId) {
            releaseEffects()
            attachedAudioSessionId = audioSessionId
        }

        applyVocalEqualizer(audioSessionId, profile.vocalStrength.toFloat())
        applyPositiveGain(audioSessionId, calculateTotalGainDb(profile, loudnessGain))
        return calculatePlayerVolume(profile, loudnessGain)
    }

    fun release() {
        releaseEffects()
    }

    private fun calculateTotalGainDb(
        profile: TrackAudioEffectProfile,
        loudnessGain: Float,
    ): Float {
        val normalizedGain = loudnessGain.coerceAtLeast(0.0001f)
        val loudnessDb = 20f * log10(normalizedGain)
        // EQ boosts need a little headroom, especially for bright synthetic vocals.
        val vocalHeadroomDb = -1.5f * profile.vocalStrength.toFloat()
        return loudnessDb + profile.volumeDb.toFloat() + vocalHeadroomDb
    }

    private fun calculatePlayerVolume(
        profile: TrackAudioEffectProfile,
        loudnessGain: Float,
    ): Float {
        val totalGainDb = calculateTotalGainDb(profile, loudnessGain)
        return 10f.pow(totalGainDb.coerceAtMost(0f) / 20f).coerceIn(0f, 1f)
    }

    private fun applyPositiveGain(audioSessionId: Int, totalGainDb: Float) {
        val positiveGainMb = (totalGainDb.coerceAtLeast(0f) * 100f).roundToInt()
        if (positiveGainMb == 0) {
            releaseLoudnessEnhancer()
            return
        }

        try {
            val enhancer = loudnessEnhancer ?: LoudnessEnhancer(audioSessionId).also {
                loudnessEnhancer = it
            }
            enhancer.setTargetGain(positiveGainMb)
            enhancer.enabled = true
        } catch (error: Exception) {
            Log.w(TAG, "LoudnessEnhancer unavailable for session $audioSessionId", error)
            releaseLoudnessEnhancer()
        }
    }

    private fun applyVocalEqualizer(audioSessionId: Int, strength: Float) {
        val clampedStrength = strength.coerceIn(0f, 1f)
        if (clampedStrength <= 0.001f) {
            releaseEqualizer()
            return
        }

        try {
            val effect = equalizer ?: Equalizer(0, audioSessionId).also { equalizer = it }
            val levelRange = effect.bandLevelRange
            val minimumLevel = levelRange[0].toInt()
            val maximumLevel = levelRange[1].toInt()

            for (bandIndex in 0 until effect.numberOfBands.toInt()) {
                val band = bandIndex.toShort()
                val centerHz = effect.getCenterFreq(band) / 1000
                val fullStrengthLevel = when {
                    centerHz < 160 -> -250
                    centerHz < 500 -> -150
                    centerHz < 1_000 -> 0
                    centerHz < 2_500 -> 250
                    centerHz < 4_500 -> 350
                    centerHz < 8_000 -> 50
                    else -> -50
                }
                val bandLevel = (fullStrengthLevel * clampedStrength)
                    .roundToInt()
                    .coerceIn(minimumLevel, maximumLevel)
                    .toShort()
                effect.setBandLevel(band, bandLevel)
            }
            effect.enabled = true
        } catch (error: Exception) {
            Log.w(TAG, "Equalizer unavailable for session $audioSessionId", error)
            releaseEqualizer()
        }
    }

    private fun releaseEffects() {
        releaseEqualizer()
        releaseLoudnessEnhancer()
        attachedAudioSessionId = C.AUDIO_SESSION_ID_UNSET
    }

    private fun releaseEqualizer() {
        try {
            equalizer?.enabled = false
            equalizer?.release()
        } catch (_: Exception) {
            // The audio session may already have been released by ExoPlayer.
        } finally {
            equalizer = null
        }
    }

    private fun releaseLoudnessEnhancer() {
        try {
            loudnessEnhancer?.enabled = false
            loudnessEnhancer?.release()
        } catch (_: Exception) {
            // The audio session may already have been released by ExoPlayer.
        } finally {
            loudnessEnhancer = null
        }
    }

    private companion object {
        const val TAG = "TrackAudioEffectManager"
    }
}
