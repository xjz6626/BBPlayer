package expo.modules.orpheus.network

import android.net.Uri
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import java.io.IOException
import java.io.InterruptedIOException

/** Try alternate URLs for the same bytes, including when a connection fails during a read. */
@UnstableApi
internal class FallbackDataSource(
    private val upstream: DataSource,
    private val resolveDataSpecs: (DataSpec) -> List<DataSpec>
) : DataSource {
    private var candidates = emptyList<DataSpec>()
    private var nextCandidate = 0
    private var bytesRead = 0L

    override fun addTransferListener(transferListener: TransferListener) {
        upstream.addTransferListener(transferListener)
    }

    override fun open(dataSpec: DataSpec): Long {
        candidates = resolveDataSpecs(dataSpec)
        nextCandidate = 0
        bytesRead = 0L
        return openNextCandidate()
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        while (true) {
            try {
                val count = upstream.read(buffer, offset, length)
                if (count > 0) bytesRead += count
                return count
            } catch (error: IOException) {
                if (nextCandidate >= candidates.size || Thread.currentThread().isInterrupted) {
                    throw error
                }
                closeUpstream(error)
                openNextCandidate(error)
            }
        }
    }

    override fun getUri(): Uri? = upstream.uri

    override fun getResponseHeaders(): Map<String, List<String>> = upstream.responseHeaders

    override fun close() {
        candidates = emptyList()
        nextCandidate = 0
        bytesRead = 0L
        upstream.close()
    }

    private fun openNextCandidate(previousError: IOException? = null): Long {
        var failure = previousError
        while (nextCandidate < candidates.size) {
            if (Thread.currentThread().isInterrupted) {
                throw InterruptedIOException("Audio loading cancelled")
            }
            val candidate = candidates[nextCandidate++].subrange(bytesRead)
            try {
                return upstream.open(candidate)
            } catch (error: IOException) {
                failure?.let { if (it !== error) error.addSuppressed(it) }
                failure = error
                closeUpstream(error)
            }
        }
        throw failure ?: IOException("No audio source candidates")
    }

    private fun closeUpstream(error: IOException) {
        try {
            upstream.close()
        } catch (closeError: IOException) {
            if (closeError !== error) error.addSuppressed(closeError)
        }
    }
}
