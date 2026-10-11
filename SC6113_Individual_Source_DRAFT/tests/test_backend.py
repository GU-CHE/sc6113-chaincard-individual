import os
import unittest
from unittest.mock import patch
import app as module


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.client = module.app.test_client()

    def test_dashboard_reads_real_contract_and_events(self):
        response = self.client.get('/api/dashboard')
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json['total_donated_wei'], '10000000000000000')
        self.assertEqual(response.json['total_withdrawn_wei'], '4000000000000000')
        self.assertEqual(response.json['balance_wei'], '6000000000000000')
        self.assertEqual([t['kind'] for t in response.json['transactions']], ['withdrawal','donation'])

    def test_success_receipt(self):
        response = self.client.get('/api/transactions/' + os.environ['TEST_DONATION_HASH'])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['status'], 'success')

    def test_invalid_hash(self):
        self.assertEqual(self.client.get('/api/transactions/not-a-hash').status_code, 400)

    def test_pending_hash(self):
        response = self.client.get('/api/transactions/0x' + '1' * 64)
        self.assertEqual(response.json['status'], 'pending')

    def test_unconfigured_contract_disables_app(self):
        with patch.object(module, 'ADDRESS', ''):
            self.assertFalse(self.client.get('/api/config').json['configured'])
            self.assertEqual(self.client.get('/api/dashboard').status_code, 503)

    def test_rpc_failure_is_not_success(self):
        with patch.object(module, 'contract', side_effect=RuntimeError('offline')):
            self.assertEqual(self.client.get('/api/dashboard').status_code, 503)

    def test_source_assets_and_security_headers(self):
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'Sepolia', response.data)
        self.assertIn("frame-ancestors 'none'", response.headers['Content-Security-Policy'])
        self.assertEqual(self.client.get('/Donation.json').status_code, 200)
        self.assertEqual(self.client.get('/vendor/ethers.umd.min.js').status_code, 200)
