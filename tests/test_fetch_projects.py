import io
import tempfile
import unittest
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from scripts.fetch_projects import REQUIRED, collect, extract_bundle, find_artifact


def bundle(extra=None):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        for name in REQUIRED | {'handelser.html'}:
            archive.writestr(name, 'fixture')
        if extra:
            archive.writestr(*extra)
    return buffer.getvalue()


class ReceiverTests(unittest.TestCase):
    def test_valid_bundle_and_missing_required_file(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            extract_bundle(bundle(), target, 'insider')
            self.assertTrue((target / 'index.html').exists())
            data = io.BytesIO()
            with zipfile.ZipFile(data, 'w') as archive:
                archive.writestr('index.html', 'only page')
            with self.assertRaises(ValueError):
                extract_bundle(data.getvalue(), target, 'insider')

    def test_traversal_absolute_windows_path_and_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            for name in ('../outside', '/absolute', 'folder/../../escape', 'C:\\escape'):
                with self.subTest(name=name), self.assertRaises(ValueError):
                    extract_bundle(bundle((name, 'bad')), Path(directory), 'insider')
            info = zipfile.ZipInfo('symlink')
            info.create_system = 3
            info.external_attr = 0o120777 << 16
            with self.assertRaises(ValueError):
                extract_bundle(bundle((info, '/outside')), Path(directory), 'insider')

    def test_finds_recent_successful_web_run_skipping_morning(self):
        now = datetime(2026, 10, 9, 16, 45, tzinfo=timezone.utc)
        runs = {'workflow_runs': [{'id': 2, 'created_at': '2026-10-09T04:30:00Z'},
                                  {'id': 1, 'created_at': '2026-10-08T16:00:00Z'}]}
        artifacts = {'artifacts': [{'id': 7, 'name': 'insider-web', 'expired': False}]}
        with patch('scripts.fetch_projects.api', side_effect=[runs, {'artifacts': []}, artifacts]):
            self.assertEqual(find_artifact('owner/repo', 'insider.yml', 'insider-web', now)['run_id'], 1)
        runs['workflow_runs'] = [{'id': 0, 'created_at': '2026-10-01T16:00:00Z'}]
        with patch('scripts.fetch_projects.api', return_value=runs), self.assertRaises(RuntimeError):
            find_artifact('owner/repo', 'insider.yml', 'insider-web', now)

    def test_partial_delivery_preserves_other_projects_and_removes_failed_staging(self):
        artifact = {'id': 7, 'run_id': 1, 'created_at': '2026-10-09T16:00:00Z', 'repository': 'owner/repo'}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ('insider', 'blankdiss', 'reports', 'other-project'):
                (root / 'dist' / name).mkdir(parents=True)
                (root / 'dist' / name / 'old.txt').write_text('old')
            with patch('scripts.fetch_projects.find_artifact', side_effect=[artifact, RuntimeError('missing'), RuntimeError('missing'), RuntimeError('missing')]), patch('scripts.fetch_projects.api', return_value=bundle()):
                result = collect(root)
            self.assertEqual(set(result), {'blankdiss'})
            self.assertTrue((root / 'dist/blankdiss/index.html').exists())
            self.assertFalse((root / 'dist/blankdiss/old.txt').exists())
            self.assertFalse((root / 'dist/insider').exists())
            self.assertFalse((root / 'dist/reports').exists())
            self.assertTrue((root / 'dist/other-project/old.txt').exists())

    def test_reports_requires_both_signal_pages_and_calendar(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                extract_bundle(bundle(), Path(directory), 'reports')
            data = io.BytesIO()
            with zipfile.ZipFile(data, 'w') as archive:
                for name in REQUIRED | {'handelser.html', 'saljlage.html', 'kalender.html'}:
                    archive.writestr(name, 'fixture')
            extract_bundle(data.getvalue(), Path(directory), 'reports')
            self.assertTrue((Path(directory) / 'saljlage.html').exists())

    def test_reports_accepts_latest_successful_manual_or_force_bundle(self):
        now = datetime(2026, 10, 11, 12, tzinfo=timezone.utc)
        runs = {'workflow_runs': [{'id': 8, 'created_at': '2026-10-11T10:00:00Z'}]}
        artifact = {'id': 9, 'name': 'reports-web', 'expired': False}
        with patch('scripts.fetch_projects.api', side_effect=[runs, {'artifacts': [artifact]}]) as api:
            found = find_artifact('appsyndroms/Reports', None, 'reports-web', now)
            self.assertEqual(found['run_id'], 8)
            self.assertIn('/actions/runs?', api.call_args_list[0].args[0])

    def test_no_available_artifacts_does_not_write_staging(self):
        with tempfile.TemporaryDirectory() as directory, patch('scripts.fetch_projects.find_artifact', side_effect=RuntimeError('missing')):
            with self.assertRaises(RuntimeError):
                collect(Path(directory))
            self.assertFalse((Path(directory) / 'dist').exists())
