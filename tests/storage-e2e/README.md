# Isolated storage integration verification

This harness exercises the compiled application and the real Python storage worker
with real FFmpeg decoding. It creates its own database, signing key, API key and
synthetic WAV/ZIP data. A disposable Docker container has no external network or
published ports; the worker joins only that container's network namespace.
The `finally` block stops the worker, removes the container and deletes all test
state. It does not use production configuration, credentials, music or databases.

Build and package on the development machine:

```sh
npm run build
node tests/storage-e2e/bundle.mjs /tmp/shelf-isolated-bundle
```

Copy that code-only bundle to a Linux machine with Docker, Python 3, OpenSSL,
FFmpeg and FFprobe. Run the following as an account allowed to use Docker and
enter a network namespace (normally root):

```sh
python3 -B /tmp/shelf-isolated-bundle/run.py /tmp/shelf-isolated-bundle /path/to/ffmpeg /path/to/ffprobe
```

The test checks final per-file storage status, both original and extracted hashes,
different upload IDs, content deduplication and release of backend staging bytes.
An image may be downloaded to the Docker cache; no persistent service is installed.
