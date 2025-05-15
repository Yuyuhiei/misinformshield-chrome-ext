// popup/popup.js

// DOM Elements for new UI (Slider and single scan button)
const startScanButton = document.getElementById('startScanButton');

// Main Views & Navigation
const mainAnalysisView = document.getElementById('mainAnalysisView');
const popupTitle = document.getElementById('popupTitle'); 
const openDomainsPageButton = document.getElementById('openDomainsPageButton'); 

// Existing DOM Elements
const resultsDiv = document.getElementById('results');
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

// --- Initialize UI and Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(['geminiApiKey'], (result) => {
        if (apiKeyStatus && startScanButton) {
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

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError || !tabs || tabs.length === 0) {
            console.error("Popup.js: Error querying tabs or no active tab found.", chrome.runtime.lastError);
            return;
        }
        const tabId = tabs[0].id;
        const currentTabUrl = tabs[0].url;
        let isReload = false;
        try {
            const navEntries = performance.getEntriesByType("navigation");
            isReload = navEntries && navEntries.length > 0 && navEntries[0].type === "reload";
        } catch (e) {
            console.warn("Popup.js: performance.getEntriesByType not available or failed:", e);
        }

        if (isReload) {
            console.log("Popup.js: Page reloaded, clearing results and state.");
            clearResults(true, currentTabUrl); // Pass true to indicate it's a full clear for a web page
            chrome.storage.local.remove(`popupState_${tabId}`);
        } else {
            restorePopupState(tabId);
        }
    });


    if(toggleApiKeyButton) toggleApiKeyButton.addEventListener('click', toggleApiKeyInputArea);
    if(toggleInfoButton) toggleInfoButton.addEventListener('click', toggleInfoArea);
    if(saveApiKeyButton) saveApiKeyButton.addEventListener('click', saveApiKey);
    if(startScanButton) startScanButton.addEventListener('click', handleStartScan);
    
    if(openDomainsPageButton) {
        openDomainsPageButton.addEventListener('click', () => {
            const domainsPageUrl = chrome.runtime.getURL("/domains/domains_table.html");
            chrome.tabs.create({ url: domainsPageUrl });
        });
    }
});

function handleStartScan() {
    console.log(`Popup.js: Start Scan button clicked. Sensitivity: deep`);
    
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError || !tabs || !tabs[0]) {
            showError("Could not get active tab information for scan.");
            return;
        }
        const currentTabUrl = tabs[0].url;
        clearResults(true, currentTabUrl); // Clear previous results and highlights on the current page
        showLoading(true);
        analyzeTextQuery("deep"); // Always use deep scan
    });
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

// --- Analysis Logic --- 
function analyzeTextQuery(sens) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError || !tabs || tabs.length === 0 || !tabs[0].id) {
            showError("Could not find active tab. Please ensure a page is loaded and try again.");
            showLoading(false); return;
        }
        const activeTabId = tabs[0].id;
        const activeTabUrl = tabs[0].url; // Get URL to check if it's an extension page

        console.log(`Popup.js: Analyzing active tab: ${activeTabId}, URL: ${activeTabUrl}, Sensitivity: ${sens}`);

        // Only attempt to get text if it's not an extension page (like domains_table.html)
        if (activeTabUrl && !activeTabUrl.startsWith('chrome-extension://')) {
            chrome.tabs.sendMessage( activeTabId, { action: "getText" }, (textResponse) => {
                console.log("Popup.js: Received response for 'getText'.", "Last Error:", chrome.runtime.lastError, "Response:", textResponse);
                if (chrome.runtime.lastError) {
                    console.error("Popup.js: Error sending 'getText' to content script:", chrome.runtime.lastError.message);
                    showError(`Communication error with page: ${chrome.runtime.lastError.message}. Try reloading the page.`);
                    showLoading(false); return;
                }
                if (!textResponse) {
                    console.error("Popup.js: No response from content script for 'getText'.");
                    showError("Failed to get text from page: No response from content script.");
                    showLoading(false); return;
                }

                if (textResponse.success && textResponse.text) {
                    console.log("Popup.js: Sending 'analyzeText' message to background.");
                    chrome.runtime.sendMessage(
                        { action: "analyzeText", text: textResponse.text, sens: sens },
                        (analysisResponse) => {
                            console.log("Popup.js: Received response for 'analyzeText'.", "Last Error:", chrome.runtime.lastError, "Response:", analysisResponse);
                            showLoading(false);
                            if (chrome.runtime.lastError) {
                                console.error("Popup.js: Error receiving analysis from background:", chrome.runtime.lastError.message);
                                showError(`Analysis failed: ${chrome.runtime.lastError.message}`);
                                return;
                            }
                            if (!analysisResponse) { 
                                console.error("Popup.js: No response received from background for 'analyzeText'. Port might have closed.");
                                showError("Analysis failed: No response from background script.");
                                return;
                            }

                            if (analysisResponse.success) {
                                displayAnalysisResults(analysisResponse, activeTabId, sens, activeTabUrl); // Pass URL
                                savePopupState(activeTabId);
                            } else {
                                showError(analysisResponse.error || "Analysis failed. Check background logs.");
                            }
                        }
                    );
                } else {
                    showError(textResponse.error || "Failed to get text from page. The page might be too complex or empty.");
                    showLoading(false);
                }
            });
        } else {
            console.log("Popup.js: Skipping text analysis for extension page or invalid URL:", activeTabUrl);
            showError("Cannot analyze this type of page."); // Or handle more gracefully
            showLoading(false);
        }
    });
}

