// popup/popup.js

// DOM Elements for new UI (Slider and single scan button)
const scanSensitivitySlider = document.getElementById('scanSensitivity');
const scanSensitivityLabel = document.getElementById('scanSensitivityLabel');
const startScanButton = document.getElementById('startScanButton');

// Main Views & Navigation
const mainAnalysisView = document.getElementById('mainAnalysisView');
const unreliableDomainsView = document.getElementById('unreliableDomainsView');
const popupTitle = document.getElementById('popupTitle'); // H1 title element
const toggleDomainsViewButton = document.getElementById('toggleDomainsViewButton');
const backToAnalysisButton = document.getElementById('backToAnalysisButton');

// Domains View Elements
const domainsTableContainer = document.getElementById('domainsTableContainer');

// Existing DOM Elements
const resultsDiv = document.getElementById('results');
// const analysisRawTextPre = document.getElementById('analysisRawText'); // Kept commented if not used
const loadingIndicator = document.getElementById('loadingIndicator');
const errorP = document.getElementById('error');
const scoreTextDisplayDiv = document.getElementById('scoreTextDisplay');
const progressBarDiv = document.getElementById('progressBar');
const domainWarningDiv = document.getElementById('domainWarning');

// API Key & Info Elements
const apiKeyInput = document.getElementById('apiKey');
const saveApiKeyButton = document.getElementById('saveApiKey');
const apiKeyStatus = document.getElementById('apiKeyStatus');
const toggleApiKeyButton = document.getElementById('toggleApiKeyButton');
const toggleInfoButton = document.getElementById('toggleInfoButton');
const apiKeyInputArea = document.getElementById('apiKeyInputArea');
const infoArea = document.getElementById('infoArea');
const infoSeparator = document.getElementById('infoSeparator');
const apiKeySeparator = document.getElementById('apiKeySeparator');

// Sensitivity levels mapping
const SENSITIVITY_LEVELS = {
    1: { name: "Light Scan", value: "light", gradient: "linear-gradient(to right, #6EE7B7, #34D399)", trackClass: "light-scan-track" },
    2: { name: "Medium Scan", value: "medium", gradient: "linear-gradient(to right, #FCD34D, #FBBF24)", trackClass: "medium-scan-track" },
    3: { name: "Deep Scan", value: "deep", gradient: "linear-gradient(to right, #F87171, #EF4444)", trackClass: "deep-scan-track" }
};

// --- Initialize UI and Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    // Initialize API Key status and visibility
    chrome.storage.local.get(['geminiApiKey'], (result) => {
        if (apiKeyStatus && startScanButton) { // Ensure elements exist
            if (result.geminiApiKey) {
                apiKeyStatus.textContent = 'API Key is set.';
                apiKeyStatus.className = 'status success';
                startScanButton.disabled = false;
            } else {
                apiKeyStatus.textContent = 'API Key not set. Click 🔑 to add.';
                apiKeyStatus.className = 'status error';
                startScanButton.disabled = true;
            }
        }
    });

    // Restore popup state or clear if reloaded
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError || !tabs || tabs.length === 0) {
            console.error("Error querying tabs or no active tab found.");
            showMainAnalysisView(); // Default to main view on error
            return;
        }
        const tabId = tabs[0].id;
        let isReload = false;
        try {
            const navEntries = performance.getEntriesByType("navigation");
            isReload = navEntries && navEntries.length > 0 && navEntries[0].type === "reload";
        } catch (e) {
            console.warn("performance.getEntriesByType not available or failed:", e);
        }

        if (isReload) {
            console.log("Page reloaded, clearing results and state from popup.js");
            clearResults();
            chrome.storage.local.remove(`popupState_${tabId}`);
            showMainAnalysisView(); // Default to main view
        } else {
            restorePopupState(tabId); // This will also handle setting the correct view
        }
    });

    // Set initial slider label and track color (if slider exists on current view)
    if (scanSensitivitySlider) {
        updateSliderAppearance(scanSensitivitySlider.value);
    }

    // Event listeners
    if(toggleApiKeyButton) toggleApiKeyButton.addEventListener('click', toggleApiKeyInputArea);
    if(toggleInfoButton) toggleInfoButton.addEventListener('click', toggleInfoArea);
    if(saveApiKeyButton) saveApiKeyButton.addEventListener('click', saveApiKey);
    
    if(scanSensitivitySlider) {
        scanSensitivitySlider.addEventListener('input', (event) => {
            updateSliderAppearance(event.target.value);
        });
    }
    
    if(startScanButton) {
        startScanButton.addEventListener('click', () => {
            if (!scanSensitivitySlider) return;
            const sensitivityValue = scanSensitivitySlider.value;
            const selectedSensitivity = SENSITIVITY_LEVELS[sensitivityValue]?.value || "light";
            console.log(`Start Scan button clicked. Sensitivity: ${selectedSensitivity}`);
            clearResults();
            showLoading(true);
            sendHighlightRequestToContentScript(null);
            analyzeTextQuery(selectedSensitivity);
        });
    }

    if(toggleDomainsViewButton) toggleDomainsViewButton.addEventListener('click', showUnreliableDomainsView);
    if(backToAnalysisButton) backToAnalysisButton.addEventListener('click', showMainAnalysisView);
});

