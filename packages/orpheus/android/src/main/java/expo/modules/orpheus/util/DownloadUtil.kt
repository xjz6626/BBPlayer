package expo.modules.orpheus.util

import android.content.Context
import android.util.Log
import androidx.core.net.toUri
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.media3.exoplayer.offline.DownloadNotificationHelper
import androidx.media3.exoplayer.scheduler.Requirements
import expo.modules.orpheus.OrpheusConfig
import expo.modules.orpheus.bilibili.BilibiliRepository
import expo.modules.orpheus.manager.DownloadCache
import expo.modules.orpheus.network.FallbackDataSource
import expo.modules.orpheus.service.OrpheusDownloadService
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

@UnstableApi
object DownloadUtil {
    private const val DEFAULT_MAX_PARALLEL_DOWNLOADS = 1
    private const val MIN_MAX_PARALLEL_DOWNLOADS = 1
    private const val MAX_MAX_PARALLEL_DOWNLOADS = 6

    private var downloadManager: DownloadManager? = null
    private var maxParallelDownloads = DEFAULT_MAX_PARALLEL_DOWNLOADS

    private var playerDataSourceFactory: DataSource.Factory? = null
    private var downloadDataSourceFactory: DataSource.Factory? = null

    private var downloadNotificationHelper: DownloadNotificationHelper? = null
    private val prefetchExecutor = Executors.newFixedThreadPool(2)
    private val prefetchingUris = ConcurrentHashMap.newKeySet<String>()

    @Synchronized
    fun getDownloadManager(context: Context): DownloadManager {
        if (downloadManager == null) {
            val databaseProvider = StandaloneDatabaseProvider(context)
            downloadManager = DownloadManager(
                context,
                databaseProvider,
                DownloadCache.getStableCache(context),
                getDownloadDataSourceFactory(context),
                Executors.newFixedThreadPool(6)
            ).apply {
                maxParallelDownloads = this@DownloadUtil.maxParallelDownloads
                requirements = Requirements(0)
            }
        }
        return downloadManager!!
    }

    @Synchronized
    fun setMaxParallelDownloads(context: Context, value: Int) {
        maxParallelDownloads = value.coerceIn(
            MIN_MAX_PARALLEL_DOWNLOADS,
            MAX_MAX_PARALLEL_DOWNLOADS
        )
        getDownloadManager(context).maxParallelDownloads = maxParallelDownloads
    }

