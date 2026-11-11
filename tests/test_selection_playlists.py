import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'bridge'))
from selection_playlists import reconcile


class SelectionPlaylistTests(unittest.TestCase):
    def test_only_completed_verified_files_are_added_and_later_downloads_appear(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            first, second = 'A' * 22, 'B' * 22
            for song in (first, second):
                (root / song).mkdir()
                (root / song / 'audio.flac').write_bytes(b'audio')
            selection = {'id': '12345678-1234-1234-1234-123456789abc', 'name': 'agent-moon.dust-2', 'trackIds': [first, second]}
            jobs = [{'state': state, 'track': {'spotify_id': song}, 'result': {'file': str(root / song / 'audio.flac')}} for song, state in [(first, 'completed'), (second, 'queued')]]
            self.assertEqual(reconcile(root, [selection], jobs), 1)
            playlist = root / 'MusicShelfPlaylists' / 'agent-moon.dust-2.m3u'
            self.assertEqual(playlist.read_text().splitlines(), ['#EXTM3U', str(root / first / 'audio.flac')])
            self.assertEqual(reconcile(root, [selection], jobs), 0)
            jobs[1]['state'] = 'completed'
            self.assertEqual(reconcile(root, [selection], jobs), 1)
            self.assertEqual(playlist.read_text().splitlines(), ['#EXTM3U', str(root / first / 'audio.flac'), str(root / second / 'audio.flac')])

    def test_rejects_untrusted_paths_and_preserves_unrelated_playlists(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            selections = root / 'MusicShelfPlaylists'
            selections.mkdir()
            unrelated = selections / 'other.m3u'
            unrelated.write_text('leave alone')
            bad = {'id': '12345678-1234-1234-1234-123456789abc', 'name': '../../other', 'trackIds': []}
            with self.assertRaises(ValueError):
                reconcile(root, [bad], [])
            self.assertEqual(unrelated.read_text(), 'leave alone')

    def test_does_not_overwrite_a_playlist_it_did_not_create(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            (root / 'MusicShelfPlaylists').mkdir()
            existing = root / 'MusicShelfPlaylists' / 'agent-moon.dust-1.m3u'
            existing.write_text('personal playlist')
            selection = {'id': '12345678-1234-1234-1234-123456789abc', 'name': 'agent-moon.dust-1', 'trackIds': ['A' * 22]}
            with self.assertRaises(ValueError):
                reconcile(root, [selection], [])
            self.assertEqual(existing.read_text(), 'personal playlist')


if __name__ == '__main__':
    unittest.main()
