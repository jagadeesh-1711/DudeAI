import os
import unittest
from unittest.mock import patch, MagicMock
from starlette.testclient import TestClient
import openpyxl

# Set clean test environment
os.environ["EXCEL_FILE"] = "test_api_audit_tracker.xlsx"
os.environ["DB_FILE"] = "test_dude_ai.db"

import backend.main as app_module
from backend.main import app, ensure_excel_tracker, log_api_call, log_button_event, EXCEL_FILE


class TestDudeAIBackend(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def tearDown(self):
        # Clean up any test artifacts created during runs
        for filename in ["test_api_audit_tracker.xlsx", "test_dude_ai.db"]:
            if os.path.exists(filename):
                try:
                    os.remove(filename)
                except Exception:
                    pass

    def test_health_endpoint(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_excel_report_endpoint(self):
        ensure_excel_tracker()
        response = self.client.get("/api/reports/excel")
        self.assertEqual(response.status_code, 200)
        self.assertIn("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", response.headers.get("content-type", ""))
        self.assertIn('filename="api_audit_tracker.xlsx"', response.headers.get("content-disposition", ""))
        self.assertGreater(len(response.content), 1000)

    def test_excel_audit_tracker_structure_and_user_columns(self):
        ensure_excel_tracker()
        wb = openpyxl.load_workbook(EXCEL_FILE)
        expected_sheets = [
            "API Call Log",
            "Jira API Call Log",
            "Button Click Log",
            "Button Click Summary",
            "QA Test Cases",
            "Imported Jira Issues",
            "Frontend Backend Map",
        ]
        for name in expected_sheets:
            self.assertIn(name, wb.sheetnames)

        # Check User Name and User ID columns in API Call Log
        api_headers = [cell.value for cell in wb["API Call Log"][1]]
        self.assertIn("User Name", api_headers)
        self.assertIn("User ID", api_headers)

        # Check User Name and User ID columns in Button Click Log
        btn_headers = [cell.value for cell in wb["Button Click Log"][1]]
        self.assertIn("User Name", btn_headers)
        self.assertIn("User ID", btn_headers)

        # Check User Name and User ID columns in Imported Jira Issues
        issue_headers = [cell.value for cell in wb["Imported Jira Issues"][1]]
        self.assertIn("Imported By", issue_headers)
        self.assertIn("User ID", issue_headers)
        wb.close()

    def test_button_event_telemetry_with_user_attribution(self):
        payload = {
            "user_name": "Alex Hunter",
            "user_id": "USR-1042",
            "button_name": "Test connection",
            "click_id": "RUN-test-01",
            "click_number": 1,
            "outcome": "accepted",
            "frontend_route": "Jira connection",
            "api_endpoint": "/api/jira/test-connection"
        }
        response = self.client.post("/api/telemetry/button-event", json=payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"success": True})

    def test_jira_test_connection_internal_user_id(self):
        """When user ID is an internal ID, Jira should not falsely claim verified account."""
        mock_resp = MagicMock()
        mock_resp.is_error = False
        mock_resp.json.return_value = {
            "displayName": "Alex Atlassian",
            "accountId": "5b10ac8d82e05b22cc7d4ef5",
            "emailAddress": "alex@atlassian.com"
        }

        with patch("backend.main.timed_jira_get", return_value=mock_resp):
            payload = {
                "base_url": "https://example.atlassian.net",
                "email": "alex@atlassian.com",
                "api_token": "dummy-token",
                "user_name": "Alex Hunter",
                "user_id": "USR-1042"
            }
            response = self.client.post("/api/jira/test-connection", json=payload)
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertTrue(data["success"])
            self.assertIn("identity_status", data)
            identity = data["identity_status"]
            self.assertEqual(identity["user_name"], "Alex Hunter")
            self.assertEqual(identity["user_id"], "USR-1042")
            self.assertEqual(identity["status"], "internal_application_id")
            self.assertFalse(identity["verified_jira_account"])
            self.assertIn("internal application ID", identity["message"])

    def test_jira_test_connection_verified_account_id(self):
        """When user ID matches Atlassian accountId, it is verified as Jira account ID."""
        jira_acc = "5b10ac8d82e05b22cc7d4ef5"
        mock_resp = MagicMock()
        mock_resp.is_error = False
        mock_resp.json.return_value = {
            "displayName": "Alex Atlassian",
            "accountId": jira_acc,
            "emailAddress": "alex@atlassian.com"
        }

        with patch("backend.main.timed_jira_get", return_value=mock_resp):
            payload = {
                "base_url": "https://example.atlassian.net",
                "email": "alex@atlassian.com",
                "api_token": "dummy-token",
                "user_name": "Alex Hunter",
                "user_id": jira_acc
            }
            response = self.client.post("/api/jira/test-connection", json=payload)
            self.assertEqual(response.status_code, 200)
            data = response.json()
            identity = data["identity_status"]
            self.assertTrue(identity["verified_jira_account"])
            self.assertEqual(identity["status"], "verified_jira_account_id")
            self.assertIn("verified as your Jira Cloud account ID", identity["message"])


if __name__ == "__main__":
    unittest.main()
