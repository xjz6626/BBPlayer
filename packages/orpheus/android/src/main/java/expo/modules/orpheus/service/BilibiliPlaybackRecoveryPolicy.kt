package expo.modules.orpheus.service

internal object BilibiliPlaybackRecoveryPolicy {
    const val MAX_RECOVERY_ATTEMPTS = 3

    private val retryDelaysMs = longArrayOf(1_000L, 3_000L, 8_000L)
    private val nonRetryableMessages = listOf(
        "Bilibili API Error: code=-101",
        "Bilibili API Error: code=-412",
        "Bilibili API Error: code=-404",
        "AudioStreamError",
        "Missing bvid",
        "page list is empty"
    )

    fun shouldRecover(errorCode: Int, messageChain: String): Boolean {
        // Media3 reserves 2000..2999 for IO and network failures. Decoder, renderer and
        // application errors must not restart the current item.
        if (errorCode !in 2000..2999) return false
        return nonRetryableMessages.none { messageChain.contains(it, ignoreCase = true) }
    }

    fun retryDelayMs(attempt: Int): Long =
        retryDelaysMs[(attempt - 1).coerceIn(retryDelaysMs.indices)]
}
