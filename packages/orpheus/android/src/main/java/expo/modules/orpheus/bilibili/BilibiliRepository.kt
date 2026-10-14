package expo.modules.orpheus.bilibili

import android.content.Context
import android.util.Log

import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

object BilibiliRepository {
    val TAG = "Orpheus/BilibiliRepo"

    private const val VIDEO_NOT_FOUND_CODE = -404

    private val api: BilibiliApi by lazy {
        NetworkModule.retrofit.create(BilibiliApi::class.java)
    }

    private var cachedImgKey: String? = null
    private var cachedSubKey: String? = null
    private var cachedDateStr: String? = null
    private val resolutionLocks = ConcurrentHashMap<String, Any>()

    fun initialize(context: Context) {
        BilibiliPlaybackCache.initialize(context)
    }

    private fun getTodayDateStr(): String {
        val sdf = SimpleDateFormat("yyyyMMdd", Locale.getDefault())
        return sdf.format(Date())
    }

    @Synchronized
    private fun getWbiKeys(cookie: String?): Pair<String, String> {
        val today = getTodayDateStr()

        if (cachedImgKey != null && cachedSubKey != null && today == cachedDateStr) {
            return cachedImgKey!! to cachedSubKey!!
        }

        BilibiliPlaybackCache.getWbiKeys(today)?.let { (imgKey, subKey) ->
            cachedImgKey = imgKey
            cachedSubKey = subKey
            cachedDateStr = today
            return imgKey to subKey
        }

        val response = api.getNavInfo(cookie).execute()
        if (!response.isSuccessful) {
            throw IOException("Bilibili API Http Error: ${response.code()}")
        }

        val wbiData = requireWbiImg(response.body())

        val imgKey = WbiUtil.extractKey(wbiData.imgUrl)
        val subKey = WbiUtil.extractKey(wbiData.subUrl)

        cachedImgKey = imgKey
        cachedSubKey = subKey
        cachedDateStr = today
        BilibiliPlaybackCache.putWbiKeys(today, imgKey, subKey)

        return imgKey to subKey
    }

    /**
     * 解析音频 URL
     */
    fun resolveAudioUrls(
        bvid: String,
        cid: Long?,
        audioQuality: Int,
        enableDolby: Boolean,
        enableHiRes: Boolean,
        cookie: String?
    ): Pair<List<String>, VolumeData?> {
        val lockKey = "$bvid:${cid ?: "first"}:$audioQuality:$enableDolby:$enableHiRes:${cookie.orEmpty().hashCode()}"
        val resolutionLock = resolutionLocks.computeIfAbsent(lockKey) { Any() }
        return synchronized(resolutionLock) {
            resolveAudioUrlsLocked(
                bvid,
                cid,
                audioQuality,
                enableDolby,
                enableHiRes,
                cookie
            )
        }
    }

    fun invalidateAudioUrl(
        bvid: String,
        cid: Long?,
        audioQuality: Int,
        enableDolby: Boolean,
        enableHiRes: Boolean,
        cookie: String?
    ) {
        BilibiliPlaybackCache.invalidateResolution(
            bvid,
            cid,
            audioQuality,
            enableDolby,
            enableHiRes,
            cookie
        )

        // WBI keys are normally cached for a day, but Bilibili can rotate them earlier. A fatal
        // playback reload should refresh both the short-lived CDN URL and its signing keys.
        synchronized(this) {
            cachedImgKey = null
            cachedSubKey = null
            cachedDateStr = null
            BilibiliPlaybackCache.invalidateWbiKeys()
        }
    }