function displayAnalysisResults(analysisResponse, activeTabId, sens, tabUrl) { 
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
    // Only send highlight request if it's not an extension page
    if (tabUrl && !tabUrl.startsWith('chrome-extension://')) {
        if (analysisResponse.flags && analysisResponse.flags.length > 0) {
            sendHighlightRequestToContentScript(analysisResponse.flags, activeTabId, sens);
        } else {
            console.log("Popup.js: No flags to highlight.");
        }
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
        domainWarningText: domainWarningDiv ? domainWarningDiv.textContent : null,
        domainWarningDisplay: domainWarningDiv ? domainWarningDiv.style.display : null,
        domainWarningClassName: domainWarningDiv ? domainWarningDiv.className : null,
        scoreTextDisplayText: scoreTextDisplayDiv ? scoreTextDisplayDiv.textContent : null,
        progressBarWidth: progressBarDiv ? progressBarDiv.style.width : null,
        progressBarClassName: progressBarDiv ? progressBarDiv.className : null,
        resultsDisplay: resultsDiv ? resultsDiv.style.display : null,
        errorText: errorP ? errorP.textContent : null
    };
    chrome.storage.local.set({ [`popupState_${tabId}`]: state }, () => {
        if (chrome.runtime.lastError) console.error("Popup.js: Error saving popup state:", chrome.runtime.lastError.message);
        else console.log("Popup.js: Popup state saved for tab:", tabId, state);
    });
}
function restorePopupState(tabId) { 
    const key = `popupState_${tabId}`;
    chrome.storage.local.get([key], (data) => {
        if (chrome.runtime.lastError) {
            console.error("Popup.js: Error restoring popup state:", chrome.runtime.lastError.message);
            return;
        }
        const state = data[key];
        if (!state) {
            clearResults(false); // Don't try to clear highlights if just opening popup
            if(scanSensitivitySlider) updateSliderAppearance(scanSensitivitySlider.value || "1");
            return;
        }

        console.log("Popup.js: Restoring popup state for tab:", tabId, state);

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

        if (startScanButton && apiKeyStatus) {
            const apiKeyIsSet = apiKeyStatus.className.includes('success');
            startScanButton.disabled = !apiKeyIsSet;
        }
    });
}

// --- Helper Functions --- 
function sendHighlightRequestToContentScript(flags, tabId, sens) { 
    // No change needed here, the caller should ensure tabId is for a page with content script
    const action = { action: "highlightText", flags: flags, sens: sens };
    const callback = response => { 
        if (chrome.runtime.lastError) {
            // Log the error but don't show it to the user in the popup,
            // as this might be called when not expected (e.g., on an extension page)
            console.warn("Popup.js (sendHighlightRequestToContentScript):", chrome.runtime.lastError.message);
        }
    };
    if (!tabId) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs.length > 0 && tabs[0].id && tabs[0].url && !tabs[0].url.startsWith('chrome-extension://')) {
                 chrome.tabs.sendMessage(tabs[0].id, action, callback);
            } else if (tabs && tabs.length > 0 && tabs[0].url && tabs[0].url.startsWith('chrome-extension://')) {
                console.log("Popup.js: Not sending highlight request to an extension page:", tabs[0].url);
            }
        });
    } else {
        // Before sending, quickly check the URL of the tabId if possible
        chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError) {
                console.warn("Popup.js: Could not get tab info for highlight request:", chrome.runtime.lastError.message);
                return;
            }
            if (tab && tab.url && !tab.url.startsWith('chrome-extension://')) {
                chrome.tabs.sendMessage(tabId, action, callback);
            } else {
                console.log("Popup.js: Not sending highlight request to an extension page or invalid tab:", tab ? tab.url : "unknown URL");
            }
        });
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
            response => { if (chrome.runtime.lastError) console.warn("Popup.js: Error logging unreliable domain:", chrome.runtime.lastError.message); }
        );
    }
}
function showLoading(isLoading) { 
    if(loadingIndicator) loadingIndicator.style.display = isLoading ? 'flex' : 'none';
    if (startScanButton) startScanButton.disabled = isLoading;
}
function showError(message) { 
    if (resultsDiv) resultsDiv.style.display = 'none';
    if (errorP) errorP.textContent = `Error: ${message}`;
    console.error("Popup.js: Error displayed to user:", message);
    showLoading(false);
}

function clearResults(attemptHighlightClear = false, tabUrlForHighlightClear = null) { 
    if (scoreTextDisplayDiv) scoreTextDisplayDiv.textContent = '-- / 100';
    if (progressBarDiv) { progressBarDiv.style.width = '0%'; progressBarDiv.className = 'progress-bar'; }
    if (errorP) errorP.textContent = '';
    if (resultsDiv) resultsDiv.style.display = 'none';
    if (domainWarningDiv) { domainWarningDiv.style.display = 'none'; domainWarningDiv.className = 'warning-message';}
    
    if (attemptHighlightClear && tabUrlForHighlightClear && !tabUrlForHighlightClear.startsWith('chrome-extension://')) {
        // Get current tab ID to send message specifically
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs.length > 0 && tabs[0].id) {
                 sendHighlightRequestToContentScript(null, tabs[0].id, null); // Send to specific tab
            } else {
                console.warn("Popup.js (clearResults): Could not get active tab ID to clear highlights.");
            }
        });
    } else if (attemptHighlightClear) {
        console.log("Popup.js (clearResults): Not attempting highlight clear for extension page or no URL.");
    }
}
