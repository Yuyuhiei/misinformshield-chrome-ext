// popup/popup.js

// DOM Elements for new UI
const scanSensitivitySlider = document.getElementById('scanSensitivity');
const scanSensitivityLabel = document.getElementById('scanSensitivityLabel');
const startScanButton = document.getElementById('startScanButton');

// Existing DOM Elements (ensure they are still relevant or update as needed)
const resultsDiv = document.getElementById('results');
// const analysisRawTextPre = document.getElementById('analysisRawText'); // Kept commented if not used
const loadingIndicator = document.getElementById('loadingIndicator');
const errorP = document.getElementById('error'); // Ensure this ID exists or update
const scoreTextDisplayDiv = document.getElementById('scoreTextDisplay');
const progressBarDiv = document.getElementById('progressBar');
const domainWarningDiv = document.getElementById('domainWarning');

// API Key Elements
const apiKeyInput = document.getElementById('apiKey');
const saveApiKeyButton = document.getElementById('saveApiKey');
const apiKeyStatus = document.getElementById('apiKeyStatus');
const toggleApiKeyButton = document.getElementById('toggleApiKeyButton');
const apiKeyInputArea = document.getElementById('apiKeyInputArea');
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
        if (result.geminiApiKey) {
            apiKeyStatus.textContent = 'API Key is set.';
            apiKeyStatus.className = 'status success'; // Use new class
            startScanButton.disabled = false;
        } else {
            apiKeyStatus.textContent = 'API Key not set. Click 🔑 to add.';
            apiKeyStatus.className = 'status error'; // Use new class
            startScanButton.disabled = true;
        }
    });

    // Restore popup state or clear if reloaded
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError || !tabs || tabs.length === 0) {
            console.error("Error querying tabs or no active tab found.");
            // Potentially call clearResults() or handle error appropriately
            return;
        }
        const tabId = tabs[0].id;
        const navEntries = performance.getEntriesByType("navigation");
        // Check if navEntries is available and has entries.
        // In some contexts (like a freshly opened popup without prior navigation in the tab), navEntries might be empty or undefined.
        const isReload = navEntries && navEntries.length > 0 && navEntries[0].type === "reload";

        if (isReload) {
            clearResults(); // Clear results on page reload
            // Also clear stored state for this tab
            chrome.storage.local.remove(`popupState_${tabId}`);
        } else {
            restorePopupState(tabId); // Restore state if not a reload
        }
    });

    // Set initial slider label and track color
    updateSliderAppearance(scanSensitivitySlider.value);

    // Event listener for API key toggle button
    toggleApiKeyButton.addEventListener('click', toggleApiKeyInputArea);

    // Event listener for saving API key
    saveApiKeyButton.addEventListener('click', saveApiKey);

    // Event listener for slider input
    scanSensitivitySlider.addEventListener('input', (event) => {
        updateSliderAppearance(event.target.value);
    });

    // Event listener for the "Start Scan" button
    startScanButton.addEventListener('click', () => {
        const sensitivityValue = scanSensitivitySlider.value;
        const selectedSensitivity = SENSITIVITY_LEVELS[sensitivityValue]?.value || "light"; // Default to light if something goes wrong

        console.log(`Start Scan button clicked. Sensitivity: ${selectedSensitivity}`);
        clearResults();
        showLoading(true);
        sendHighlightRequestToContentScript(null); // Clear previous highlights
        analyzeTextQuery(selectedSensitivity);
    });
});


// --- API Key Handling Functions ---
function toggleApiKeyInputArea() {
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
        // When hiding, revert status based on whether key is actually saved
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

function saveApiKey() {
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
                // Optionally hide after saving:
                // apiKeyInputArea.style.display = 'none';
                // apiKeySeparator.style.display = 'none';
            }
        });
    } else {
        apiKeyStatus.textContent = 'Please enter an API Key.';
        apiKeyStatus.className = 'status error';
    }
}

