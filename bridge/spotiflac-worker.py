#!/usr/bin/env python3
"""Poll Music Shelf and execute a small allowlist of local SpotiFLAC operations."""
import base64
import json
import re
import secrets
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SITE='https://music-shelf.domyshev.com'
LOCAL='http://127.0.0.1:9180'
KEY=Path.home()/'.config/songs-catalog/publisher.key'
ID=re.compile(r'^[A-Za-z0-9]{22}$')

def send(path, data):
    body=json.dumps({'nonce':secrets.token_hex(16),**data},separators=(',',':')).encode()
    stamp=str(int(time.time()))
    with tempfile.TemporaryDirectory(prefix='music-shelf-bridge-') as temp:
        message=Path(temp)/'message';signature=Path(temp)/'signature'
        message.write_bytes(stamp.encode()+b'\n'+path.encode()+b'\n'+body)
        subprocess.run(['openssl','pkeyutl','-sign','-inkey',str(KEY),'-rawin','-in',str(message),'-out',str(signature)],capture_output=True,check=True,timeout=10)
        headers={'Content-Type':'application/json','User-Agent':'MusicShelfPublisher/1.0','X-Shelf-Timestamp':stamp,'X-Shelf-Signature':base64.b64encode(signature.read_bytes()).decode()}
    request=urllib.request.Request(SITE+path,data=body,headers=headers,method='POST')
    with urllib.request.urlopen(request,timeout=20) as response:return json.load(response)

def local(path,data=None,timeout=60,method=None):
    request=urllib.request.Request(LOCAL+path,data=None if data is None else json.dumps(data).encode(),headers={'Content-Type':'application/json'},method=method)
    with urllib.request.urlopen(request,timeout=timeout) as response:return json.load(response)

def clean_text(value,limit):
    if not isinstance(value,str) or not value.strip() or len(value)>limit or any(ord(c)<32 for c in value):raise ValueError('Invalid text')
    return value

def run(job):
    kind=job['kind'];payload=job['payload']
    if time.time()*1000 >= job['expires']:return {'error':'Request expired'}
    if kind=='search':
        q=clean_text(payload.get('query'),200)
        data=local('/v1/search?'+urllib.parse.urlencode({'q':q,'limit':20}))
        tracks=[]
        for t in data.get('tracks',[]):
            try:
                sid=t.get('id',''); duration=t.get('duration_ms')
                if not ID.fullmatch(sid) or not isinstance(duration,(int,float)) or not 1000<=duration<=14400000:continue
                tracks.append({'spotify_id':sid,'title':clean_text(t.get('name'),1000),'artist':clean_text(t.get('artists'),1000),'album':str(t.get('album_name') or '')[:1000],'duration':round(duration/1000),'service':'auto'})
            except (ValueError,TypeError):continue
        return {'tracks':tracks}
    if kind=='queue_status':
        data=local('/v1/jobs',timeout=15);jobs=data.get('jobs',[]);counts={}
        for j in jobs:counts[j.get('state','unknown')]=counts.get(j.get('state','unknown'),0)+1
        items=[{'id':j.get('id'),'spotify_id':j.get('track',{}).get('spotify_id'),'title':j.get('track',{}).get('title'),'artist':j.get('track',{}).get('artist'),'state':j.get('state'),'attempts':j.get('attempts'),'next_attempt_at':j.get('next_attempt_at'),'error_code':j.get('error_code')} for j in jobs[-100:]]
        return {'paused':data.get('paused'),'active_id':data.get('active_id'),'counts':counts,'jobs':items,'truncated':len(jobs)>100}
    if kind=='retry_settings':
        if payload!={}:raise ValueError('Invalid settings request')
        data=local('/v1/settings',timeout=15)
        return {'auto_stop':data['auto_stop'],'max_attempts':data['max_attempts']}
    if kind=='set_retry_settings':
        if set(payload)!={'auto_stop','max_attempts'} or type(payload['auto_stop']) is not bool or type(payload['max_attempts']) is not int or not 1<=payload['max_attempts']<=1000000:raise ValueError('Invalid retry settings')
        data=local('/v1/settings',payload,timeout=15,method='PUT')
        return {'auto_stop':data['auto_stop'],'max_attempts':data['max_attempts']}
    if kind=='enqueue':
        tracks=payload.get('tracks')
        if not isinstance(tracks,list) or not 1<=len(tracks)<=20:raise ValueError('Invalid tracks')
        for t in tracks:
            if set(t)!={'spotify_id','title','artist','album','duration','service'} or not ID.fullmatch(t['spotify_id']) or t['service']!='auto' or not isinstance(t['duration'],int) or not 1<=t['duration']<=14400:raise ValueError('Invalid track')
            clean_text(t['title'],1000);clean_text(t['artist'],1000)
            if not isinstance(t['album'],str) or len(t['album'])>1000:raise ValueError('Invalid album')
        data=local('/v1/jobs',{'tracks':tracks},timeout=20)
        return {'created':data.get('created'),'paused':data.get('paused'),'jobs':[{'id':j.get('id'),'state':j.get('state'),'title':j.get('track',{}).get('title'),'spotify_id':j.get('track',{}).get('spotify_id')} for j in data.get('jobs',[])]}
    raise ValueError('Unknown operation')

def main():
    while True:
        try:
            job=send('/api/bridge/claim',{}).get('job')
            if job:
                try:result=run(job)
                except Exception:result={'error':'SpotiFLAC operation failed or is unavailable'}
                send('/api/bridge/complete',{'id':job['id'],'result':result})
            else:time.sleep(3)
        except Exception:
            print('Music Shelf bridge unavailable; retrying',flush=True);time.sleep(10)
if __name__=='__main__':main()
