package expo.modules.orpheus.bilibili

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.IOException

class BilibiliNavResponseTest {
    private val wbiImg = WbiImgData(
        imgUrl = "https://i0.hdslb.com/bfs/wbi/image.png",
        subUrl = "https://i0.hdslb.com/bfs/wbi/sub.png"
    )

    @Test
    fun acceptsLoggedInResponseWithWbiKeys() {
        val response = BilibiliNavResponse(
            code = 0,
            data = NavData(wbiImg = wbiImg)
        )

        assertEquals(wbiImg, requireWbiImg(response))
    }

    @Test
    fun acceptsAnonymousResponseWithWbiKeys() {
        val response = BilibiliNavResponse(
            code = -101,
            message = "账号未登录",
            data = NavData(wbiImg = wbiImg)
        )

        assertEquals(wbiImg, requireWbiImg(response))
    }

    @Test
    fun preservesOtherApiErrors() {
        val response = BilibiliNavResponse(
            code = -412,
            message = "请求被拦截",
            data = null
        )

        val error = assertThrows(IOException::class.java) {
            requireWbiImg(response)
        }

        assertEquals(
            "Bilibili API Error: code=-412 msg=请求被拦截",
            error.message
        )
    }

    @Test
    fun preservesMissingResponseError() {
        val error = assertThrows(IOException::class.java) {
            requireWbiImg(null)
        }

        assertEquals(
            "Bilibili API Error: code=null msg=Unknown Error",
            error.message
        )
    }

    @Test
    fun rejectsAnonymousResponseWithoutWbiKeys() {
        val response = BilibiliNavResponse(
            code = -101,
            message = "账号未登录",
            data = NavData(wbiImg = null)
        )

        val error = assertThrows(IOException::class.java) {
            requireWbiImg(response)
        }

        assertEquals(
            "Bilibili API Logic Error: code=-101 msg=WBI keys are missing",
            error.message
        )
    }
}
