// popup/popup.js

const analyzeButtonL = document.getElementById('analyzeButtonL');
const analyzeButtonM = document.getElementById('analyzeButtonM');
const analyzeButtonD = document.getElementById('analyzeButtonD');
const resultsDiv = document.getElementById('results');
const analysisRawTextPre = document.getElementById('analysisRawText');
const loadingIndicator = document.getElementById('loadingIndicator');
const errorP = document.getElementById('error');
const scoreTextDisplayDiv = document.getElementById('scoreTextDisplay');
const progressBarDiv = document.getElementById('progressBar');
const domainWarningDiv = document.getElementById('domainWarning'); // Added for domain warning

// API Key Elements
const apiKeyInput = document.getElementById('apiKey');
const saveApiKeyButton = document.getElementById('saveApiKey');
const apiKeyStatus = document.getElementById('apiKeyStatus');
const toggleApiKeyButton = document.getElementById('toggleApiKeyButton'); // New button
const apiKeyInputArea = document.getElementById('apiKeyInputArea'); // The div containing the input/button
const apiKeySeparator = document.getElementById('apiKeySeparator'); // The <hr> separator

// --- API Key Handling ---
document.addEventListener('DOMContentLoaded', () => {
    // Check if API key exists and update status, but don't show input
    chrome.storage.local.get(['geminiApiKey'], (result) => {
        if (result.geminiApiKey) {
            apiKeyStatus.textContent = 'API Key is set.';
            apiKeyStatus.style.color = 'green';
            analyzeButtonL.disabled = false; // Enable analyze button if key exists
            analyzeButtonM.disabled = false; // Enable analyze button if key exists
            analyzeButtonD.disabled = false; // Enable analyze button if key exists
        } else {
            apiKeyStatus.textContent = 'API Key not set. Click 🔑 to add.';
            apiKeyStatus.style.color = '#e74c3c'; // Use error color
            analyzeButtonL.disabled = true; // Disable analyze button if no key
            analyzeButtonM.disabled = true; // Disable analyze button if no key
            analyzeButtonD.disabled = true; // Disable analyze button if no key
        }

         // Now do reload detection and restore/clear per-tab state
         chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tabId = tabs[0].id;
            const navEntries = performance.getEntriesByType("navigation");
            const isReload = navEntries.length && navEntries[0].type === "reload";

            if (isReload) {
                console.log("reloaded");
                clearResults();
            } else {
                restorePopupState(tabId);
            }
        });
    });

    
});

// this is a function to save the popup state after analysis
function savePopupState() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0].id;
    
        const state = {
            domainWarning: {
                text: domainWarningDiv.textContent,
                style: {
                    marginTop: domainWarningDiv.style.marginTop,
                    padding: domainWarningDiv.style.padding,
                    border: domainWarningDiv.style.border,
                    borderRadius: domainWarningDiv.style.borderRadius,
                    display: domainWarningDiv.style.display,
                    color: domainWarningDiv.style.color,
                    backgroundColor: domainWarningDiv.style.backgroundColor,
                    borderColor: domainWarningDiv.style.borderColor
                }
            },
            scoreTextDisplay: {
                text: scoreTextDisplayDiv.textContent,
                width: progressBarDiv.style.width,
                className: progressBarDiv.className
            },
            results: resultsDiv.style.display,
            errorText: errorP.textContent
        };
    
        chrome.storage.local.set({ [`popupState_${tabId}`]: state });
    });
}

function restorePopupState() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0].id;
        const key = `popupState_${tabId}`;

        chrome.storage.local.get([key], (data) => {
            const state = data[key];
            if (!state) return;

            if (state.domainWarning && domainWarningDiv) {
                domainWarningDiv.textContent = state.domainWarning.text;
                Object.assign(domainWarningDiv.style, state.domainWarning.style);
            }

            if (state.scoreTextDisplay && scoreTextDisplayDiv && progressBarDiv) {
                scoreTextDisplayDiv.textContent = state.scoreTextDisplay.text;
                progressBarDiv.style.width = state.scoreTextDisplay.width;
                progressBarDiv.className = state.scoreTextDisplay.className;
            }

            if (state.results && resultsDiv) {
                resultsDiv.style.display = state.results;
            }

            if (state.errorText && errorP) {
                errorP.textContent = state.errorText;
            }
        });
    });
}

