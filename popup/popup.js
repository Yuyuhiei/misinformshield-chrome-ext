// popup/popup.js

// DOM Elements for new UI (Slider and single scan button)
const scanSensitivitySlider = document.getElementById('scanSensitivity');
const scanSensitivityLabel = document.getElementById('scanSensitivityLabel');
const startScanButton = document.getElementById('startScanButton');

// Existing DOM Elements from your provided JS
const resultsDiv = document.getElementById('results');
const analysisRawTextPre = document.getElementById('analysisRawText'); // Keep if used
const loadingIndicator = document.getElementById('loadingIndicator');
const errorP = document.getElementById('error'); // Ensure this ID matches HTML (changed to error-message class)
const scoreTextDisplayDiv = document.getElementById('scoreTextDisplay');
const progressBarDiv = document.getElementById('progressBar');
const domainWarningDiv = document.getElementById('domainWarning');

// API Key & Info Elements from your provided JS
const apiKeyInput = document.getElementById('apiKey');
const saveApiKeyButton = document.getElementById('saveApiKey');
const apiKeyStatus = document.getElementById('apiKeyStatus');
const toggleApiKeyButton = document.getElementById('toggleApiKeyButton');
const toggleInfoButton = document.getElementById('toggleInfoButton');
const apiKeyInputArea = document.getElementById('apiKeyInputArea');
const infoArea = document.getElementById('infoArea');
const infoSeparator = document.getElementById('infoSeparator');
const apiKeySeparator = document.getElementById('apiKeySeparator');

// Sensitivity levels mapping for the slider
const SENSITIVITY_LEVELS = {
    1: { name: "Light Scan", value: "light", gradient: "linear-gradient(to right, #6EE7B7, #34D399)", trackClass: "light-scan-track" },
    2: { name: "Medium Scan", value: "medium", gradient: "linear-gradient(to right, #FCD34D, #FBBF24)", trackClass: "medium-scan-track" },
    3: { name: "Deep Scan", value: "deep", gradient: "linear-gradient(to right, #F87171, #EF4444)", trackClass: "deep-scan-track" }
};

// --- Initialize UI and Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    // Initialize API Key status and visibility
    chrome.storage.local.get(['geminiApiKey'], (result) => {
        if (result.geminiApiKey) {
            apiKeyStatus.textContent = 'API Key is set.';
            apiKeyStatus.className = 'status success'; // Use new class
            if (startScanButton) startScanButton.disabled = false;
        } else {
            apiKeyStatus.textContent = 'API Key not set. Click 🔑 to add.';
            apiKeyStatus.className = 'status error'; // Use new class
            if (startScanButton) startScanButton.disabled = true;
        }
    });

    // Restore popup state or clear if reloaded
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError || !tabs || tabs.length === 0) {
            console.error("Error querying tabs or no active tab found.");
            return;
        }
        const tabId = tabs[0].id;
        // Performance.getEntriesByType is not always available in extensions, especially on first open.
        // A simpler check might be needed if this causes issues, or rely on onUpdated listener in background.
        let isReload = false;
        try {
            const navEntries = performance.getEntriesByType("navigation");
            isReload = navEntries && navEntries.length > 0 && navEntries[0].type === "reload";
        } catch (e) {
            console.warn("performance.getEntriesByType not available or failed:", e);
            // Fallback: if popup is opened, assume it's not a reload for state restoration purposes,
            // background script handles clearing state on actual tab reloads.
        }


        if (isReload) {
            console.log("Page reloaded, clearing results from popup.js");
            clearResults(); // Clear results on page reload
            chrome.storage.local.remove(`popupState_${tabId}`); // Also clear stored state for this tab
        } else {
            restorePopupState(tabId); // Restore state if not a reload
        }
    });

    // Set initial slider label and track color
    if (scanSensitivitySlider) { // Check if element exists
        updateSliderAppearance(scanSensitivitySlider.value);
    }


    // Event listener for API key toggle button
    if (toggleApiKeyButton) toggleApiKeyButton.addEventListener('click', toggleApiKeyInputArea);

    // Event listener for Info toggle button
    if (toggleInfoButton) toggleInfoButton.addEventListener('click', toggleInfoArea);

    // Event listener for saving API key
    if (saveApiKeyButton) saveApiKeyButton.addEventListener('click', saveApiKey);

    // Event listener for slider input
    if (scanSensitivitySlider) {
        scanSensitivitySlider.addEventListener('input', (event) => {
            updateSliderAppearance(event.target.value);
        });
    }

    // Event listener for the "Start Scan" button
    if (startScanButton) {
        startScanButton.addEventListener('click', () => {
            const sensitivityValue = scanSensitivitySlider.value;
            const selectedSensitivity = SENSITIVITY_LEVELS[sensitivityValue]?.value || "light";

            console.log(`Start Scan button clicked. Sensitivity: ${selectedSensitivity}`);
            clearResults();
            showLoading(true);
            sendHighlightRequestToContentScript(null); // Clear previous highlights
            analyzeTextQuery(selectedSensitivity);
        });
    }
});


