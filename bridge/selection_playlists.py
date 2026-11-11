"""Reconcile Music Shelf selections into playlists of verified local files."""
import os
import re
import tempfile
from pathlib import Path

SPOTIFY_ID = re.compile(r'^[A-Za-z0-9]{22}$')
TAG_NAME = re.compile(r'^agent-[a-z0-9]+(?:\.[a-z0-9]+)*-[1-9][0-9]{0,3}$')
TAG_ID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')


def reconcile(root, selections, jobs):
    root = Path(root).resolve(strict=True)
    folder = root / 'MusicShelfPlaylists'
    folder.mkdir(mode=0o700, exist_ok=True)
    if folder.is_symlink() or not folder.is_dir():
        raise ValueError('Invalid playlist directory')
    if not isinstance(selections, list) or not isinstance(jobs, list):
        raise ValueError('Invalid synchronization data')
    verified = {}
    for job in jobs:
        if job.get('state') != 'completed':
            continue
        track_id = (job.get('track') or {}).get('spotify_id')
        name = (job.get('result') or {}).get('file')
        if not isinstance(track_id, str) or not SPOTIFY_ID.fullmatch(track_id) or not isinstance(name, str):
            continue
        path = Path(name).resolve()
        if path.is_file() and path.parent == root / track_id and not any(c in str(path) for c in '\r\n'):
            verified[track_id] = path
    written = 0
    for selection in selections:
        if not isinstance(selection, dict):
            raise ValueError('Invalid selection')
        tag_id, name, track_ids = selection.get('id'), selection.get('name'), selection.get('trackIds')
        if not isinstance(tag_id, str) or not TAG_ID.fullmatch(tag_id) or not isinstance(name, str) or not TAG_NAME.fullmatch(name):
            raise ValueError('Invalid selection identity')
        if not isinstance(track_ids, list) or len(track_ids) > 1000 or any(not isinstance(i, str) or len(i) > 200 for i in track_ids):
            raise ValueError('Invalid selection tracks')
        text = '#EXTM3U\n' + ''.join(str(verified[i]) + '\n' for i in track_ids if i in verified)
        dest = folder / (name + '.m3u')
        marker = folder / ('.' + name + '.owner')
        if dest.is_symlink() or marker.is_symlink():
            raise ValueError('Invalid playlist destination')
        if marker.exists():
            if marker.read_text(encoding='utf-8') != tag_id:
                raise ValueError('Playlist belongs to another selection')
        else:
            if dest.exists():
                raise ValueError('Refusing to overwrite an unmanaged playlist')
            with marker.open('x', encoding='utf-8') as output:
                output.write(tag_id)
        if dest.exists() and dest.read_text(encoding='utf-8') == text:
            continue
        fd, temp = tempfile.mkstemp(prefix='.music-shelf-', dir=folder)
        try:
            with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as output:
                output.write(text)
            os.replace(temp, dest)
        finally:
            if os.path.exists(temp):
                os.unlink(temp)
        written += 1
    return written
