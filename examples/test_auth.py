import hashlib
import hmac
import unittest
from unittest.mock import patch
import requests
from bravado_auth import BravadoAuth, canonical_path, BravadoSession

class SigningTests(unittest.TestCase):
    def test_canonical_query(self):
        self.assertEqual(canonical_path('https://partner-api.bravadotrade.com/a%20b/?z=a+b&a=%21'), '/a b?a=%21&z=a%20b')
        with self.assertRaises(ValueError): canonical_path('https://partner-api.bravadotrade.com/a?a=1&a=2')

    def test_prepared_json_and_retry(self):
        auth = BravadoAuth('public-test', 'secret-test')
        signatures = []
        for stamp in [1700000000000000000, 1700000001000000000]:
            with patch('bravado_auth.time.time_ns', return_value=stamp):
                req = requests.Request('POST', 'https://partner-api.bravadotrade.com/v2/trade/order',
                    json={'label': 'café', 'size': 2}, headers={'Idempotency-Key':'same-intent'}, auth=auth).prepare()
            ts = str(stamp // 1000000)
            payload = '\n'.join([ts,'POST','/v2/trade/order',hashlib.sha256(req.body).hexdigest()])
            expected = hmac.new(b'secret-test',payload.encode(),hashlib.sha256).hexdigest()
            self.assertEqual(req.headers['X-BRAVADO-SIGNATURE'], expected)
            self.assertEqual(req.headers['Idempotency-Key'], 'same-intent')
            signatures.append(expected)
        self.assertNotEqual(*signatures)

    def test_empty_body_and_credential_binding(self):
        req = requests.Request('GET', 'https://partner-api.bravadotrade.com/traders/test?p=a+b', auth=BravadoAuth('user-key','user-secret')).prepare()
        self.assertEqual(req.headers['X-BRAVADO-API-KEY'], 'user-key')
        payload = '\n'.join([req.headers['X-BRAVADO-TIMESTAMP'],'GET','/traders/test?p=a%20b',hashlib.sha256(b'').hexdigest()])
        self.assertEqual(req.headers['X-BRAVADO-SIGNATURE'], hmac.new(b'user-secret',payload.encode(),hashlib.sha256).hexdigest())

    def test_external_origin_rejected(self):
        with self.assertRaises(ValueError): requests.Request('GET','https://example.com',auth=BravadoAuth('key','secret')).prepare()

    def test_explicit_master_and_no_redirects(self):
        session=BravadoSession()
        with patch.dict('os.environ', {}, clear=True), patch.object(session,'send') as send:
            session.get('https://partner-api.bravadotrade.com/v2/trade/account',auth=BravadoAuth('master','matching-secret'))
        args,kwargs=send.call_args
        self.assertFalse(kwargs['allow_redirects'])
        self.assertEqual(args[0].headers['X-BRAVADO-API-KEY'],'master')

if __name__=='__main__': unittest.main()