    private fun resolveAudioUrlsLocked(
        bvid: String,
        cid: Long?,
        audioQuality: Int,
        enableDolby: Boolean,
        enableHiRes: Boolean,
        cookie: String?
    ): Pair<List<String>, VolumeData?> {
        BilibiliPlaybackCache.getResolution(
            bvid,
            cid,
            audioQuality,
            enableDolby,
            enableHiRes,
            cookie
        )?.let { cached ->
            Log.d(TAG, "resolved audio URL cache hit: bvid=$bvid, cid=${cached.cid}")
            return cached.urls to cached.volume
        }

        var cidInternal = cid ?: BilibiliPlaybackCache.getCid(bvid)
        if (cidInternal != null && cid == null) {
            BilibiliPlaybackCache.getResolution(
                bvid,
                cidInternal,
                audioQuality,
                enableDolby,
                enableHiRes,
                cookie
            )?.let { cached ->
                Log.d(TAG, "resolved audio URL cache hit by cached cid: bvid=$bvid, cid=$cidInternal")
                return cached.urls to cached.volume
            }
        }
        if (cidInternal == null) {
            cidInternal = getFirstCid(bvid, cookie)
        }

        val (imgKey, subKey) = getWbiKeys(cookie)

        Log.d(TAG, "resolve url: bvid=$bvid, cid=$cidInternal, enableDolby=$enableDolby, enableHiRes=$enableHiRes")

        var apiResponse = getPlayUrl(
            bvid = bvid,
            cid = cidInternal,
            audioQuality = audioQuality,
            cookie = cookie,
            imgKey = imgKey,
            subKey = subKey
        )

        // UP 主替换已发布稿件的视频源后，BV 号不变，但 CID 会失效。
        // 单 P 稿件可以安全地刷新到唯一的新 CID；无 CID 的普通视频仍取第一 P。
        if (apiResponse?.code == VIDEO_NOT_FOUND_CODE) {
            val refreshedCid = runCatching {
                refreshStaleCid(bvid, cid, cookie)
            }.onFailure { error ->
                Log.w(TAG, "failed to refresh stale cid: bvid=$bvid, cid=$cidInternal", error)
            }.getOrNull()

            if (refreshedCid != null && refreshedCid != cidInternal) {
                Log.i(
                    TAG,
                    "retry playurl with refreshed cid: bvid=$bvid, oldCid=$cidInternal, newCid=$refreshedCid"
                )
                cidInternal = refreshedCid
                apiResponse = getPlayUrl(
                    bvid = bvid,
                    cid = cidInternal,
                    audioQuality = audioQuality,
                    cookie = cookie,
                    imgKey = imgKey,
                    subKey = subKey
                )
            }
        }

        if (apiResponse?.code != 0) {
            val msg = apiResponse?.message ?: "Unknown Error"
            throw IOException("Bilibili API Error: code=${apiResponse?.code} msg=$msg")
        }

        if (apiResponse.data == null) {
            throw IOException("Bilibili API Logic Error: code=0 msg=${apiResponse.message} but data is missing")
        }

        val data = apiResponse.data
        val dash = data.dash
        val durl = data.durl
        val volume = data.volume

        val resolvedUrls = if (dash == null) {
            if (durl.isNullOrEmpty()) {
                throw IOException("AudioStreamError: 请求到的流数据不包含 dash 或 durl 任一字段")
            }
            orderBilibiliAudioUrls(durl[0].url, durl[0].backupUrl)
        } else if (enableDolby && dash.dolby?.audio?.isNotEmpty() == true) {
            Log.d(TAG, "select dolby source")
            orderBilibiliAudioUrls(dash.dolby.audio[0].baseUrl, dash.dolby.audio[0].backupUrl)
        } else if (enableHiRes && dash.flac?.audio != null) {
            Log.d(TAG, "select hires source")
            orderBilibiliAudioUrls(dash.flac.audio.baseUrl, dash.flac.audio.backupUrl)
        } else {
            if (dash.audio.isNullOrEmpty()) {
                throw IOException("AudioStreamError: 未找到有效的音频流数据")
            }
            val audio = dash.audio.find { it.id == audioQuality } ?: dash.audio[0]
            orderBilibiliAudioUrls(audio.baseUrl, audio.backupUrl)
        }

        BilibiliPlaybackCache.putResolution(
            bvid = bvid,
            requestedCid = cid,
            resolvedCid = cidInternal,
            audioQuality = audioQuality,
            enableDolby = enableDolby,
            enableHiRes = enableHiRes,
            cookie = cookie,
            urls = resolvedUrls,
            volume = volume
        )
        return resolvedUrls to volume
    }

    private fun getPlayUrl(
        bvid: String,
        cid: Long,
        audioQuality: Int,
        cookie: String?,
        imgKey: String,
        subKey: String
    ): BilibiliApiResponse<BilibiliAudioStreamResponse>? {
        val rawParams = mapOf(
            "bvid" to bvid,
            "cid" to cid,
            "fnval" to 4048,
            "fnver" to 0,
            "fourk" to 1,
            "qlt" to audioQuality,
            "voice_balance" to 1
        )
        val signedParams = WbiUtil.sign(rawParams, imgKey, subKey)
        val response = api.getPlayUrl(cookie, signedParams).execute()

        if (!response.isSuccessful) {
            throw IOException("Bilibili API Http Error: ${response.code()}")
        }
        return response.body()
    }

    private fun refreshStaleCid(bvid: String, requestedCid: Long?, cookie: String?): Long? {
        val pageCids = getPageCids(bvid, cookie)
        val refreshedCid = if (requestedCid == null) {
            pageCids.firstOrNull()
        } else {
            // 多 P 稿件无法仅凭旧 CID 确定被替换的是哪一 P，不能冒险播放错误分 P。
            pageCids.singleOrNull()
        }
        refreshedCid?.let { BilibiliPlaybackCache.putCid(bvid, it) }
        return refreshedCid
    }

    fun getFirstCid(bvid: String, cookie: String?): Long {
        val cid = getPageCids(bvid, cookie).firstOrNull()
            ?: throw IOException("Bilibili API Logic Error: page list is empty for bvid=$bvid")
        BilibiliPlaybackCache.putCid(bvid, cid)
        return cid
    }

    private fun getPageCids(bvid: String, cookie: String?): List<Long> {
        val call = api.getPageList(cookie = cookie, bvid = bvid)
        val response = call.execute()

        if (!response.isSuccessful) {
            throw IOException("Bilibili API Http Error: ${response.code()}")
        }

        val apiResponse = response.body()
        if (apiResponse?.code != 0) {
            val msg = apiResponse?.message ?: "Unknown Error"
            throw IOException("Bilibili API Error: code=${apiResponse?.code} msg=$msg")
        }

        if (apiResponse.data == null) {
            throw IOException("Bilibili API Logic Error: code=0 msg=${apiResponse.message} but data is missing")
        }
        return apiResponse.data.map { it.cid }
    }
}

private const val NOT_LOGGED_IN_CODE = -101

/**
 * The nav endpoint returns usable WBI keys together with code -101 for anonymous requests.
 * Playback must only reject that response when the keys themselves are missing.
 */
internal fun requireWbiImg(apiResponse: BilibiliNavResponse?): WbiImgData {
    val response = apiResponse
        ?: throw IOException("Bilibili API Error: code=null msg=Unknown Error")

    if (response.code != 0 && response.code != NOT_LOGGED_IN_CODE) {
        val msg = response.message ?: "Unknown Error"
        throw IOException("Bilibili API Error: code=${response.code} msg=$msg")
    }

    return response.data?.wbiImg
        ?: throw IOException(
            "Bilibili API Logic Error: code=${response.code} msg=WBI keys are missing"
        )
}