saveApiKeyButton.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    if (apiKey) {
        chrome.storage.local.set({ geminiApiKey: apiKey }, () => {
            if (chrome.runtime.lastError) {
                apiKeyStatus.textContent = `Error saving key: ${chrome.runtime.lastError.message}`;
                apiKeyStatus.style.color = '#e74c3c';
            } else {
                apiKeyStatus.textContent = 'API Key saved successfully!';
                apiKeyStatus.style.color = 'green';
                apiKeyInput.value = ''; // Clear the input field
                analyzeButtonL.disabled = false; // Enable analyze button
                analyzeButtonM.disabled = false; // Enable analyze button
                analyzeButtonD.disabled = false; // Enable analyze button
                // Optionally hide the section after saving
                // apiKeyInputArea.style.display = 'none';
                // apiKeySeparator.style.display = 'none';
            }
        });
    } else {
        apiKeyStatus.textContent = 'Please enter an API Key.';
        apiKeyStatus.style.color = '#e74c3c';
    }
});

// Listener for the key icon button
toggleApiKeyButton.addEventListener('click', () => {
    const isHidden = apiKeyInputArea.style.display === 'none';
    apiKeyInputArea.style.display = isHidden ? 'block' : 'none';
    apiKeySeparator.style.display = isHidden ? 'block' : 'none';
    // Update status message when showing the input area if no key is set
    if (isHidden) {
        chrome.storage.local.get(['geminiApiKey'], (result) => {
            if (!result.geminiApiKey) {
                apiKeyStatus.textContent = 'Enter your Gemini API Key below.';
                apiKeyStatus.style.color = '#555'; // Neutral color
            } else {
                // If key exists, maybe show a different message or keep the 'Key is set' message
                apiKeyStatus.textContent = 'API Key is set. You can update it below.';
                apiKeyStatus.style.color = 'green';
            }
        });
    } else {
        // When hiding, revert status based on whether key is actually saved
        chrome.storage.local.get(['geminiApiKey'], (result) => {
            if (result.geminiApiKey) {
                apiKeyStatus.textContent = 'API Key is set.';
                apiKeyStatus.style.color = 'green';
            } else {
                apiKeyStatus.textContent = 'API Key not set. Click 🔑 to add.';
                apiKeyStatus.style.color = '#e74c3c';
            }
        });
    }
});
// --- (End API Key Handling) ---

// --- Used for checking logging new unreliable domain ---
// analyzeButton.addEventListener('click', () => {
//     console.log("Analyze button clicked.");
//     const domain_info_test = {      // Add domain info to the response
//         name: 'example.com',
//         isUnreliable: false,
//         reliability: null
//     }
//     displayScoreBar(30, domain_info_test); // Temporary for testing
// });

// --- Analysis Trigger ---
analyzeButtonL.addEventListener('click', () => {
    console.log("Analyze button clicked.");
    clearResults();
    showLoading(true);
    // Clear previous highlights on the page
    sendHighlightRequestToContentScript(null); // Send null to clear
    analyzeTextQuery('light')
}); // End analyzeButtonL listener

analyzeButtonM.addEventListener('click', () => {
    console.log("Analyze button clicked.");
    clearResults();
    showLoading(true);
    // Clear previous highlights on the page
    sendHighlightRequestToContentScript(null); // Send null to clear
    analyzeTextQuery('medium')
}); // End analyzeButtonM listener

analyzeButtonD.addEventListener('click', () => {
    console.log("Analyze button clicked.");
    clearResults();
    showLoading(true);
    // Clear previous highlights on the page
    sendHighlightRequestToContentScript(null); // Send null to clear
    analyzeTextQuery('deep')
}); // End analyzeButtonD listener


