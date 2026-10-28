import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Cable, CheckCircle2, FileText, FolderKanban, RefreshCw, Search,
  ShieldCheck, X, LoaderCircle, ExternalLink, FileSpreadsheet, User,
  UserCheck, Sparkles, Smile, ShieldAlert, UploadCloud, AlertTriangle
} from 'lucide-react';

const DEFAULT_PROD_API = 'https://dudeai.onrender.com';
const DEFAULT_DEV_API = 'http://127.0.0.1:8000';
const API = (
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.PROD ? DEFAULT_PROD_API : DEFAULT_DEV_API)
).replace(/\/$/, '');
const isLocalApi = API.includes('127.0.0.1') || API.includes('localhost');
const apiLabel = isLocalApi ? 'Local API' : 'Render API';
const EMPTY_FORM = { base_url: '', email: '', api_token: '' };

export default function App() {
  // Only three pages: Jira connection, Projects, and Documents. No dashboard/home or AI assistant.
  const [page, setPage] = useState('Jira connection');
  const [form, setForm] = useState(EMPTY_FORM);
  const [connected, setConnected] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState('Not connected yet');
  const [identityStatus, setIdentityStatus] = useState(null);
  const [projects, setProjects] = useState([]);
  const [projectKey, setProjectKey] = useState('');
  const [documents, setDocuments] = useState([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);

  // User identity state
  const [userProfile, setUserProfile] = useState(() => {
    try {
      const saved = localStorage.getItem('dude_ai_user');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.username && parsed?.userId) return parsed;
      }
    } catch { /* ignore parsing errors */ }
    return { username: '', userId: '' };
  });

  const [showWelcomeModal, setShowWelcomeModal] = useState(() => !userProfile.username || !userProfile.userId);
  const [tempUsername, setTempUsername] = useState(userProfile.username || '');
  const [tempUserId, setTempUserId] = useState(userProfile.userId || '');
  const [validationError, setValidationError] = useState('');

  // Security Vulnerability JSON Import state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importJsonText, setImportJsonText] = useState('');
  const [previewIssues, setPreviewIssues] = useState([]);
  const [detectedProjectKeys, setDetectedProjectKeys] = useState([]);
  const [targetProjectKey, setTargetProjectKey] = useState('');
  const [jsonValidationResult, setJsonValidationResult] = useState(null);
  const [importResults, setImportResults] = useState(null);
  const [isValidatingJson, setIsValidatingJson] = useState(false);

  const clickCounts = useRef({});
  const busyRef = useRef('');
  const testRunId = useRef(`RUN-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`);
  const userProfileRef = useRef(userProfile);

  useEffect(() => {
    userProfileRef.current = userProfile;
  }, [userProfile]);

  useEffect(() => {
    if (projectKey && !targetProjectKey) {
      setTargetProjectKey(projectKey);
    }
  }, [projectKey, targetProjectKey]);

  async function request(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'X-Frontend-Action': options.actionName || path,
      'X-User-Name': userProfileRef.current.username || '',
      'X-User-ID': userProfileRef.current.userId || '',
      ...(options.headers || {})
    };
    const response = await fetch(API + path, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `Request failed (${response.status})`);
    return data;
  }

  async function recordButtonEvent(event) {
    try {
      await fetch(`${API}/api/telemetry/button-event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Name': userProfileRef.current.username || '',
          'X-User-ID': userProfileRef.current.userId || ''
        },
        body: JSON.stringify({
          ...event,
          user_name: userProfileRef.current.username || '',
          user_id: userProfileRef.current.userId || '',
          test_run_id: testRunId.current
        })
      });
    } catch { /* telemetry must not break the user action */ }
  }

  function startButtonAction(buttonName, endpoint) {
    const clickNumber = (clickCounts.current[buttonName] || 0) + 1;
    clickCounts.current[buttonName] = clickNumber;
    const clickId = `${testRunId.current}-${buttonName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${clickNumber}`;
    if (busyRef.current) {
      recordButtonEvent({ button_name: buttonName, click_id: clickId, click_number: clickNumber, outcome: 'blocked', block_reason: `Another action is running: ${busyRef.current}`, frontend_route: page, api_endpoint: endpoint });
      setNotice({ type: 'error', text: `Click blocked: ${busyRef.current} is still running. Please wait.` });
      return null;
    }
    busyRef.current = buttonName;
    setBusy(buttonName);
    const started = performance.now();
    recordButtonEvent({ button_name: buttonName, click_id: clickId, click_number: clickNumber, outcome: 'accepted', frontend_route: page, api_endpoint: endpoint });
    return { clickId, started, buttonName };
  }

  async function finishButtonAction(action, outcome, status = '', errorMessage = '') {
    if (!action) return;
    const duration = Math.round((performance.now() - action.started) * 100) / 100;
    await recordButtonEvent({ button_name: action.buttonName, click_id: action.clickId, click_number: clickCounts.current[action.buttonName], outcome, http_status: status, duration_ms: duration, block_reason: errorMessage, frontend_route: page });
    busyRef.current = '';
    setBusy('');
  }

  const credentials = () => {
    if (!form.base_url.trim() || !form.email.trim() || !form.api_token) throw new Error('Enter your Jira URL, account email, and API token first.');
    return {
      base_url: form.base_url.trim().replace(/\/$/, ''),
      email: form.email.trim(),
      api_token: form.api_token,
      user_name: userProfileRef.current.username || undefined,
      user_id: userProfileRef.current.userId || undefined
    };
  };

  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));

  const loadDocuments = async () => {
    const data = await request('/api/documents?limit=500');
    setDocuments(data.documents || []);
  };

  useEffect(() => { loadDocuments().catch(() => {}); }, []);

  function handleWelcomeSubmit(e) {
    e?.preventDefault();
    const trimmedUsername = tempUsername.trim();
    const trimmedUserId = tempUserId.trim();

    if (!trimmedUsername || !trimmedUserId) {
      setValidationError('Please fill in both fields before continuing.');
      return;
    }

    const newProfile = { username: trimmedUsername, userId: trimmedUserId };
    setUserProfile(newProfile);
    userProfileRef.current = newProfile;
    try {
      localStorage.setItem('dude_ai_user', JSON.stringify(newProfile));
    } catch { /* ignore storage error */ }

    setShowWelcomeModal(false);
    setValidationError('');
    setNotice({
      type: 'success',
      text: `Welcome, ${trimmedUsername}! Your profile has been saved. Let's get started!`
    });
  }

  function openEditProfileModal() {
    setTempUsername(userProfile.username);
    setTempUserId(userProfile.userId);
    setValidationError('');
    setShowWelcomeModal(true);
  }

  async function testConnection(event) {
    event?.preventDefault();
    const action = startButtonAction('Test connection', '/api/jira/test-connection');
    if (!action) return;
    setNotice(null);
    let status = '';
    try {
      const result = await request('/api/jira/test-connection', {
        method: 'POST',
        actionName: action.buttonName,
        headers: { 'X-Click-ID': action.clickId },
        body: JSON.stringify(credentials())
      });
      status = 200;
      setConnected(true);
      setIdentityStatus(result.identity_status || null);

      let msg = `Connected as ${result.display_name || form.email}`;
      if (result.identity_status?.message) {
        msg += ` (${result.identity_status.message})`;
      }
      setConnectionMessage(msg);
      setNotice({
        type: 'success',
        text: result.identity_status?.message
          ? `Jira connection verified. ${result.identity_status.message}`
          : 'Jira connection verified successfully.'
      });
      await finishButtonAction(action, 'accepted-success', status);
    } catch (error) {
      setConnected(false);
      setConnectionMessage(error.message);
      setNotice({ type: 'error', text: error.message });
      await finishButtonAction(action, 'failed', status || 'error', error.message);
    }
  }

  async function loadProjects() {
    const action = startButtonAction('Load projects', '/api/jira/projects');
    if (!action) return;
    setNotice(null);
    try {
      const result = await request('/api/jira/projects', {
        method: 'POST',
        actionName: action.buttonName,
        headers: { 'X-Click-ID': action.clickId },
        body: JSON.stringify(credentials())
      });
      setProjects(result.projects || []);
      if (!projectKey && result.projects?.length) {
        setProjectKey(result.projects[0].key);
        if (!targetProjectKey) setTargetProjectKey(result.projects[0].key);
      }
      setConnected(true);
      setConnectionMessage(`${result.count} accessible project(s) found`);
      setPage('Projects');
      setNotice({ type: 'success', text: `Loaded ${result.count} Jira project(s).` });
      await finishButtonAction(action, 'accepted-success', 200);
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
      await finishButtonAction(action, 'failed', 'error', error.message);
    }
  }

  async function fetchDocuments() {
    const action = startButtonAction('Fetch documents', '/api/jira/fetch-documents');
    if (!action) return;
    setNotice(null);
    try {
      const result = await request('/api/jira/fetch-documents', {
        method: 'POST',
        actionName: action.buttonName,
        headers: { 'X-Click-ID': action.clickId },
        body: JSON.stringify({ ...credentials(), project_key: projectKey, max_results: 100 })
      });
      await loadDocuments();
      setPage('Documents');
      setNotice({ type: 'success', text: result.message });
      await finishButtonAction(action, 'accepted-success', 200);
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
      await finishButtonAction(action, 'failed', 'error', error.message);
    }
  }

  async function downloadExcelReport() {
    const action = startButtonAction('Download Excel report', '/api/reports/excel');
    if (!action) return;
    setNotice(null);
    let status = '';
    try {
      const response = await fetch(`${API}/api/reports/excel`, {
        headers: {
          'X-Frontend-Action': 'Download Excel report',
          'X-Click-ID': action.clickId,
          'X-User-Name': userProfileRef.current.username || '',
          'X-User-ID': userProfileRef.current.userId || ''
        },
      });
      status = response.status;
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || `Download failed (${response.status})`);
      }
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = 'api_audit_tracker.xlsx';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      setNotice({ type: 'success', text: 'Excel report (api_audit_tracker.xlsx) downloaded successfully.' });
      await finishButtonAction(action, 'accepted-success', status);
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
      await finishButtonAction(action, 'failed', status || 'error', error.message);
    }
  }

  async function validateJsonString(content) {
    setIsValidatingJson(true);
    setJsonValidationResult(null);
    setImportResults(null);
    try {
      const res = await request('/api/jira/validate-import-json', {
        method: 'POST',
        actionName: 'Validate vulnerability JSON',
        body: JSON.stringify({ raw_json: content })
      });
      setJsonValidationResult(res);
      if (res.valid) {
        setPreviewIssues(res.issues || []);
        setDetectedProjectKeys(res.detected_project_keys || []);
        if (projectKey) {
          setTargetProjectKey(projectKey);
        } else if (projects.length > 0) {
          setTargetProjectKey(projects[0].key);
        }
      } else {
        setPreviewIssues([]);
      }
    } catch (err) {
      setJsonValidationResult({ valid: false, error: err.message, message: 'JSON validation failed.' });
      setPreviewIssues([]);
    } finally {
      setIsValidatingJson(false);
    }
  }

  function handleFileSelect(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      setImportJsonText(text);
      validateJsonString(text);
    };
    reader.readAsText(file);
  }

  async function loadSampleVulnerabilities() {
    setIsValidatingJson(true);
    setNotice(null);
    try {
      const res = await fetch('/security_vulnerabilities.json');
      if (!res.ok) throw new Error('Could not load sample security vulnerabilities file');
      const text = await res.text();
      setImportJsonText(text);
      await validateJsonString(text);
    } catch (err) {
      setJsonValidationResult({ valid: false, error: err.message });
    } finally {
      setIsValidatingJson(false);
    }
  }

  async function handleImportVulnerabilities() {
    if (!previewIssues.length) {
      setNotice({ type: 'error', text: 'No validated issues to import. Please upload or load a JSON file first.' });
      return;
    }
    const finalProject = (targetProjectKey || projectKey || '').trim().toUpperCase();
    if (!finalProject) {
      setNotice({ type: 'error', text: 'Please select or enter a target Jira project key.' });
      return;
    }
    if (!form.base_url.trim() || !form.email.trim() || !form.api_token) {
      setNotice({ type: 'error', text: 'Please fill in your Jira connection details (base URL, email, API token) in the Jira connection tab first.' });
      return;
    }

    const action = startButtonAction('Import vulnerabilities', '/api/jira/import-vulnerabilities');
    if (!action) return;
    setNotice(null);
    setImportResults(null);
    let status = '';
    try {
      const result = await request('/api/jira/import-vulnerabilities', {
        method: 'POST',
        actionName: action.buttonName,
        headers: { 'X-Click-ID': action.clickId },
        body: JSON.stringify({
          ...credentials(),
          target_project_key: finalProject,
          issues: previewIssues.map(i => i.raw || i),
          skip_duplicates: true
        })
      });
      status = 200;
      setImportResults(result);
      await loadDocuments();
      setNotice({ type: 'success', text: result.message });
      await finishButtonAction(action, 'accepted-success', status);
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
      await finishButtonAction(action, 'failed', status || 'error', error.message);
    }
  }

  const visibleDocuments = useMemo(() => documents.filter(item => `${item.issue_key} ${item.project_key} ${item.summary} ${item.status} ${item.assignee}`.toLowerCase().includes(search.toLowerCase())), [documents, search]);
  const projectCount = new Set(documents.map(item => item.project_key)).size;

  return (
    <div className="app-shell">
      {/* Welcome & User Details Modal */}
      {showWelcomeModal && (
        <div className="welcome-overlay" role="dialog" aria-modal="true" aria-labelledby="welcome-modal-title">
          <div className="welcome-modal">
            <div className="welcome-header">
              <div className="welcome-icon">
                <Smile size={28} />
              </div>
              <h2 id="welcome-modal-title" className="welcome-title">Welcome to Dude AI</h2>
              <p className="welcome-message">Hello! Welcome to Dude AI. Before we get started, please share your details.</p>
            </div>

            <form onSubmit={handleWelcomeSubmit} className="welcome-form" noValidate>
              <div className="welcome-field">
                <label htmlFor="user-name-input">
                  What should we call you?
                  <span className="field-tag">REQUIRED</span>
                </label>
                <input
                  id="user-name-input"
                  name="username"
                  type="text"
                  placeholder="e.g. Alex Hunter"
                  value={tempUsername}
                  onChange={event => {
                    setTempUsername(event.target.value);
                    if (validationError) setValidationError('');
                  }}
                  autoFocus
                />
              </div>

              <div className="welcome-field">
                <label htmlFor="user-id-input">
                  What is your User ID?
                  <span className="field-tag">REQUIRED</span>
                </label>
                <input
                  id="user-id-input"
                  name="userId"
                  type="text"
                  placeholder="e.g. USR-1042 or Jira account ID"
                  value={tempUserId}
                  onChange={event => {
                    setTempUserId(event.target.value);
                    if (validationError) setValidationError('');
                  }}
                />
                <small>Enter your user or employee ID. If you know your Jira Cloud account ID, you can enter it here.</small>
              </div>

              {validationError && (
                <div className="welcome-error" role="alert">
                  <X size={15} />
                  <span>{validationError}</span>
                </div>
              )}

              <div className="welcome-actions">
                <button type="submit" className="button primary welcome-submit-btn">
                  <Sparkles size={16} />
                  Let's Get Started
                </button>
                {userProfile.username && userProfile.userId && (
                  <button
                    type="button"
                    className="button secondary welcome-cancel-btn"
                    onClick={() => {
                      setTempUsername(userProfile.username);
                      setTempUserId(userProfile.userId);
                      setValidationError('');
                      setShowWelcomeModal(false);
                    }}
                  >
                    Keep current details
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Security Vulnerability JSON Importer Modal */}
      {showImportModal && (
        <div className="import-overlay" role="dialog" aria-modal="true" aria-labelledby="import-modal-title">
          <div className="import-modal">
            <div className="import-modal-header">
              <div className="import-modal-title-group">
                <div className="import-icon">
                  <ShieldAlert size={24} />
                </div>
                <div>
                  <h2 id="import-modal-title">Import Security Vulnerabilities to Jira</h2>
                  <p>Upload a Jira-style JSON file or load the sample file to preview and import issues.</p>
                </div>
              </div>
              <button
                className="import-close-btn"
                onClick={() => { setShowImportModal(false); }}
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
            </div>

            <div className="import-modal-body">
              {/* Target Project Row */}
              <div className="import-config-row">
                <label htmlFor="target-project-select">
                  <b>Target Jira Project Key</b>
                  <span className="field-tag">DESTINATION</span>
                </label>
                <div className="target-project-picker">
                  {projects.length > 0 ? (
                    <select
                      id="target-project-select"
                      value={targetProjectKey || projectKey}
                      onChange={e => setTargetProjectKey(e.target.value)}
                    >
                      {projects.map(p => (
                        <option key={p.key} value={p.key}>{p.name} ({p.key})</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="target-project-select"
                      type="text"
                      placeholder="e.g. DEMO"
                      value={targetProjectKey || projectKey}
                      onChange={e => setTargetProjectKey(e.target.value.toUpperCase())}
                    />
                  )}
                  <small className="project-helper-text">
                    {detectedProjectKeys.length > 0 && !detectedProjectKeys.includes(targetProjectKey || projectKey)
                      ? `Note: Issues in JSON declare project "${detectedProjectKeys.join(', ')}". They will be mapped and imported into your configured Jira project "${targetProjectKey || projectKey || '...'}" instead of assuming ${detectedProjectKeys.join(', ')} exists.`
                      : 'Issues will be imported into this active Jira project.'}
                  </small>
                </div>
              </div>

              {/* Upload & Sample Buttons */}
              <div className="import-upload-zone">
                <div className="upload-file-box">
                  <label htmlFor="vuln-file-input" className="file-input-label">
                    <UploadCloud size={18} />
                    <span>Choose JSON File</span>
                    <input
                      id="vuln-file-input"
                      type="file"
                      accept=".json,application/json"
                      onChange={handleFileSelect}
                    />
                  </label>
                </div>
                <span className="or-divider">OR</span>
                <button
                  type="button"
                  id="load-sample-btn"
                  className="button secondary load-sample-btn"
                  onClick={loadSampleVulnerabilities}
                  disabled={isValidatingJson}
                >
                  {isValidatingJson ? <LoaderCircle className="spin" size={15}/> : <ShieldAlert size={15}/>}
                  <span>Load Sample Vulnerabilities (6 Issues)</span>
                </button>
              </div>

              {/* Validation Status */}
              {isValidatingJson && (
                <div className="validating-banner">
                  <LoaderCircle className="spin" size={16}/>
                  <span>Validating JSON structure and fields...</span>
                </div>
              )}

              {jsonValidationResult && !jsonValidationResult.valid && (
                <div className="notice error">
                  <AlertTriangle size={18} />
                  <p>{jsonValidationResult.error || jsonValidationResult.message}</p>
                </div>
              )}

              {/* Preview Table */}
              {previewIssues.length > 0 && (
                <div className="preview-section">
                  <div className="preview-heading">
                    <div>
                      <h3>Previewing {previewIssues.length} Vulnerability Issue(s)</h3>
                      <p>Review the mapped fields before confirming creation in Jira project <b>{targetProjectKey || projectKey}</b>.</p>
                    </div>
                    <span className="state-pill good">{previewIssues.length} Valid Records</span>
                  </div>

                  <div className="preview-table-wrap">
                    <table className="preview-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Type</th>
                          <th>Priority</th>
                          <th>Summary</th>
                          <th>Labels</th>
                          <th>Description Preview</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewIssues.map((issue, idx) => (
                          <tr key={idx}>
                            <td>{idx + 1}</td>
                            <td><span className="type-badge">{issue.issuetype}</span></td>
                            <td>
                              <span className={`priority-badge ${issue.priority.toLowerCase()}`}>
                                {issue.priority}
                              </span>
                            </td>
                            <td className="summary-cell"><b>{issue.summary}</b></td>
                            <td>
                              <div className="labels-wrap">
                                {(issue.labels || []).map((l, i) => (
                                  <span key={i} className="label-tag">{l}</span>
                                ))}
                              </div>
                            </td>
                            <td className="desc-preview-cell">{issue.description_preview}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="vulnerability-disclaimer">
                    <ShieldCheck size={16}/>
                    <span>Sample vulnerabilities are test templates for validation. Real passwords, user secrets, and tokens are never included.</span>
                  </div>

                  {/* Confirmation Button */}
                  <div className="import-action-bar">
                    <button
                      id="confirm-import-btn"
                      className="button primary confirm-import-btn"
                      onClick={handleImportVulnerabilities}
                      disabled={busy === 'Import vulnerabilities'}
                    >
                      {busy === 'Import vulnerabilities' ? (
                        <><LoaderCircle className="spin" size={17}/> Importing into Jira...</>
                      ) : (
                        <><Sparkles size={17}/> Confirm & Import {previewIssues.length} Issues to Jira</>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Import Results View */}
              {importResults && (
                <div className="import-results-card">
                  <div className="results-header">
                    <CheckCircle2 size={20} className="success-icon" />
                    <div>
                      <h3>Jira Import Results</h3>
                      <p>{importResults.message}</p>
                    </div>
                  </div>

                  <div className="results-stats">
                    <div className="stat-box created">
                      <span>Created in Jira</span>
                      <b>{importResults.created}</b>
                    </div>
                    <div className="stat-box skipped">
                      <span>Skipped (Duplicates)</span>
                      <b>{importResults.skipped}</b>
                    </div>
                    <div className="stat-box failed">
                      <span>Failed</span>
                      <b>{importResults.failed}</b>
                    </div>
                  </div>

                  {importResults.results && importResults.results.length > 0 && (
                    <div className="results-list">
                      <h4>Issue Breakdown</h4>
                      {importResults.results.map((r, i) => (
                        <div key={i} className={`result-row ${r.status}`}>
                          <span className={`status-pill ${r.status}`}>{r.status.toUpperCase()}</span>
                          <span className="result-summary">{r.summary}</span>
                          {r.issue_key && (
                            <a href={r.browse_url} target="_blank" rel="noreferrer" className="result-link">
                              {r.issue_key} <ExternalLink size={12}/>
                            </a>
                          )}
                          {r.error && <span className="result-error">{r.error}</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="results-footer">
                    <button
                      className="button secondary small"
                      onClick={() => {
                        setShowImportModal(false);
                        setPage('Documents');
                      }}
                    >
                      <FileText size={15}/> View in Documents
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <aside className="sidebar">
        <div className="brand"><img className="brand-logo" src="/dude-ai-logo.png" alt="Dude AI logo" /></div>
        <nav aria-label="Main navigation">
          <button className={page === 'Jira connection' ? 'nav-item active' : 'nav-item'} onClick={() => { setPage('Jira connection'); setNotice(null); }}><Cable size={18}/>Jira connection</button>
          <button className={page === 'Projects' ? 'nav-item active' : 'nav-item'} onClick={() => { setPage('Projects'); setNotice(null); }}><FolderKanban size={18}/>Projects</button>
          <button className={page === 'Documents' ? 'nav-item active' : 'nav-item'} onClick={() => { setPage('Documents'); setNotice(null); loadDocuments().catch(error => setNotice({ type: 'error', text: error.message })); }}><FileText size={18}/>Documents <em>{documents.length}</em></button>
        </nav>
        <div className="sidebar-bottom"><ShieldCheck size={17}/><div><b>Credentials stay private</b><small>Token is not saved in the database.</small></div></div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div>
            <span>Dude AI</span><b>/</b><strong>{page}</strong>
          </div>
          <div className="topbar-actions">
            {userProfile.username && (
              <button
                className="user-badge"
                onClick={openEditProfileModal}
                title="Click to edit username and user ID"
                type="button"
              >
                <User size={13} />
                <span>{userProfile.username}</span>
                <span className="user-badge-id">({userProfile.userId})</span>
              </button>
            )}
            <button
              className="button secondary small import-vuln-btn"
              onClick={() => {
                if (projectKey && !targetProjectKey) setTargetProjectKey(projectKey);
                setShowImportModal(true);
              }}
              title="Import security vulnerabilities from JSON into Jira"
              type="button"
            >
              <ShieldAlert size={15}/>
              <span>Import Vulnerabilities</span>
            </button>
            <button className="button secondary small download-report-btn" onClick={downloadExcelReport} title="Download Excel audit tracker workbook">
              {busy === 'Download Excel report' ? <LoaderCircle className="spin" size={15}/> : <FileSpreadsheet size={15}/>}
              <span>Download Excel Report</span>
            </button>
            <div className="api-status">
              <i/>{apiLabel} <button title="Refresh documents" onClick={async () => { const action = startButtonAction('Refresh documents', '/api/documents?limit=500'); if (!action) return; try { await loadDocuments(); setNotice({ type: 'success', text: 'Documents refreshed.' }); await finishButtonAction(action, 'accepted-success', 200); } catch (error) { setNotice({ type: 'error', text: error.message }); await finishButtonAction(action, 'failed', 'error', error.message); } }}><RefreshCw size={16}/></button>
            </div>
          </div>
        </header>

        <section className="page-content">
          <div className="page-title">
            <div>
              <div className="eyebrow">DUDE AI · KNOWLEDGE HUB</div>
              <h1>{page}</h1>
              <p>{page === 'Jira connection' ? 'Connect your Jira Cloud account to import project issues.' : page === 'Projects' ? 'Choose a project that your Jira account can access.' : 'Search and open the Jira issues you have imported.'}</p>
            </div>
          </div>

          {notice && (
            <div className={`notice ${notice.type}`}>
              <span>{notice.type === 'success' ? <CheckCircle2 size={18}/> : <X size={18}/>}</span>
              <p>{notice.text}</p>
              <button onClick={() => setNotice(null)} aria-label="Dismiss"><X size={16}/></button>
            </div>
          )}

          {page === 'Jira connection' && (
            <div className="connect-layout">
              <section className="card connection-card">
                <div className="section-heading">
                  <div>
                    <h2>Connect Jira project</h2>
                    <p>Use your Atlassian account details. Your token is only used for the request.</p>
                  </div>
                  <span className={connected ? 'state-pill good' : 'state-pill'}>{connected ? 'Connected' : 'Not connected'}</span>
                </div>
                <form onSubmit={testConnection}>
                  <label>Jira base URL <span>REQUIRED</span>
                    <input type="url" required placeholder="https://your-company.atlassian.net" value={form.base_url} onChange={event => update('base_url', event.target.value)}/>
                    <small>Enter the site URL, not a Jira issue URL.</small>
                  </label>
                  <div className="two-columns">
                    <label>Account email <span>REQUIRED</span>
                      <input type="email" required placeholder="you@example.com" value={form.email} onChange={event => update('email', event.target.value)}/>
                    </label>
                    <label>API token <span>SECRET</span>
                      <input type="password" required autoComplete="off" placeholder="Paste Atlassian API token" value={form.api_token} onChange={event => update('api_token', event.target.value)}/>
                    </label>
                  </div>
                  <div className="security-note">
                    <ShieldCheck size={17}/> Your credentials and identity are sent securely to your configured FastAPI backend and are not stored.
                  </div>
                  <div className="button-row">
                    <button className="button primary">
                      {busy === 'Test connection' ? <LoaderCircle className="spin" size={17}/> : <Cable size={17}/>}
                      Test connection
                    </button>
                    <button type="button" className="button secondary" onClick={loadProjects}>
                      {busy === 'Load projects' ? <LoaderCircle className="spin" size={17}/> : <FolderKanban size={17}/>}
                      Load projects
                    </button>
                  </div>
                </form>
              </section>

              <aside className="card connection-side">
                <div className={connected ? 'connection-symbol good' : 'connection-symbol'}><Cable size={26}/></div>
                <div className="eyebrow">CONNECTION STATUS</div>
                <h2>{connected ? 'You’re connected' : 'Connect to get started'}</h2>
                <p>{connectionMessage}</p>
                <div className={connected ? 'status-banner good' : 'status-banner'}><i/>{connected ? 'Connection verified' : 'Waiting for connection'}</div>

                {identityStatus && (
                  <div className={`identity-card ${identityStatus.verified_jira_account ? 'verified' : 'internal'}`}>
                    <div className="identity-card-header">
                      <UserCheck size={16}/>
                      <strong>Active User & Jira Identity</strong>
                    </div>
                    <div className="identity-field">
                      <span>Dude AI User:</span>
                      <b>{identityStatus.user_name || userProfile.username} ({identityStatus.user_id || userProfile.userId})</b>
                    </div>
                    <div className="identity-field">
                      <span>Jira Account:</span>
                      <b>{identityStatus.jira_display_name}</b>
                    </div>
                    <p className="identity-note">{identityStatus.message}</p>
                  </div>
                )}

                <div className="help-block">
                  <b>Where do I find an API token?</b>
                  <p>Create one in your Atlassian account security settings. Keep it private like a password.</p>
                  <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer">Atlassian API token settings <ExternalLink size={13}/></a>
                </div>
              </aside>
            </div>
          )}

          {page === 'Projects' && (
            <section className="card project-card">
              <div className="section-heading">
                <div>
                  <h2>Accessible Jira projects</h2>
                  <p>Load projects, select one, then import its issues or vulnerabilities.</p>
                </div>
                <button className="button secondary small" onClick={loadProjects}><RefreshCw size={15}/>Refresh projects</button>
              </div>
              {projects.length ? (
                <>
                  <div className="project-grid">
                    {projects.map(project => (
                      <button
                        key={project.id || project.key}
                        className={projectKey === project.key ? 'project-option selected' : 'project-option'}
                        onClick={() => {
                          setProjectKey(project.key);
                          setTargetProjectKey(project.key);
                        }}
                      >
                        <FolderKanban size={20}/>
                        <span>
                          <b>{project.name}</b>
                          <small>{project.key} · {project.project_type || 'Jira project'}</small>
                        </span>
                        {projectKey === project.key && <CheckCircle2 size={18}/>}
                      </button>
                    ))}
                  </div>
                  <div className="fetch-row">
                    <div>
                      <b>{projectKey || 'Select a project'}</b>
                      <small>Selected project key</small>
                    </div>
                    <div className="project-actions-group">
                      <button
                        className="button secondary"
                        type="button"
                        onClick={() => {
                          if (projectKey) setTargetProjectKey(projectKey);
                          setShowImportModal(true);
                        }}
                      >
                        <ShieldAlert size={17} />
                        Import Vulnerabilities (JSON)
                      </button>
                      <button className="button primary" disabled={!projectKey} onClick={fetchDocuments}>
                        {busy === 'Fetch documents' ? <LoaderCircle className="spin" size={17}/> : <FileText size={17}/>}
                        Fetch documents
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <FolderKanban size={30}/>
                  <h3>No projects loaded</h3>
                  <p>Go to Jira connection and select “Load projects”.</p>
                  <button className="button primary" onClick={() => setPage('Jira connection')}>Open Jira connection</button>
                </div>
              )}
            </section>
          )}

          {page === 'Documents' && (
            <section className="card documents-card">
              <div className="documents-toolbar">
                <button className="button secondary small back-button" onClick={() => { setPage('Projects'); setNotice(null); }}>← Back to projects</button>
                <div className="search-box">
                  <Search size={16}/>
                  <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search issues..."/>
                </div>
                <div className="documents-action-group">
                  <button
                    className="button secondary small"
                    onClick={() => {
                      if (projectKey && !targetProjectKey) setTargetProjectKey(projectKey);
                      setShowImportModal(true);
                    }}
                    type="button"
                  >
                    <ShieldAlert size={15}/>
                    <span>Import JSON</span>
                  </button>
                  <button className="button secondary small download-report-btn" onClick={downloadExcelReport}>
                    {busy === 'Download Excel report' ? <LoaderCircle className="spin" size={15}/> : <FileSpreadsheet size={15}/>}
                    <span>Download Excel Report</span>
                  </button>
                </div>
              </div>
              <div className="section-heading">
                <div>
                  <h2>Imported issues</h2>
                  <p>{documents.length} issue(s) stored in your local knowledge base.</p>
                </div>
              </div>
              <div className="summary-row">
                <div><span>Imported issues</span><b>{documents.length}</b></div>
                <div><span>Projects represented</span><b>{projectCount}</b></div>
                <div><span>Matching search</span><b>{visibleDocuments.length}</b></div>
              </div>
              {visibleDocuments.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Issue</th>
                        <th>Summary</th>
                        <th>Project</th>
                        <th>Status</th>
                        <th>Assignee</th>
                        <th>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleDocuments.map(item => (
                        <tr key={item.issue_key}>
                          <td><a href={item.browse_url} target="_blank" rel="noreferrer">{item.issue_key} <ExternalLink size={12}/></a></td>
                          <td className="summary-cell">{item.summary}</td>
                          <td>{item.project_key}</td>
                          <td><span className="issue-status">{item.status || 'Unknown'}</span></td>
                          <td>{item.assignee || 'Unassigned'}</td>
                          <td>{item.updated_at ? new Date(item.updated_at).toLocaleDateString() : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">
                  <FileText size={30}/>
                  <h3>{search ? 'No matching issues' : 'No documents imported yet'}</h3>
                  <p>{search ? 'Try another keyword, or click Import Vulnerabilities.' : 'Open Projects, select a project, and click Fetch documents or Import Vulnerabilities.'}</p>
                  <button className="button primary" onClick={() => setPage('Projects')}>Open projects</button>
                </div>
              )}
            </section>
          )}
        </section>

        <footer>
          <span>Dude AI · For Testing Project</span>
          <span><i/> {isLocalApi ? 'Local API connected' : 'Cloud API connected'}</span>
        </footer>
      </main>
    </div>
  );
}