// --- Slider UI Update Function ---
function updateSliderAppearance(value) {
    const level = SENSITIVITY_LEVELS[value];
    if (level) {
        scanSensitivityLabel.textContent = level.name;
        scanSensitivityLabel.style.backgroundImage = level.gradient;
        
        // Update slider track class for background gradient
        scanSensitivitySlider.classList.remove('light-scan-track', 'medium-scan-track', 'deep-scan-track');
        scanSensitivitySlider.classList.add(level.trackClass);
    }
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

        // Request text from content script
        chrome.tabs.sendMessage(
            activeTabId, { action: "getText" }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error("Error sending 'getText' to content script:", chrome.runtime.lastError.message);
                    showError(`Communication error with page: ${chrome.runtime.lastError.message}. Try reloading the page.`);
                    showLoading(false); return;
                }
                if (response && response.success && response.text) {
                    // Send text to background for analysis
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
        scoreTextDisplayDiv.textContent = 'Score N/A';
        progressBarDiv.style.width = '0%';
        progressBarDiv.className = 'progress-bar'; // Reset color
    }

    // Display Domain Warning
    displayDomainWarning(analysisResponse.domainInfo);

    // Send flags to content script for highlighting
    if (analysisResponse.flags && analysisResponse.flags.length > 0) {
        sendHighlightRequestToContentScript(analysisResponse.flags, activeTabId, sens);
    } else {
        console.log("No flags to highlight.");
        // Optionally, inform user no specific items were flagged in the popup
    }
}

function displayDomainWarning(domainInfo) {
    if (domainInfo && typeof domainInfo.reliability === 'number') {
        const reliability = domainInfo.reliability;
        const domain = domainInfo.name || "Current domain"; // Fallback for domain name
        
        domainWarningDiv.style.display = 'block'; // Make it visible
        domainWarningDiv.style.marginTop = '10px';
        domainWarningDiv.style.padding = '10px'; // Consistent padding
        domainWarningDiv.style.borderWidth = '1px'; // Ensure border is visible
        domainWarningDiv.style.borderStyle = 'solid';
        domainWarningDiv.style.borderRadius = '6px'; // Consistent border radius

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
    } else {
        domainWarningDiv.style.display = 'none'; // Hide if no info
    }
}


// --- Popup State Management ---
function savePopupState(tabId) {
    // Make sure all elements exist before trying to access their properties
    const state = {
        domainWarning: domainWarningDiv ? {
            text: domainWarningDiv.textContent,
            style: {
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
            updateSliderAppearance(scanSensitivitySlider.value || "1"); // Reset slider appearance
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
        if (resultsDiv && resultsDiv.style.display !== 'none' && startScanButton) {
             startScanButton.disabled = false;
        } else if (startScanButton && !apiKeyStatus.textContent.includes("not set")) { // only enable if API key is set
             startScanButton.disabled = false;
        } else if (startScanButton) {
             startScanButton.disabled = true;
        }


    });
}


// --- Helper Functions ---
function sendHighlightRequestToContentScript(flags, tabId, sens) {
    const action = { action: "highlightText", flags: flags, sens: sens };
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
    const numericScore = Math.max(0, Math.min(100, Number(score)));
    resultsDiv.style.display = 'flex';
    errorP.textContent = '';

    scoreTextDisplayDiv.textContent = `${numericScore} / 100`;

    let colorClass = 'score-red'; // Default
    if (numericScore >= 75) colorClass = 'score-green'; // Adjusted threshold for green
    else if (numericScore >= 50) colorClass = 'score-yellow'; // Adjusted threshold for yellow

    progressBarDiv.style.width = `${numericScore}%`;
    progressBarDiv.className = 'progress-bar'; // Reset classes
    progressBarDiv.classList.add(colorClass);

    // Log domain if it's not marked unreliable and scores low
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
    loadingIndicator.style.display = isLoading ? 'flex' : 'none'; // Use flex for spinner alignment
    if (startScanButton) startScanButton.disabled = isLoading;
    if (scanSensitivitySlider) scanSensitivitySlider.disabled = isLoading;
}

function showError(message) {
    if (resultsDiv) resultsDiv.style.display = 'none';
    if (errorP) errorP.textContent = `Error: ${message}`;
    console.error("Error displayed to user:", message);
    showLoading(false); // Ensure loading is hidden on error
}

function clearResults() {
    if (scoreTextDisplayDiv) scoreTextDisplayDiv.textContent = '-- / 100';
    if (progressBarDiv) {
        progressBarDiv.style.width = '0%';
        progressBarDiv.className = 'progress-bar';
    }
    // if (analysisRawTextPre) analysisRawTextPre.textContent = '';
    if (errorP) errorP.textContent = '';
    if (resultsDiv) resultsDiv.style.display = 'none';
    if (domainWarningDiv) domainWarningDiv.style.display = 'none';

    // Do not clear API key status here
    // Do not disable scan button here, let API key check handle it

    sendHighlightRequestToContentScript(null); // Clear highlights on the page
}
