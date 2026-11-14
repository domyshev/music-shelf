#!/usr/bin/env python3
"""Run real import verification using only disposable containers, databases and music."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

bundle = Path(sys.argv[1]).resolve()
ffmpeg, ffprobe = sys.argv[2:4]
name = 'shelf-isolated-verification-'+uuid.uuid4().hex[:12]
work = Path(tempfile.mkdtemp(prefix='shelf-isolated-'))
worker = None
try:
    web, music, state, private = (work/p for p in ('web','music','state','private'))
    for p in (web,music,state,private):
        p.mkdir(mode=0o700)
    subprocess.run(['openssl','genpkey','-algorithm','ED25519','-out',str(private/'storage.key')],check=True,capture_output=True)
    subprocess.run(['openssl','pkey','-in',str(private/'storage.key'),'-pubout','-out',str(web/'storage.pub')],check=True,capture_output=True)
    subprocess.run(['docker','run','-d','--name',name,'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=256m','--pids-limit=64','--tmpfs','/tmp:size=16m','--network=none','-v',str(bundle)+':/app:ro','-v',str(web)+':/data','-w','/app','node:24-alpine','node','server.mjs'],check=True,capture_output=True)
    pid = subprocess.check_output(['docker','inspect','-f','{{.State.Pid}}',name],text=True).strip()
    for _ in range(30):
        ready = subprocess.run(['docker','exec',name,'node','-e',"fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],capture_output=True)
        if ready.returncode == 0:
            break
        time.sleep(1)
    else:
        raise RuntimeError('Isolated server failed to start')
    env = {**os.environ,'SHELF_SITE':'http://127.0.0.1:8080','SHELF_MUSIC_ROOT':str(music),'SHELF_STORAGE_STATE':str(state),'SHELF_STORAGE_PRIVATE_KEY_FILE':str(private/'storage.key'),'SHELF_FFMPEG':ffmpeg,'SHELF_FFPROBE':ffprobe}
    with (work/'worker.log').open('w') as log:
        worker = subprocess.Popen(['nsenter','--target',pid,'--net','python3','-B',str(bundle/'storage/worker.py')],env=env,stdout=log,stderr=log)
        subprocess.run(['docker','exec',name,'node','client.mjs'],check=True,timeout=90)
    result = json.loads((web/'verified.json').read_text())
    for report in result['reports']:
        audio = music/'Imports'/report['id']/'0.wav'
        assert hashlib.sha256(audio.read_bytes()).hexdigest() == result['sha256']
        assert not (web/'staging'/report['id']).exists()
    print('PASS: real audio decode, file import, ZIP import, hashes, distinct upload IDs, content deduplication and staging cleanup')
except Exception:
    subprocess.run(['docker','logs','--tail','15',name],check=False)
    if (work/'worker.log').exists():
        print((work/'worker.log').read_text())
    raise
finally:
    if worker:
        worker.terminate()
        try:
            worker.wait(timeout=15)
        except subprocess.TimeoutExpired:
            worker.kill()
            worker.wait()
    subprocess.run(['docker','rm','-f',name],capture_output=True,check=False)
    shutil.rmtree(work)
    print('Disposable container, database, keys and audio removed')