// --- View Switching Functions ---
function showMainAnalysisView() {
    if(mainAnalysisView) mainAnalysisView.style.display = 'flex';
    if(unreliableDomainsView) unreliableDomainsView.style.display = 'none';
    if(popupTitle) popupTitle.textContent = 'MisinformShield';
}

function showUnreliableDomainsView() {
    if(mainAnalysisView) mainAnalysisView.style.display = 'none';
    if(unreliableDomainsView) unreliableDomainsView.style.display = 'flex';
    if(popupTitle) popupTitle.textContent = 'Listed Domains';
    fetchAndDisplayUnreliableDomains();
}


// --- API Key Handling Functions ---
function toggleApiKeyInputArea() {
    if(!apiKeyInputArea || !apiKeySeparator || !apiKeyStatus) return;
    const isHidden = apiKeyInputArea.style.display === 'none';
    apiKeyInputArea.style.display = isHidden ? 'block' : 'none';
    apiKeySeparator.style.display = isHidden ? 'block' : 'none';

    if (isHidden) { 
        chrome.storage.local.get(['geminiApiKey'], (result) => {
            if (!result.geminiApiKey) {
                apiKeyStatus.textContent = 'Enter your Gemini API Key below.';
                apiKeyStatus.className = 'status neutral';
            } else {
                apiKeyStatus.textContent = 'API Key is set. You can update it below.';
                apiKeyStatus.className = 'status success';
            }
        });
    } else { 
        chrome.storage.local.get(['geminiApiKey'], (result) => {
            if (result.geminiApiKey) {
                apiKeyStatus.textContent = 'API Key is set.';
                apiKeyStatus.className = 'status success';
            } else {
                apiKeyStatus.textContent = 'API Key not set. Click 🔑 to add.';
                apiKeyStatus.className = 'status error';
            }
        });
    }
}

function toggleInfoArea() {
    if (!infoArea || !infoSeparator) return;
    const isHidden = infoArea.style.display === 'none';
    infoArea.style.display = isHidden ? 'block' : 'none';
    infoSeparator.style.display = isHidden ? 'block' : 'none';
}

function saveApiKey() {
    if(!apiKeyInput || !apiKeyStatus || !startScanButton) return;
    const apiKey = apiKeyInput.value.trim();
    if (apiKey) {
        chrome.storage.local.set({ geminiApiKey: apiKey }, () => {
            if (chrome.runtime.lastError) {
                apiKeyStatus.textContent = `Error: ${chrome.runtime.lastError.message}`;
                apiKeyStatus.className = 'status error';
            } else {
                apiKeyStatus.textContent = 'API Key saved successfully!';
                apiKeyStatus.className = 'status success';
                apiKeyInput.value = '';
                startScanButton.disabled = false;
            }
        });
    } else {
        apiKeyStatus.textContent = 'Please enter an API Key.';
        apiKeyStatus.className = 'status error';
    }
}

