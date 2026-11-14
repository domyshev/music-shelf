import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('storage_worker', Path(__file__).parents[1]/'storage/worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class StorageWorkerTests(unittest.TestCase):
    def test_corrupt_download_is_never_published(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            upload = {'id': '12345678-1234-4234-8234-123456789abc', 'files': [
                {'name': 'Album/song.flac', 'sizeBytes': 4, 'sha256': hashlib.sha256(b'good').hexdigest(), 'status': 'staged'}]}
            with patch.object(worker, 'ROOT', root), patch.object(worker, 'request', return_value=io.BytesIO(b'bad!')), patch.object(worker, 'probe') as probe, patch.object(worker, 'send') as send:
                worker.receive(upload)
                probe.assert_not_called()
                self.assertFalse((root/'Imports'/upload['id']/'0.flac').exists())
                self.assertFalse(send.call_args[0][1]['results'][0]['ok'])

    def test_retry_reuses_verified_file_and_never_downloads_twice(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            upload = {'id': '12345678-1234-4234-8234-123456789abc', 'files': [
                {'name': 'Album/song.flac', 'sizeBytes': 4, 'sha256': hashlib.sha256(b'good').hexdigest(), 'status': 'staged'}]}
            track = {'title': 'Song', 'file': {'name': 'song.flac'}}
            with patch.object(worker, 'ROOT', root), patch.object(worker, 'request', return_value=io.BytesIO(b'good')) as request, patch.object(worker, 'probe', return_value=track), patch.object(worker, 'send') as send:
                worker.receive(upload)
                worker.receive(upload)
                self.assertEqual(request.call_count, 1)
                self.assertEqual((root/'Imports'/upload['id']/'0.flac').read_bytes(), b'good')
                self.assertTrue(send.call_args[0][1]['results'][0]['ok'])

    def test_symlink_destination_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            identity = '12345678-1234-4234-8234-123456789abc'
            folder = root/'Imports'/identity
            folder.mkdir(parents=True)
            outside = root/'original.flac'
            outside.write_bytes(b'preserved')
            (folder/'0.flac').symlink_to(outside)
            upload = {'id': identity, 'files': [{'name': 'song.flac', 'sizeBytes': 4, 'sha256': 'a'*64, 'status': 'staged'}]}
            with patch.object(worker, 'ROOT', root), patch.object(worker, 'request') as request, patch.object(worker, 'send'):
                worker.receive(upload)
                request.assert_not_called()
                self.assertEqual(outside.read_bytes(), b'preserved')


if __name__ == '__main__':
    unittest.main()