// --- API Key Handling Functions ---
function toggleApiKeyInputArea() {
    if (!apiKeyInputArea || !apiKeySeparator || !apiKeyStatus) return;
    const isHidden = apiKeyInputArea.style.display === 'none';
    apiKeyInputArea.style.display = isHidden ? 'block' : 'none';
    apiKeySeparator.style.display = isHidden ? 'block' : 'none';

    if (isHidden) { // When showing the input area
        chrome.storage.local.get(['geminiApiKey'], (result) => {
            if (!result.geminiApiKey) {
                apiKeyStatus.textContent = 'Enter your Gemini API Key below.';
                apiKeyStatus.className = 'status neutral';
            } else {
                apiKeyStatus.textContent = 'API Key is set. You can update it below.';
                apiKeyStatus.className = 'status success';
            }
        });
    } else { // When hiding, revert status based on whether key is actually saved
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
    if (!apiKeyInput || !apiKeyStatus || !startScanButton) return;
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
    if (!scanSensitivityLabel || !scanSensitivitySlider) return;
    const level = SENSITIVITY_LEVELS[value];
    if (level) {
        scanSensitivityLabel.textContent = level.name;
        scanSensitivityLabel.style.backgroundImage = level.gradient;
        
        scanSensitivitySlider.classList.remove('light-scan-track', 'medium-scan-track', 'deep-scan-track');
        scanSensitivitySlider.classList.add(level.trackClass);
    }
}


// --- Analysis Logic ---
function analyzeTextQuery(sens) { // 'sens' is the sensitivity from slider
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
                        { action: "analyzeText", text: response.text, sens: sens }, // Pass sensitivity
                        (analysisResponse) => {
                            showLoading(false);
                            if (chrome.runtime.lastError) {
                                console.error("Error receiving analysis from background:", chrome.runtime.lastError.message);
                                showError(`Analysis failed: ${chrome.runtime.lastError.message}`);
                                return;
                            }

                            if (analysisResponse && analysisResponse.success) {
                                displayAnalysisResults(analysisResponse, activeTabId, sens); // Pass sens for highlighting
                                savePopupState(activeTabId); // Save state after successful analysis
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
    // Display score bar
    if (typeof analysisResponse.score !== 'undefined') {
        displayScoreBar(analysisResponse.score, analysisResponse.domainInfo);
    } else {
        if (scoreTextDisplayDiv) scoreTextDisplayDiv.textContent = 'Score N/A';
        if (progressBarDiv) {
            progressBarDiv.style.width = '0%';
            progressBarDiv.className = 'progress-bar'; // Reset color
        }
    }

    // Display Domain Warning (using your existing logic structure)
    if (domainWarningDiv && analysisResponse.domainInfo && typeof analysisResponse.domainInfo.reliability === 'number') {
        const reliability = analysisResponse.domainInfo.reliability;
        const domain = analysisResponse.domainInfo.name || "Current domain";
        
        domainWarningDiv.style.display = 'block';
        domainWarningDiv.style.marginTop = '10px'; // from new CSS
        domainWarningDiv.style.padding = '10px';   // from new CSS
        domainWarningDiv.style.borderWidth = '1px';// from new CSS
        domainWarningDiv.style.borderStyle = 'solid';// from new CSS
        domainWarningDiv.style.borderRadius = '6px';// from new CSS

        if (reliability <= 5) { // Unreliable
            domainWarningDiv.textContent = `⚠️ Warning: "${domain}" is often linked to unreliable info (Reliability: ${reliability}/10).`;
            domainWarningDiv.style.color = '#856404'; // Dark yellow/brown text
            domainWarningDiv.style.backgroundColor = '#fff3cd'; // Light yellow background
            domainWarningDiv.style.borderColor = '#ffeeba'; // Yellowish border
        } else if (reliability >= 9) { // Highly reliable
            domainWarningDiv.textContent = `✅ Trusted Source: "${domain}" has a high reliability rating (${reliability}/10).`;
            domainWarningDiv.style.color = '#155724'; // Dark green text
            domainWarningDiv.style.backgroundColor = '#d4edda'; // Light green background
            domainWarningDiv.style.borderColor = '#c3e6cb'; // Greenish border
        } else { // Medium reliability
            domainWarningDiv.textContent = `ℹ️ Info: "${domain}" has a moderate reliability score (${reliability}/10). Interpret with care.`;
            domainWarningDiv.style.color = '#004085'; // Dark blue text
            domainWarningDiv.style.backgroundColor = '#cce5ff'; // Light blue background
            domainWarningDiv.style.borderColor = '#b8daff'; // Bluish border
        }
    } else if (domainWarningDiv) {
        domainWarningDiv.style.display = 'none'; // Hide if no info
    }


    // Send flags to content script for highlighting
    if (analysisResponse.flags && analysisResponse.flags.length > 0) {
        sendHighlightRequestToContentScript(analysisResponse.flags, activeTabId, sens);
    } else {
        console.log("No flags to highlight.");
    }
}

// --- Popup State Management ---
function savePopupState(tabId) {
    const state = {
        domainWarning: domainWarningDiv ? {
            text: domainWarningDiv.textContent,
            style: { // Capture all relevant styles applied by JS
                display: domainWarningDiv.style.display,
                color: domainWarningDiv.style.color,
                backgroundColor: domainWarningDiv.style.backgroundColor,
                borderColor: domainWarningDiv.style.borderColor,
                marginTop: domainWarningDiv.style.marginTop,
                padding: domainWarningDiv.style.padding,
                borderWidth: domainWarningDiv.style.borderWidth,
                borderStyle: domainWarningDiv.style.borderStyle,
                borderRadius: domainWarningDiv.style.borderRadius,
            }
        } : null,
        scoreTextDisplay: scoreTextDisplayDiv && progressBarDiv ? {
            text: scoreTextDisplayDiv.textContent,
            width: progressBarDiv.style.width,
            className: progressBarDiv.className
        } : null,
        resultsDisplay: resultsDiv ? resultsDiv.style.display : null,
        errorText: errorP ? errorP.textContent : null,
        sliderValue: scanSensitivitySlider ? scanSensitivitySlider.value : "1" // Save slider position
    };
    chrome.storage.local.set({ [`popupState_${tabId}`]: state }, () => {
        if (chrome.runtime.lastError) {
            console.error("Error saving popup state:", chrome.runtime.lastError.message);
        } else {
            console.log("Popup state saved for tab:", tabId);
        }
    });
}

function restorePopupState(tabId) {
    const key = `popupState_${tabId}`;
    chrome.storage.local.get([key], (data) => {
        if (chrome.runtime.lastError) {
            console.error("Error restoring popup state:", chrome.runtime.lastError.message);
            return;
        }
        const state = data[key];
        if (!state) {
            clearResults(); // If no state, ensure UI is clear
            if (scanSensitivitySlider) updateSliderAppearance(scanSensitivitySlider.value || "1");
            return;
        }

        console.log("Restoring popup state for tab:", tabId, state);

        if (state.domainWarning && domainWarningDiv) {
            domainWarningDiv.textContent = state.domainWarning.text;
            Object.assign(domainWarningDiv.style, state.domainWarning.style);
        } else if (domainWarningDiv) {
            domainWarningDiv.style.display = 'none';
        }

        if (state.scoreTextDisplay && scoreTextDisplayDiv && progressBarDiv) {
            scoreTextDisplayDiv.textContent = state.scoreTextDisplay.text;
            progressBarDiv.style.width = state.scoreTextDisplay.width;
            progressBarDiv.className = state.scoreTextDisplay.className;
        } else if (scoreTextDisplayDiv && progressBarDiv) {
            scoreTextDisplayDiv.textContent = '-- / 100';
            progressBarDiv.style.width = '0%';
            progressBarDiv.className = 'progress-bar';
        }
        
        if (state.resultsDisplay && resultsDiv) {
            resultsDiv.style.display = state.resultsDisplay;
        } else if (resultsDiv) {
            resultsDiv.style.display = 'none';
        }

        if (state.errorText && errorP) {
            errorP.textContent = state.errorText;
        } else if (errorP) {
            errorP.textContent = '';
        }

        if (state.sliderValue && scanSensitivitySlider) {
            scanSensitivitySlider.value = state.sliderValue;
            updateSliderAppearance(state.sliderValue); // Update label and colors
        } else if (scanSensitivitySlider) {
             updateSliderAppearance("1"); // Default if not in state
        }
        
        // If results are visible, it implies a scan was done, so keep button enabled
        // unless loading is also part of state (which it isn't currently)
         if (startScanButton) {
            const apiKeyIsSet = apiKeyStatus && apiKeyStatus.className.includes('success');
            startScanButton.disabled = !apiKeyIsSet; // Only enable if API key is set
        }
    });
}


// --- Helper Functions ---
function sendHighlightRequestToContentScript(flags, tabId, sens) {
    const action = { action: "highlightText", flags: flags, sens: sens }; // Pass sensitivity
    if (!tabId) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs.length > 0 && tabs[0].id) {
                chrome.tabs.sendMessage(tabs[0].id, action, response => {
                    if (chrome.runtime.lastError) {
                        console.warn("Could not send highlight request (no tabId):", chrome.runtime.lastError.message);
                    }
                });
            }
        });
    } else {
        chrome.tabs.sendMessage(tabId, action, response => {
             if (chrome.runtime.lastError) {
                console.warn("Could not send highlight request (with tabId):", chrome.runtime.lastError.message);
            }
        });
    }
}

