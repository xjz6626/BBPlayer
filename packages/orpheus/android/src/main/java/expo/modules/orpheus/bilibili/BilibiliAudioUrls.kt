package expo.modules.orpheus.bilibili

import java.io.IOException
import java.net.URI

/** Keep signed URLs intact, and prefer regular HTTPS CDNs over MCDN edge nodes. */
internal fun orderBilibiliAudioUrls(primaryUrl: String, backupUrls: List<String>?): List<String> {
    val urls = (listOf(primaryUrl) + backupUrls.orEmpty())
        .distinct()
        .mapNotNull { url ->
            val uri = runCatching { URI(url) }.getOrNull() ?: return@mapNotNull null
            if (uri.host == null || uri.scheme !in listOf("http", "https")) {
                return@mapNotNull null
            }
            url to uri
        }
        .sortedWith(
            compareBy<Pair<String, URI>> {
                it.second.host.endsWith(".mcdn.bilivideo.cn", ignoreCase = true)
            }.thenBy { it.second.scheme != "https" }
        )
        .map { it.first }

    if (urls.isEmpty()) {
        throw IOException("AudioStreamError: 未找到有效的音频流地址")
    }
    return urls
}