function analyzeTextQuery(sens) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || tabs.length === 0 || !tabs[0].id) {
            showError("Could not find active tab.");
            showLoading(false); return;
        }
        const activeTabId = tabs[0].id;
        console.log("Analyzing active tab:", activeTabId);

        chrome.tabs.sendMessage(
            activeTabId, { action: "getText" }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error("Error sending message to content script:", chrome.runtime.lastError.message);
                    showError(`Could not communicate with the page. Error: ${chrome.runtime.lastError.message}`);
                    showLoading(false); return;
                }
                if (response && response.success && response.text) {
                    console.log(response.text)
                    // Send text to background for analysis
                    chrome.runtime.sendMessage(
                        { action: "analyzeText", text: response.text, sens: sens },
                        (analysisResponse) => {
                            showLoading(false); // Hide loading indicator once response received
                            if (chrome.runtime.lastError) {
                                console.error("Error receiving message from background script:", chrome.runtime.lastError.message);
                                showError(`Analysis failed. Error: ${chrome.runtime.lastError.message}`);
                                return; // Stop further processing
                            }

                            // Process successful response
                            if (analysisResponse && analysisResponse.success) {
                                // Display score bar (if score exists)
                                if (typeof analysisResponse.score !== 'undefined') {
                                    displayScoreBar(analysisResponse.score, analysisResponse.domainInfo);
                                } else {
                                    console.warn("Score missing from analysis response.");
                                    // Optionally display a message or default bar
                                    scoreTextDisplayDiv.textContent = 'Score N/A';
                                    progressBarDiv.style.width = '0%';
                                    progressBarDiv.className = 'progress-bar'; // Reset color
                                }

                                // *** Display Domain Warning ***
                                if (analysisResponse.domainInfo && typeof analysisResponse.domainInfo.reliability === 'number') {
                                    const reliability = analysisResponse.domainInfo.reliability;
                                    const domain = analysisResponse.domainInfo.name;
                                
                                    if (domainWarningDiv) {
                                        domainWarningDiv.style.marginTop = '10px';
                                        domainWarningDiv.style.padding = '8px';
                                        domainWarningDiv.style.border = '1px solid';
                                        domainWarningDiv.style.borderRadius = '4px';
                                
                                        if (reliability <= 5) {
                                            // Unreliable
                                            domainWarningDiv.textContent = `⚠️ Warning: The domain "${domain}" is frequently associated with unreliable information (Reliability: ${reliability}/10).`;
                                            domainWarningDiv.style.display = 'block';
                                            domainWarningDiv.style.color = '#e74c3c'; // red
                                            domainWarningDiv.style.borderColor = '#e74c3c';
                                            domainWarningDiv.style.backgroundColor = '#fbeae5';
                                        } else if (reliability >= 9) {
                                            // Highly reliable
                                            domainWarningDiv.textContent = `✅ Trusted Source: The domain "${domain}" has a high reliability rating (${reliability}/10).`;
                                            domainWarningDiv.style.display = 'block';
                                            domainWarningDiv.style.color = '#2e7d32'; // green
                                            domainWarningDiv.style.borderColor = '#2e7d32';
                                            domainWarningDiv.style.backgroundColor = '#e8f5e9';
                                        } else {
                                            // Medium reliability
                                            domainWarningDiv.textContent = `ℹ️ Info: The domain "${domain}" has a moderate reliability score (${reliability}/10). Interpret with care.`;
                                            domainWarningDiv.style.display = 'block';
                                            domainWarningDiv.style.color = '#f39c12'; // amber
                                            domainWarningDiv.style.borderColor = '#f39c12';
                                            domainWarningDiv.style.backgroundColor = '#fff4e5';
                                        }
                                    }
                                } else if (domainWarningDiv) {
                                    domainWarningDiv.style.display = 'none'; // No info available
                                }

                                // Store raw analysis text (hidden) - Keep this if needed for debugging or future features
                                // analysisRawTextPre.textContent = analysisResponse.analysis || "No detailed analysis available.";

                                // *** Send flags to content script for highlighting ***
                                if (analysisResponse.flags && analysisResponse.flags.length > 0) {
                                    console.log("Sending flags to content script:", analysisResponse.flags);
                                    sendHighlightRequestToContentScript(analysisResponse.flags, activeTabId, sens);
                                } else {
                                    console.log("No flags received from analysis.");
                                    // Optionally display a message in the popup
                                }
                                // save state after analysis
                                savePopupState();
                            } else {
                                // Handle analysis failure reported by background script
                                showError(analysisResponse.error || "Analysis failed. Check background logs.");
                            }
                        } // End analysisResponse callback
                    ); // End chrome.runtime.sendMessage
                } else {
                    // Handle failure to get text from content script
                    showError(response.error || "Failed to get text from page.");
                    showLoading(false);
                }
            } // End response callback
        ); // End chrome.tabs.sendMessage (getText)
    }); // End chrome.tabs.query
}

