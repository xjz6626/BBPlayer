package expo.modules.orpheus.bilibili

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.IOException

class BilibiliAudioUrlsTest {
    // BV1spHZ6FEPM returns an MCDN primary with two signed regular-CDN backups.
    private val mcdn = "https://xy116x196x140x22xy.mcdn.bilivideo.cn:8082/audio.m4s?deadline=1800000000"
    private val cdn = "https://upos-sz-mirrorzos.bilivideo.com/audio.m4s?deadline=1800000000&sig=a%2Fb"

    @Test
    fun prefersRegularCdnBackupOverMcdnPrimary() {
        assertEquals(listOf(cdn, mcdn), orderBilibiliAudioUrls(mcdn, listOf(cdn)))
    }

    @Test
    fun retainsAllDistinctSignedBackupUrls() {
        val secondBackup = "$cdn&origin=backup"
        assertEquals(
            listOf(cdn, secondBackup, mcdn),
            orderBilibiliAudioUrls(mcdn, listOf(cdn, secondBackup, cdn))
        )
    }

    @Test
    fun keepsRegularPrimaryAheadOfEquivalentBackups() {
        val backup = "https://upos-sz-mirrorhw.bilivideo.com/audio.m4s"
        assertEquals(listOf(cdn, backup), orderBilibiliAudioUrls(cdn, listOf(backup)))
    }

    @Test
    fun prefersHttpsWithoutRewritingSignedHttpUrls() {
        val http = cdn.replace("https:", "http:")
        assertEquals(listOf(cdn, http), orderBilibiliAudioUrls(http, listOf(cdn)))
    }

    @Test
    fun retainsMcdnWhenNoBackupIsProvided() {
        assertEquals(listOf(mcdn), orderBilibiliAudioUrls(mcdn, null))
    }

    @Test
    fun usesValidBackupWhenPrimaryIsInvalid() {
        assertEquals(listOf(cdn), orderBilibiliAudioUrls("", listOf("not a URL", cdn)))
    }

    @Test
    fun rejectsStreamsWithoutAnyValidUrl() {
        assertThrows(IOException::class.java) {
            orderBilibiliAudioUrls("", listOf("file:///audio.m4s", "invalid"))
        }
    }
}