function displayScoreBar(score, domainInfo) {
    if (!resultsDiv || !errorP || !scoreTextDisplayDiv || !progressBarDiv) return; // Element checks
    const numericScore = Math.max(0, Math.min(100, Number(score)));
    resultsDiv.style.display = 'flex'; // Use flex as per new CSS
    errorP.textContent = '';

    scoreTextDisplayDiv.textContent = `${numericScore} / 100`;

    let colorClass = 'score-red'; // Default
    // Using your original score thresholds for colors:
    if (numericScore >= 90) colorClass = 'score-green';
    else if (numericScore >= 70) colorClass = 'score-yellow';


    progressBarDiv.style.width = `${numericScore}%`;
    progressBarDiv.className = 'progress-bar'; // Reset classes
    progressBarDiv.classList.add(colorClass);

    // Log domain if it's not marked unreliable and scores low (your existing logic)
    if (domainInfo && !domainInfo.isUnreliable && numericScore <= 50 && domainInfo.name) {
        chrome.runtime.sendMessage({
            action: "logNewUnreliableDomain",
            score: numericScore,
            domain: domainInfo.name
        }, response => {
            if (chrome.runtime.lastError) {
                console.warn("Error logging unreliable domain:", chrome.runtime.lastError.message);
            }
        });
    }
}

function showLoading(isLoading) {
    if (loadingIndicator) loadingIndicator.style.display = isLoading ? 'flex' : 'none'; // Use flex for spinner
    if (startScanButton) startScanButton.disabled = isLoading;
    if (scanSensitivitySlider) scanSensitivitySlider.disabled = isLoading;
}

function showError(message) {
    if (resultsDiv) resultsDiv.style.display = 'none';
    if (errorP) errorP.textContent = `Error: ${message}`; // errorP has class error-message in new HTML
    console.error("Error displayed to user:", message);
    showLoading(false); // Ensure loading is hidden on error
}

function clearResults() {
    if (scoreTextDisplayDiv) scoreTextDisplayDiv.textContent = '-- / 100';
    if (progressBarDiv) {
        progressBarDiv.style.width = '0%';
        progressBarDiv.className = 'progress-bar';
    }
    if (analysisRawTextPre) { // Check if it exists
        analysisRawTextPre.textContent = '';
        analysisRawTextPre.style.display = 'none';
    }
    if (errorP) errorP.textContent = '';
    if (resultsDiv) resultsDiv.style.display = 'none';
    if (domainWarningDiv) domainWarningDiv.style.display = 'none';

    sendHighlightRequestToContentScript(null); // Clear highlights on the page
}