// --- Slider UI Update Function ---
function updateSliderAppearance(value) {
    if(!scanSensitivityLabel || !scanSensitivitySlider) return;
    const level = SENSITIVITY_LEVELS[value];
    if (level) {
        scanSensitivityLabel.textContent = level.name;
        scanSensitivityLabel.style.backgroundImage = level.gradient;
        scanSensitivitySlider.classList.remove('light-scan-track', 'medium-scan-track', 'deep-scan-track');
        scanSensitivitySlider.classList.add(level.trackClass);
    }
}

// --- Unreliable Domains Logic ---
function fetchAndDisplayUnreliableDomains() {
    if(!domainsTableContainer) return;
    domainsTableContainer.innerHTML = '<p class="table-message table-loading">Loading domains...</p>';

    chrome.runtime.sendMessage({ action: "getUnreliableDomains" }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("Error fetching unreliable domains:", chrome.runtime.lastError.message);
            domainsTableContainer.innerHTML = `<p class="table-message table-error">Error: ${chrome.runtime.lastError.message}</p>`;
            return;
        }
        if (response && response.success) {
            renderDomainsTable(response.data);
        } else {
            console.error("Failed to fetch unreliable domains:", response ? response.error : "No response");
            domainsTableContainer.innerHTML = `<p class="table-message table-error">Failed to load domains: ${response ? response.error : 'Unknown error'}</p>`;
        }
    });
}

function renderDomainsTable(domains) {
    if(!domainsTableContainer) return;
    if (!domains || domains.length === 0) {
        domainsTableContainer.innerHTML = '<p class="table-message table-empty">No domains listed yet.</p>';
        return;
    }

    const table = document.createElement('table');
    table.className = 'domains-table';
    
    const thead = document.createElement('thead');
    thead.innerHTML = `
        <tr>
            <th class="col-id">ID</th>
            <th class="col-url">Domain URL</th>
            <th class="col-reliability">Reliability</th>
            <th class="col-reason">Reason</th>
        </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    domains.forEach(domain => {
        const row = tbody.insertRow();
        
        const cellId = row.insertCell();
        cellId.textContent = domain.domain_id ? domain.domain_id.substring(0, 8) + '...' : 'N/A'; // Display first 8 chars of UUID
        cellId.className = 'cell-id';
        cellId.title = domain.domain_id || ''; // Show full ID on hover

        const cellDomain = row.insertCell();
        const domainLink = document.createElement('a');
        const urlString = String(domain.domain_url);
        domainLink.href = urlString.startsWith('http') ? urlString : `http://${urlString}`;
        domainLink.textContent = domain.domain_url;
        domainLink.target = "_blank"; 
        domainLink.rel = "noopener noreferrer";
        cellDomain.appendChild(domainLink);
        cellDomain.className = 'cell-url';

        const cellReliability = row.insertCell();
        cellReliability.textContent = domain.reliability;
        cellReliability.className = 'cell-reliability reliability-cell'; // Keep existing class for centering

        const cellReason = row.insertCell();
        cellReason.textContent = domain.reason || 'N/A'; // Display reason or N/A
        cellReason.className = 'cell-reason';
        if (domain.reason && domain.reason.length > 50) { // Add title for long reasons
            cellReason.title = domain.reason;
            cellReason.textContent = domain.reason.substring(0, 47) + '...';
        }

    });
    table.appendChild(tbody);

    domainsTableContainer.innerHTML = ''; 
    domainsTableContainer.appendChild(table);
}


// --- Analysis Logic ---
function analyzeTextQuery(sens) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError || !tabs || tabs.length === 0 || !tabs[0].id) {
            showError("Could not find active tab. Please ensure a page is loaded and try again.");
            showLoading(false); return;
        }
        const activeTabId = tabs[0].id;
        console.log(`Analyzing active tab: ${activeTabId}, Sensitivity: ${sens}`);

        chrome.tabs.sendMessage(
            activeTabId, { action: "getText" }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error("Error sending 'getText' to content script:", chrome.runtime.lastError.message);
                    showError(`Communication error with page: ${chrome.runtime.lastError.message}. Try reloading the page.`);
                    showLoading(false); return;
                }
                if (response && response.success && response.text) {
                    chrome.runtime.sendMessage(
                        { action: "analyzeText", text: response.text, sens: sens },
                        (analysisResponse) => {
                            showLoading(false);
                            if (chrome.runtime.lastError) {
                                console.error("Error receiving analysis from background:", chrome.runtime.lastError.message);
                                showError(`Analysis failed: ${chrome.runtime.lastError.message}`);
                                return;
                            }
                            if (analysisResponse && analysisResponse.success) {
                                displayAnalysisResults(analysisResponse, activeTabId, sens);
                                savePopupState(activeTabId);
                            } else {
                                showError(analysisResponse.error || "Analysis failed. Check background logs.");
                            }
                        }
                    );
                } else {
                    showError(response.error || "Failed to get text from page. The page might be too complex or empty.");
                    showLoading(false);
                }
            }
        );
    });
}

