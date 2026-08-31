package expo.modules.orpheus.service

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BilibiliPlaybackRecoveryPolicyTest {
    @Test
    fun recoversGenericIoErrors() {
        assertTrue(
            BilibiliPlaybackRecoveryPolicy.shouldRecover(
                errorCode = 2001,
                messageChain = "Unable to connect"
            )
        )
    }

    @Test
    fun doesNotRecoverNonIoErrors() {
        assertFalse(
            BilibiliPlaybackRecoveryPolicy.shouldRecover(
                errorCode = 4003,
                messageChain = "Decoder failed"
            )
        )
    }

    @Test
    fun doesNotRecoverPermanentBilibiliErrors() {
        listOf(-101, -412, -404).forEach { code ->
            assertFalse(
                BilibiliPlaybackRecoveryPolicy.shouldRecover(
                    errorCode = 2000,
                    messageChain = "Bilibili API Error: code=$code msg=failed"
                )
            )
        }
        assertFalse(
            BilibiliPlaybackRecoveryPolicy.shouldRecover(
                errorCode = 2000,
                messageChain = "AudioStreamError: no playable stream"
            )
        )
    }

    @Test
    fun usesBoundedBackoffDelays() {
        assertEquals(1_000L, BilibiliPlaybackRecoveryPolicy.retryDelayMs(1))
        assertEquals(3_000L, BilibiliPlaybackRecoveryPolicy.retryDelayMs(2))
        assertEquals(8_000L, BilibiliPlaybackRecoveryPolicy.retryDelayMs(3))
        assertEquals(8_000L, BilibiliPlaybackRecoveryPolicy.retryDelayMs(4))
    }
}
