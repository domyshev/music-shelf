"""Keep the existing music tree visible only after API audio verification."""
import json
import pathlib
import urllib.request

root = pathlib.Path('/home/ilia/Music/SpotiFLAC-API').resolve()
ignore = root / '.ndignore'
try:
    with urllib.request.urlopen('http://127.0.0.1:9180/v1/jobs', timeout=10) as response:
        jobs = json.load(response)['jobs']
except Exception:
    if ignore.exists():
        raise SystemExit(0)
    raise
allowed = set()
allowed.update(('!/MusicShelfPlaylists/', '!/MusicShelfPlaylists/**'))
for job in jobs:
    if job.get('state') != 'completed':
        continue
    filename = (job.get('result') or {}).get('file')
    if not filename:
        continue
    path = pathlib.Path(filename).resolve()
    if not path.is_file() or not path.is_relative_to(root):
        continue
    relative = path.relative_to(root)
    # API output uses one Spotify ID directory per track.
    folder = relative.parts[0]
    if len(relative.parts) != 2 or not folder.isalnum():
        continue
    allowed.add('!/' + folder + '/')
    allowed.add('!/' + folder + '/**')
text = '# Managed by navidrome-library-sync; only verified completed track folders.\n/*\n' + '\n'.join(sorted(allowed)) + '\n'
if not ignore.exists() or ignore.read_text() != text:
    temporary = ignore.with_suffix('.tmp')
    temporary.write_text(text)
    temporary.replace(ignore)
print(f'Verified tracks exposed: {(len(allowed) - 2) // 2}')
