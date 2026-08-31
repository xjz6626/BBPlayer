package expo.modules.orpheus.bilibili

import android.content.Context
import android.net.Uri
import android.util.Log
import com.tencent.mmkv.MMKV
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.util.concurrent.ConcurrentHashMap

@Serializable
internal data class CachedAudioResolution(
    val url: String,
    val cid: Long,
    val volume: VolumeData? = null,
    val expiresAtMs: Long,
    val cachedAtMs: Long
)

/**
 * Persistent cache for the short-lived data needed before Media3 can open a Bilibili stream.
 *
 * The queue keeps the stable orpheus:// URI. This cache only removes repeated control-plane
 * requests; an expired CDN URL is discarded and resolved again automatically.
 */
internal object BilibiliPlaybackCache {
    private const val TAG = "Orpheus/BilibiliCache"
    private const val STORE_ID = "bilibili_playback_cache"
    private const val RESOLUTION_PREFIX = "resolution:"
    private const val CID_PREFIX = "cid:"
    private const val WBI_KEYS = "wbi_keys"
    private const val EXPIRY_SAFETY_MARGIN_MS = 60_000L
    private const val FALLBACK_TTL_MS = 10 * 60_000L
    private const val MAX_RESOLUTION_ENTRIES = 512

    @Serializable
    private data class CachedWbiKeys(
        val imgKey: String,
        val subKey: String,
        val date: String
    )

    private val json = Json { ignoreUnknownKeys = true }
    private val memoryCache = ConcurrentHashMap<String, CachedAudioResolution>()
    private var kv: MMKV? = null

    @Synchronized
    fun initialize(context: Context) {
        if (kv != null) return
        MMKV.initialize(context.applicationContext)
        kv = MMKV.mmkvWithID(STORE_ID)
    }

    @Synchronized
    fun getResolution(
        bvid: String,
        cid: Long?,
        audioQuality: Int,
        enableDolby: Boolean,
        enableHiRes: Boolean,
        cookie: String?
    ): CachedAudioResolution? {
        val key = resolutionKey(
            bvid,
            cid,
            audioQuality,
            enableDolby,
            enableHiRes,
            cookie
        )
        val cached = memoryCache[key] ?: kv?.decodeString(key)?.let { encoded ->
            runCatching { json.decodeFromString<CachedAudioResolution>(encoded) }
                .onFailure { Log.w(TAG, "Failed to decode cached resolution", it) }
                .getOrNull()
                ?.also { memoryCache[key] = it }
        }

        if (cached == null) return null
        if (cached.expiresAtMs <= System.currentTimeMillis() + EXPIRY_SAFETY_MARGIN_MS) {
            memoryCache.remove(key)
            kv?.removeValueForKey(key)
            return null
        }
        return cached
    }

    @Synchronized
    fun putResolution(
        bvid: String,
        requestedCid: Long?,
        resolvedCid: Long,
        audioQuality: Int,
        enableDolby: Boolean,
        enableHiRes: Boolean,
        cookie: String?,
        url: String,
        volume: VolumeData?
    ) {
        val now = System.currentTimeMillis()
        val resolution = CachedAudioResolution(
            url = url,
            cid = resolvedCid,
            volume = volume,
            expiresAtMs = getExpiryMs(url, now),
            cachedAtMs = now
        )
        val requestedKey = resolutionKey(
            bvid,
            requestedCid,
            audioQuality,
            enableDolby,
            enableHiRes,
            cookie
        )
        saveResolution(requestedKey, resolution)

        // A normal video may be requested without a cid, or a source replacement may make the
        // requested cid stale. Store the resolved alias so every path reuses the refreshed URL.
        if (requestedCid == null || requestedCid != resolvedCid) {
            val resolvedKey = resolutionKey(
                bvid,
                resolvedCid,
                audioQuality,
                enableDolby,
                enableHiRes,
                cookie
            )
            saveResolution(resolvedKey, resolution)
        }
        putCid(bvid, resolvedCid)
        trimResolutionCache()
    }