    @Synchronized
    fun getPlayerDataSourceFactory(context: Context): DataSource.Factory {
        if (playerDataSourceFactory == null) {
            val upstreamFactory = getUpstreamFactory(context)

            val downloadCache = DownloadCache.getStableCache(context)
            val lruCache = DownloadCache.getLruCache(context)

            val cacheFactory = CacheDataSource.Factory()
                .setCache(lruCache)
                .setUpstreamDataSourceFactory(upstreamFactory)
                .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)

            val downloadFactory = CacheDataSource.Factory()
                .setCache(downloadCache)
                .setUpstreamDataSourceFactory(cacheFactory)
                .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
                .setCacheWriteDataSinkFactory(null)

            playerDataSourceFactory = downloadFactory
        }
        return playerDataSourceFactory!!
    }


    @Synchronized
    private fun getDownloadDataSourceFactory(context: Context): DataSource.Factory {
        if (downloadDataSourceFactory == null) {
            downloadDataSourceFactory = getUpstreamFactory(context)
        }
        return downloadDataSourceFactory!!
    }

    private fun getUpstreamFactory(context: Context): DataSource.Factory {
        BilibiliRepository.initialize(context)
        val httpDataSourceFactory = androidx.media3.datasource.okhttp.OkHttpDataSource.Factory(
            expo.modules.orpheus.network.OkHttpClientManager.okHttpClient
        )
            .setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36")

        return DataSource.Factory {
            FallbackDataSource(httpDataSourceFactory.createDataSource(), ::resolveBilibiliDataSpecs)
        }
    }

    /** Resolve the next Bilibili item off the playback critical path. */
    fun prefetchBilibiliUri(uri: android.net.Uri?) {
        if (uri?.scheme != "orpheus" || uri.host != "bilibili") return
        val cacheKey = uri.toString()
        if (!prefetchingUris.add(cacheKey)) return

        prefetchExecutor.execute {
            try {
                resolveBilibiliUri(uri)
            } catch (error: Exception) {
                Log.w("Orpheus/Prefetch", "Failed to prefetch Bilibili audio URL: $uri", error)
            } finally {
                prefetchingUris.remove(cacheKey)
            }
        }
    }

    /** Force the next open of a Bilibili item to request a fresh short-lived CDN URL. */
    fun invalidateBilibiliUri(uri: android.net.Uri?) {
        if (uri?.scheme != "orpheus" || uri.host != "bilibili") return
        val bvid = uri.getQueryParameter("bvid") ?: return
        BilibiliRepository.invalidateAudioUrl(
            bvid = bvid,
            cid = uri.getQueryParameter("cid")?.toLongOrNull(),
            audioQuality = uri.getQueryParameter("quality")?.toIntOrNull() ?: 30280,
            enableDolby = uri.getQueryParameter("dolby") == "1",
            enableHiRes = uri.getQueryParameter("hires") == "1",
            cookie = OrpheusConfig.bilibiliCookie
        )
    }

    @Synchronized
    fun getDownloadNotificationHelper(context: Context): DownloadNotificationHelper {
        if (downloadNotificationHelper == null) {
            downloadNotificationHelper =
                DownloadNotificationHelper(context, OrpheusDownloadService.CHANNEL_ID)
        }
        return downloadNotificationHelper!!
    }

    fun getReadOnlyCacheDataSource(context: Context): CacheDataSource {
        val cache = DownloadCache.getStableCache(context)
        return CacheDataSource.Factory()
            .setCache(cache)
            .setUpstreamDataSourceFactory(null) // No upstream, only cache
            .setCacheReadDataSourceFactory(androidx.media3.datasource.FileDataSource.Factory())
            .setFlags(CacheDataSource.FLAG_BLOCK_ON_CACHE)
            .createDataSource()
    }

    private fun resolveBilibiliDataSpecs(dataSpec: DataSpec): List<DataSpec> {
        val uri = dataSpec.uri
        if (uri.scheme == "orpheus" && uri.host == "bilibili") {
            try {
                val (urls, volume) = resolveBilibiliUri(uri)
                // 在这里保存响度均衡数据，并且直接发一个事件，在 OrpheusMusicService 监听
                if (volume !== null) {
                    Log.d(
                        "LoudnessNormalization",
                        "uri: ${dataSpec.uri}, measuredI: ${volume.measuredI}"
                    )
                    LoudnessStorage.setLoudnessData(dataSpec.uri.toString(), volume.measuredI)
                }

                val headers = HashMap(dataSpec.httpRequestHeaders)
                headers["Referer"] = "https://www.bilibili.com/"

                return urls.map { url ->
                    dataSpec.buildUpon()
                        .setUri(url.toUri())
                        .setHttpRequestHeaders(headers)
                        .setKey(uri.toString())
                        .build()
                }
            } catch (e: Exception) {
                throw IOException("Resolve Url Failed: ${e.message}", e)
            }
        }
        return listOf(dataSpec)
    }

    private fun resolveBilibiliUri(uri: android.net.Uri): Pair<List<String>, expo.modules.orpheus.bilibili.VolumeData?> {
        val bvid = uri.getQueryParameter("bvid")
            ?: throw IOException("Missing bvid in Bilibili playback URI")
        return BilibiliRepository.resolveAudioUrls(
            bvid = bvid,
            cid = uri.getQueryParameter("cid")?.toLongOrNull(),
            audioQuality = uri.getQueryParameter("quality")?.toIntOrNull() ?: 30280,
            enableDolby = uri.getQueryParameter("dolby") == "1",
            enableHiRes = uri.getQueryParameter("hires") == "1",
            cookie = OrpheusConfig.bilibiliCookie
        )
    }
}
