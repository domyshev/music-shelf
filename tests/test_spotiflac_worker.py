import importlib.util
import pathlib
import time
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('worker',pathlib.Path(__file__).parent.parent/'bridge/spotiflac-worker.py')
worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)

def job(kind,payload):return {'kind':kind,'payload':payload,'expires':int(time.time()*1000)+30000}

class WorkerTests(unittest.TestCase):
    def test_search_transforms_only_valid_metadata(self):
        result={'tracks':[{'id':'a'*22,'name':'Title','artists':'Artist','album_name':'Album','duration_ms':123000},{'id':'invalid','name':'Bad','artists':'X','duration_ms':1000}]}
        with patch.object(worker,'local',return_value=result):
            tracks=worker.run(job('search',{'query':'test'}))['tracks']
        self.assertEqual(tracks,[{'spotify_id':'a'*22,'title':'Title','artist':'Artist','album':'Album','duration':123,'service':'auto'}])
    def test_queue_status_excludes_private_file_paths(self):
        data={'paused':False,'jobs':[{'id':'id','state':'completed','track':{'title':'Song','artist':'Artist','spotify_id':'a'*22},'result':{'file':'/private/path'}}]}
        with patch.object(worker,'local',return_value=data):result=worker.run(job('queue_status',{}))
        self.assertEqual(result['counts'],{'completed':1});self.assertNotIn('/private/path',str(result))
    def test_bad_enqueue_never_contacts_api(self):
        with patch.object(worker,'local') as local:
            with self.assertRaises(ValueError):worker.run(job('enqueue',{'tracks':[{'spotify_id':'invalid'}]}))
            local.assert_not_called()
    def test_enqueue_forwards_only_allowlisted_recordings(self):
        track={'spotify_id':'b'*22,'title':'Title','artist':'Artist','album':'Album','duration':180,'service':'auto'}
        with patch.object(worker,'local',return_value={'created':1,'paused':False,'jobs':[]} ) as local:
            result=worker.run(job('enqueue',{'tracks':[track]}))
        self.assertEqual(result['created'],1);local.assert_called_once_with('/v1/jobs',{'tracks':[track]},timeout=20)
    def test_retry_settings_are_validated_and_forwarded(self):
        with patch.object(worker,'local',return_value={'auto_stop':True,'max_attempts':100}) as local:
            result=worker.run(job('set_retry_settings',{'auto_stop':True,'max_attempts':100}))
            self.assertEqual(result,{'auto_stop':True,'max_attempts':100});local.assert_called_once_with('/v1/settings',{'auto_stop':True,'max_attempts':100},timeout=15,method='PUT')
        with patch.object(worker,'local') as local:
            with self.assertRaises(ValueError):worker.run(job('set_retry_settings',{'auto_stop':True,'max_attempts':0}))
            local.assert_not_called()
    def test_no_commands_or_urls_are_executed(self):
        with self.assertRaises(ValueError):worker.run(job('shell',{'command':'anything'}))

if __name__=='__main__':unittest.main()