    @Synchronized
    fun invalidateResolution(
        bvid: String,
        cid: Long?,
        audioQuality: Int,
        enableDolby: Boolean,
        enableHiRes: Boolean,
        cookie: String?
    ) {
        val keys = mutableSetOf(
            resolutionKey(
                bvid,
                cid,
                audioQuality,
                enableDolby,
                enableHiRes,
                cookie
            )
        )

        // Requests without a CID, and stale-CID recovery, may cache the same resolution under
        // both the requested key and the latest resolved CID. Remove both aliases so a retry
        // cannot reopen the URL that just failed.
        getCid(bvid)?.let { resolvedCid ->
            keys += resolutionKey(
                bvid,
                resolvedCid,
                audioQuality,
                enableDolby,
                enableHiRes,
                cookie
            )
        }

        keys.forEach { key ->
            memoryCache.remove(key)
            kv?.removeValueForKey(key)
        }
    }

    @Synchronized
    fun getCid(bvid: String): Long? {
        val value = kv?.decodeLong("$CID_PREFIX$bvid", 0L) ?: 0L
        return value.takeIf { it > 0L }
    }

    @Synchronized
    fun putCid(bvid: String, cid: Long) {
        if (cid > 0L) kv?.encode("$CID_PREFIX$bvid", cid)
    }

    @Synchronized
    fun getWbiKeys(date: String): Pair<String, String>? {
        val encoded = kv?.decodeString(WBI_KEYS) ?: return null
        val cached = runCatching { json.decodeFromString<CachedWbiKeys>(encoded) }
            .onFailure { Log.w(TAG, "Failed to decode cached WBI keys", it) }
            .getOrNull()
            ?: return null
        if (cached.date != date || cached.imgKey.isEmpty() || cached.subKey.isEmpty()) {
            return null
        }
        return cached.imgKey to cached.subKey
    }

    @Synchronized
    fun putWbiKeys(date: String, imgKey: String, subKey: String) {
        val encoded = json.encodeToString(CachedWbiKeys(imgKey, subKey, date))
        kv?.encode(WBI_KEYS, encoded)
    }

    @Synchronized
    fun invalidateWbiKeys() {
        kv?.removeValueForKey(WBI_KEYS)
    }

    private fun saveResolution(key: String, resolution: CachedAudioResolution) {
        memoryCache[key] = resolution
        kv?.encode(key, json.encodeToString(resolution))
    }

    private fun getExpiryMs(url: String, now: Long): Long {
        val deadlineSeconds = runCatching {
            Uri.parse(url).getQueryParameter("deadline")?.toLongOrNull()
        }.getOrNull()
        return deadlineSeconds?.times(1_000L)?.takeIf { it > now }
            ?: (now + FALLBACK_TTL_MS)
    }

    private fun resolutionKey(
        bvid: String,
        cid: Long?,
        audioQuality: Int,
        enableDolby: Boolean,
        enableHiRes: Boolean,
        cookie: String?
    ): String {
        val accountKey = cookie.orEmpty().hashCode()
        return "$RESOLUTION_PREFIX$bvid:${cid ?: "first"}:$audioQuality:$enableDolby:$enableHiRes:$accountKey"
    }

    private fun trimResolutionCache() {
        val store = kv ?: return
        val resolutionKeys = store.allKeys()?.filter { it.startsWith(RESOLUTION_PREFIX) }
            ?: return
        if (resolutionKeys.size <= MAX_RESOLUTION_ENTRIES) return

        resolutionKeys.mapNotNull { key ->
            val cachedAt = memoryCache[key]?.cachedAtMs
                ?: store.decodeString(key)?.let { encoded ->
                    runCatching {
                        json.decodeFromString<CachedAudioResolution>(encoded).cachedAtMs
                    }.getOrNull()
                }
            cachedAt?.let { key to it }
        }.sortedBy { it.second }
            .take(resolutionKeys.size - MAX_RESOLUTION_ENTRIES)
            .forEach { (key, _) ->
                memoryCache.remove(key)
                store.removeValueForKey(key)
            }
    }
}