function displayAnalysisResults(analysisResponse, activeTabId, sens) {
    if (typeof analysisResponse.score !== 'undefined') {
        displayScoreBar(analysisResponse.score, analysisResponse.domainInfo);
    } else {
        if(scoreTextDisplayDiv) scoreTextDisplayDiv.textContent = 'Score N/A';
        if(progressBarDiv) {
            progressBarDiv.style.width = '0%';
            progressBarDiv.className = 'progress-bar';
        }
    }
    displayDomainWarning(analysisResponse.domainInfo);
    if (analysisResponse.flags && analysisResponse.flags.length > 0) {
        sendHighlightRequestToContentScript(analysisResponse.flags, activeTabId, sens);
    } else {
        console.log("No flags to highlight.");
    }
}

function displayDomainWarning(domainInfo) {
    if(!domainWarningDiv) return;
    if (domainInfo && typeof domainInfo.reliability === 'number') {
        const reliability = domainInfo.reliability;
        const domain = domainInfo.name || "Current domain";
        
        domainWarningDiv.style.display = 'block';
        if (reliability <= 5) { 
            domainWarningDiv.textContent = `⚠️ Warning: "${domain}" is often linked to unreliable info (Reliability: ${reliability}/10).`;
            domainWarningDiv.className = 'warning-message reliability-low';
        } else if (reliability >= 9) { 
            domainWarningDiv.textContent = `✅ Trusted Source: "${domain}" has a high reliability rating (${reliability}/10).`;
            domainWarningDiv.className = 'warning-message reliability-high';
        } else { 
            domainWarningDiv.textContent = `ℹ️ Info: "${domain}" has a moderate reliability score (${reliability}/10). Interpret with care.`;
            domainWarningDiv.className = 'warning-message reliability-medium';
        }
    } else {
        domainWarningDiv.style.display = 'none'; 
        domainWarningDiv.className = 'warning-message';
    }
}

// --- Popup State Management ---
function savePopupState(tabId) {
    const state = {
        currentView: mainAnalysisView && mainAnalysisView.style.display !== 'none' ? 'main' : 'domains',
        domainWarningText: domainWarningDiv ? domainWarningDiv.textContent : null,
        domainWarningDisplay: domainWarningDiv ? domainWarningDiv.style.display : null,
        domainWarningClassName: domainWarningDiv ? domainWarningDiv.className : null,
        scoreTextDisplayText: scoreTextDisplayDiv ? scoreTextDisplayDiv.textContent : null,
        progressBarWidth: progressBarDiv ? progressBarDiv.style.width : null,
        progressBarClassName: progressBarDiv ? progressBarDiv.className : null,
        resultsDisplay: resultsDiv ? resultsDiv.style.display : null,
        errorText: errorP ? errorP.textContent : null,
        sliderValue: scanSensitivitySlider ? scanSensitivitySlider.value : "1"
    };
    chrome.storage.local.set({ [`popupState_${tabId}`]: state }, () => {
        if (chrome.runtime.lastError) console.error("Error saving popup state:", chrome.runtime.lastError.message);
        else console.log("Popup state saved for tab:", tabId, state);
    });
}