// --- Function to send highlight request to content script ---
function sendHighlightRequestToContentScript(flags, tabId, sens) {
    if (!tabId) { // If called just to clear highlights
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs.length > 0 && tabs[0].id) {
                chrome.tabs.sendMessage(tabs[0].id, { action: "highlightText", flags: flags, sens: sens });
            }
        });
    } else {
        chrome.tabs.sendMessage(tabId, { action: "highlightText", flags: flags, sens: sens});
    }
}

// --- Progress Bar Display Function ---
// *** RENAMED from displayChart and REIMPLEMENTED ***
function displayScoreBar(score, domain_info) {
    // Ensure score is a number between 0 and 100
    const numericScore = Math.max(0, Math.min(100, Number(score)));

    resultsDiv.style.display = 'flex'; // Show results container
    errorP.textContent = ''; // Clear previous errors

    // Update score text display
    scoreTextDisplayDiv.textContent = `${numericScore} / 100`;

    // Determine color class based on score
    let colorClass = 'score-red'; // Default to red
    if (numericScore >= 90) {
        colorClass = 'score-green';
    } else if (numericScore >= 70) {
        colorClass = 'score-yellow';
    }

    // Apply styles to the progress bar
    progressBarDiv.style.width = `${numericScore}%`;
    // Remove old color classes and add the new one
    progressBarDiv.classList.remove('score-red', 'score-yellow', 'score-green');
    progressBarDiv.classList.add(colorClass);

    if (!domain_info.isUnreliable && numericScore <= 50) {
        chrome.runtime.sendMessage({
            action: "logNewUnreliableDomain",
            score: numericScore,
            domain: domain_info.name
        });
    }
}


// --- Helper Functions ---
function showLoading(isLoading) {
    loadingIndicator.style.display = isLoading ? 'block' : 'none';
    analyzeButtonL.disabled = isLoading;
    analyzeButtonM.disabled = isLoading;
    analyzeButtonD.disabled = isLoading;
}

function showError(message) {
    resultsDiv.style.display = 'none'; // Hide results on error
    errorP.textContent = `Error: ${message}`;
    console.error("Error displayed to user:", message);
    showLoading(false);
}

function clearResults() {
    // Clear score text
    scoreTextDisplayDiv.textContent = '-- / 100';
    // Reset progress bar
    progressBarDiv.style.width = '0%';
    progressBarDiv.classList.remove('score-red', 'score-yellow', 'score-green');
    // progressBarDiv.textContent = ''; // Clear text inside bar if used

    // Clear raw text
    analysisRawTextPre.textContent = '';
    analysisRawTextPre.style.display = 'none';
    // Clear errors and hide results div
    errorP.textContent = '';
    resultsDiv.style.display = 'none';

    // Clear domain warning
    if (domainWarningDiv) {
        domainWarningDiv.textContent = '';
        domainWarningDiv.style.display = 'none';
    }

    // Clear previous highlights on the page
    sendHighlightRequestToContentScript(null);
}