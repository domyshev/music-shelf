#!/usr/bin/env python3
"""Verify local music and pull imports from Music Shelf using outbound HTTPS only."""
import base64
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import subprocess
import tempfile
import time
import urllib.request
import uuid

SITE = os.environ.get('SHELF_SITE', 'http://127.0.0.1:4174').rstrip('/')
ROOT = Path(os.environ.get('SHELF_MUSIC_ROOT', 'music')).resolve()
STATE = Path(os.environ.get('SHELF_STORAGE_STATE', 'storage-state')).resolve()
KEY = Path(os.environ.get('SHELF_STORAGE_PRIVATE_KEY_FILE', 'storage.key'))
FFPROBE = os.environ.get('SHELF_FFPROBE', 'ffprobe')
FFMPEG = os.environ.get('SHELF_FFMPEG', 'ffmpeg')
AUDIO = {'.flac', '.mp3', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.aiff', '.aif'}
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


HTTP = urllib.request.build_opener(NoRedirect)
MAX_FILE = 512 * 1024 * 1024
DEMUXERS = {'.flac':'flac','.mp3':'mp3','.m4a':'mov','.aac':'aac','.ogg':'ogg','.opus':'ogg','.wav':'wav','.aiff':'aiff','.aif':'aiff'}


def request(path, payload):
    body = json.dumps({'nonce': secrets.token_hex(16), **payload}, separators=(',', ':')).encode()
    stamp = str(int(time.time()))
    with tempfile.TemporaryDirectory(prefix='shelf-sign-') as temp:
        message, signature = Path(temp)/'message', Path(temp)/'signature'
        message.write_bytes(stamp.encode()+b'\n'+path.encode()+b'\n'+body)
        subprocess.run(['openssl', 'pkeyutl', '-sign', '-inkey', str(KEY), '-rawin', '-in', str(message), '-out', str(signature)], check=True, capture_output=True, timeout=10)
        signed = base64.b64encode(signature.read_bytes()).decode()
    req = urllib.request.Request(SITE+path, data=body, method='POST', headers={
        'Content-Type': 'application/json', 'User-Agent': 'MusicShelfPublisher/1.0',
        'X-Shelf-Timestamp': stamp, 'X-Shelf-Signature': signed,
    })
    return HTTP.open(req, timeout=120)


def send(path, payload):
    with request(path, payload) as response:
        return json.load(response)


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024*1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def probe(path, digest=None, suffix=None):
    if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(ROOT):
        raise ValueError('Unsafe file')
    if not 0 < path.stat().st_size <= MAX_FILE:
        raise ValueError('Invalid size')
    demuxer = DEMUXERS[suffix or path.suffix.lower()]
    raw = subprocess.run([FFPROBE, '-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', demuxer, '-show_format', '-show_streams', '-of', 'json', str(path)], capture_output=True, check=True, timeout=60)
    data = json.loads(raw.stdout)
    stream = next((s for s in data['streams'] if s.get('codec_type') == 'audio'), None)
    if not stream:
        raise ValueError('No audio stream')
    duration = float(data['format'].get('duration', stream.get('duration', 0)))
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError('Invalid duration')
    subprocess.run([FFMPEG, '-nostdin', '-v', 'error', '-xerror', '-protocol_whitelist', 'file,pipe', '-f', demuxer, '-i', str(path), '-map', '0:a:0', '-f', 'null', '-'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=600)
    tags = {k.lower(): str(v) for k, v in data['format'].get('tags', {}).items()}
    tags.update({k.lower(): str(v) for k, v in stream.get('tags', {}).items()})
    year = re.match(r'^(\d{4})', tags.get('date', tags.get('year', '')))
    year = int(year[1]) if year else None
    if year is not None and not 1800 <= year <= 2200:
        year = None
    checksum = digest or sha256(path)
    return {'id': 'sha256:'+checksum, 'title': tags.get('title', path.stem)[:1000] or path.stem,
            'artist': tags.get('artist', 'Unknown artist')[:1000] or 'Unknown artist',
            'album': tags.get('album', '')[:1000], 'year': year, 'status': 'ready',
            'file': {'name': path.name[:512], 'sha256': checksum, 'sizeBytes': path.stat().st_size,
                     'format': (suffix or path.suffix).lstrip('.').lower(), 'codec': stream['codec_name'],
                     'sampleRate': int(stream.get('sample_rate', 0)),
                     'bitDepth': int(stream.get('bits_per_raw_sample') or stream.get('bits_per_sample') or 0),
                     'channels': int(stream.get('channels', 0)), 'durationSeconds': duration,
                     'bitrateBps': int(data['format'].get('bit_rate') or 0)}}


def receive(upload):
    identity = str(uuid.UUID(upload['id']))
    if identity != upload['id'] or not 1 <= len(upload['files']) <= 200:
        raise ValueError('Invalid upload')
    folder = ROOT/'Imports'/identity
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    if folder.is_symlink() or not folder.resolve().is_relative_to(ROOT):
        raise ValueError('Unsafe destination')
    results = []
    for index, item in enumerate(upload['files']):
        if item.get('status') == 'failed':
            results.append({'ok': False, 'index': index, 'error': 'unsupported_file'})
            continue
        try:
            suffix = Path(item['name']).suffix.lower()
            digest = item['sha256']
            size = item['sizeBytes']
            if suffix not in AUDIO or not re.fullmatch(r'[a-f0-9]{64}', digest) or not isinstance(size, int) or not 0 < size <= MAX_FILE:
                raise ValueError('Invalid file')
            dest = folder/f'{index}{suffix}'
            if dest.is_symlink():
                raise ValueError('Unsafe destination')
            if not dest.exists():
                incoming = ROOT/'.incoming'
                incoming.mkdir(exist_ok=True, mode=0o700)
                if incoming.is_symlink():
                    raise ValueError('Unsafe staging directory')
                fd, temporary = tempfile.mkstemp(dir=incoming)
                try:
                    with os.fdopen(fd, 'wb') as output, request('/api/storage/file', {'id': identity, 'index': index}) as response:
                        count = 0
                        for chunk in iter(lambda: response.read(1024*1024), b''):
                            count += len(chunk)
                            if count > size:
                                raise ValueError('File exceeds expected size')
                            output.write(chunk)
                        output.flush()
                        os.fsync(output.fileno())
                    temp = Path(temporary)
                    if temp.stat().st_size != size or sha256(temp) != digest:
                        raise ValueError('Checksum mismatch')
                    # Validate bytes before exposing the file to the library scanner.
                    track = probe(temp, digest, suffix)
                    os.link(temp, dest)
                finally:
                    Path(temporary).unlink(missing_ok=True)
            if dest.stat().st_size != size or sha256(dest) != digest:
                raise ValueError('Stored file differs')
            track = probe(dest, digest)
            # Keep the original basename in catalog metadata, without trusting it as a path.
            track['file']['name'] = item['name'].replace('\\', '/').split('/')[-1][:512]
            results.append({'ok': True, 'index': index, 'track': track})
        except (ValueError, KeyError, subprocess.SubprocessError):
            results.append({'ok': False, 'index': index, 'error': 'invalid_audio'})
        except OSError:
            # Connectivity and disk errors are retryable; do not finalize a failed delivery.
            raise
    send('/api/storage/complete', {'id': identity, 'results': results})


def scan():
    cache_path = STATE/'files.json'
    try:
        cache = json.loads(cache_path.read_text())
    except (FileNotFoundError, ValueError):
        cache = {}
    updated = {}
    for path in ROOT.rglob('*'):
        if path.suffix.lower() not in AUDIO or path.is_symlink() or not path.is_file():
            continue
        relative = path.relative_to(ROOT)
        if any(part.startswith('.') for part in relative.parts):
            continue
        stat = path.stat()
        stamp = [stat.st_size, stat.st_mtime_ns]
        previous = cache.get(str(relative))
        try:
            if previous and previous.get('stamp') == stamp:
                updated[str(relative)] = previous
                continue
            track = probe(path)
            result = send('/api/storage/register', {'track': track})
            updated[str(relative)] = {'stamp': stamp, 'id': result['id']}
        except (ValueError, KeyError, subprocess.SubprocessError):
            print('Music Shelf: invalid audio skipped', flush=True)
    temporary = STATE/'files.tmp'
    temporary.write_text(json.dumps(updated))
    os.replace(temporary, cache_path)
    # Fail closed: expose only individually verified files and their parent directories.
    allowed = {'!/MusicShelfPlaylists/', '!/MusicShelfPlaylists/**'}
    for relative in updated:
        parts = Path(relative).parts
        if any('\n' in part or '\r' in part or any(c in part for c in '*?[]!#') for part in parts):
            continue
        for end in range(1, len(parts)):
            allowed.add('!/'+'/'.join(parts[:end])+'/')
        allowed.add('!/'+relative)
    rules = '# Managed by Music Shelf storage worker.\n/*\n'+'\n'.join(sorted(allowed))+'\n'
    temp = ROOT/'.ndignore.tmp'
    temp.write_text(rules)
    os.replace(temp, ROOT/'.ndignore')


def main():
    os.umask(0o077)
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Refuse concurrent workers that could race over the import and manifest files.
    import fcntl
    lock = (STATE/'worker.lock').open('w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    next_scan = 0
    while True:
        try:
            if time.monotonic() >= next_scan:
                scan()
                next_scan = time.monotonic()+60
            poll = send('/api/storage/poll', {})
            upload = poll.get('upload')
            from selection_playlists import reconcile
            manifest_path = STATE/'files.json'
            manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
            reconcile(ROOT, poll.get('selections', []), {item['id']: str(ROOT/relative) for relative, item in manifest.items()})
            if upload:
                receive(upload)
                next_scan = 0
            else:
                time.sleep(5)
        except Exception:
            print('Music Shelf storage unavailable; retrying', flush=True)
            time.sleep(15)


if __name__ == '__main__':
    main()