function restorePopupState(tabId) {
    const key = `popupState_${tabId}`;
    chrome.storage.local.get([key], (data) => {
        if (chrome.runtime.lastError) {
            console.error("Error restoring popup state:", chrome.runtime.lastError.message);
            showMainAnalysisView(); 
            return;
        }
        const state = data[key];
        if (!state) {
            clearResults();
            if(scanSensitivitySlider) updateSliderAppearance(scanSensitivitySlider.value || "1");
            showMainAnalysisView(); 
            return;
        }

        console.log("Restoring popup state for tab:", tabId, state);

        if (state.currentView === 'domains') {
            showUnreliableDomainsView();
        } else {
            showMainAnalysisView();
        }

        if (domainWarningDiv) {
            domainWarningDiv.textContent = state.domainWarningText || '';
            domainWarningDiv.style.display = state.domainWarningDisplay || 'none';
            domainWarningDiv.className = state.domainWarningClassName || 'warning-message';
        }

        if (scoreTextDisplayDiv) scoreTextDisplayDiv.textContent = state.scoreTextDisplayText || '-- / 100';
        if (progressBarDiv) {
            progressBarDiv.style.width = state.progressBarWidth || '0%';
            progressBarDiv.className = state.progressBarClassName || 'progress-bar';
        }
        
        if (resultsDiv) resultsDiv.style.display = state.resultsDisplay || 'none';
        if (errorP) errorP.textContent = state.errorText || '';

        if (scanSensitivitySlider) {
            scanSensitivitySlider.value = state.sliderValue || "1";
            updateSliderAppearance(scanSensitivitySlider.value);
        }
        
        if (startScanButton && apiKeyStatus) {
            const apiKeyIsSet = apiKeyStatus.className.includes('success');
            startScanButton.disabled = !apiKeyIsSet;
        }
    });
}

// --- Helper Functions ---
function sendHighlightRequestToContentScript(flags, tabId, sens) {
    const action = { action: "highlightText", flags: flags, sens: sens };
    const callback = response => { if (chrome.runtime.lastError) console.warn("Could not send highlight request:", chrome.runtime.lastError.message); };
    if (!tabId) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs.length > 0 && tabs[0].id) chrome.tabs.sendMessage(tabs[0].id, action, callback);
        });
    } else {
        chrome.tabs.sendMessage(tabId, action, callback);
    }
}

function displayScoreBar(score, domainInfo) {
    if(!resultsDiv || !errorP || !scoreTextDisplayDiv || !progressBarDiv) return;
    const numericScore = Math.max(0, Math.min(100, Number(score)));
    resultsDiv.style.display = 'flex';
    errorP.textContent = '';
    scoreTextDisplayDiv.textContent = `${numericScore} / 100`;
    let colorClass = 'score-red';
    if (numericScore >= 90) colorClass = 'score-green';
    else if (numericScore >= 70) colorClass = 'score-yellow';
    progressBarDiv.style.width = `${numericScore}%`;
    progressBarDiv.className = 'progress-bar';
    progressBarDiv.classList.add(colorClass);

    if (domainInfo && !domainInfo.isUnreliable && numericScore <= 50 && domainInfo.name) {
        chrome.runtime.sendMessage({ action: "logNewUnreliableDomain", score: numericScore, domain: domainInfo.name }, 
            response => { if (chrome.runtime.lastError) console.warn("Error logging unreliable domain:", chrome.runtime.lastError.message); }
        );
    }
}

function showLoading(isLoading) {
    if(loadingIndicator) loadingIndicator.style.display = isLoading ? 'flex' : 'none';
    if (startScanButton) startScanButton.disabled = isLoading;
    if (scanSensitivitySlider) scanSensitivitySlider.disabled = isLoading;
}

function showError(message) {
    if (resultsDiv) resultsDiv.style.display = 'none';
    if (errorP) errorP.textContent = `Error: ${message}`;
    console.error("Error displayed to user:", message);
    showLoading(false);
}

function clearResults() {
    if (scoreTextDisplayDiv) scoreTextDisplayDiv.textContent = '-- / 100';
    if (progressBarDiv) { progressBarDiv.style.width = '0%'; progressBarDiv.className = 'progress-bar'; }
    if (errorP) errorP.textContent = '';
    if (resultsDiv) resultsDiv.style.display = 'none';
    if (domainWarningDiv) { domainWarningDiv.style.display = 'none'; domainWarningDiv.className = 'warning-message';}
    sendHighlightRequestToContentScript(null);
}
