// popup/popup.js

const analyzeButton = document.getElementById('analyzeButton');
const resultsDiv = document.getElementById('results');
const analysisRawTextPre = document.getElementById('analysisRawText');
const loadingIndicator = document.getElementById('loadingIndicator');
const errorP = document.getElementById('error');
const scoreTextDisplayDiv = document.getElementById('scoreTextDisplay');
const progressBarDiv = document.getElementById('progressBar');

// API Key Elements
const apiKeyInput = document.getElementById('apiKey');
const saveApiKeyButton = document.getElementById('saveApiKey');
const apiKeyStatus = document.getElementById('apiKeyStatus');

// --- API Key Handling --- (No changes)
document.addEventListener('DOMContentLoaded', () => { /* ... */ });
saveApiKeyButton.addEventListener('click', () => { /* ... */ });
// --- (End API Key Handling) ---


// --- Analysis Trigger ---
analyzeButton.addEventListener('click', () => {
    console.log("Analyze button clicked.");
    clearResults();
    showLoading(true);
    // Clear previous highlights on the page
    sendHighlightRequestToContentScript(null); // Send null to clear

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
                    // Send text to background for analysis
                    chrome.runtime.sendMessage(
                        { action: "analyzeText", text: response.text },
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
                                    displayScoreBar(analysisResponse.score);
                                } else {
                                     console.warn("Score missing from analysis response.");
                                     // Optionally display a message or default bar
                                     scoreTextDisplayDiv.textContent = 'Score N/A';
                                     progressBarDiv.style.width = '0%';
                                     progressBarDiv.className = 'progress-bar'; // Reset color
                                }

                                // Store raw analysis text (hidden)
                                analysisRawTextPre.textContent = analysisResponse.analysis || "No detailed analysis available."; // Keep raw analysis if needed

                                // *** Send flags to content script for highlighting ***
                                if (analysisResponse.flags && analysisResponse.flags.length > 0) {
                                    console.log("Sending flags to content script:", analysisResponse.flags);
                                    sendHighlightRequestToContentScript(analysisResponse.flags, activeTabId);
                                } else {
                                    console.log("No flags received from analysis.");
                                    // Optionally display a message in the popup
                                }

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
}); // End analyzeButton listener

// --- Function to send highlight request to content script ---
function sendHighlightRequestToContentScript(flags, tabId) {
    if (!tabId) { // If called just to clear highlights
         chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
             if (tabs && tabs.length > 0 && tabs[0].id) {
                 chrome.tabs.sendMessage(tabs[0].id, { action: "highlightText", flags: flags });
             }
         });
    } else {
         chrome.tabs.sendMessage(tabId, { action: "highlightText", flags: flags });
    }
}

// --- Progress Bar Display Function ---
// *** RENAMED from displayChart and REIMPLEMENTED ***
function displayScoreBar(score) {
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

    // Optional: Add score text inside the bar if needed
    // progressBarDiv.textContent = `${numericScore}%`;
}


// --- Helper Functions ---
function showLoading(isLoading) {
    loadingIndicator.style.display = isLoading ? 'block' : 'none';
    analyzeButton.disabled = isLoading;
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

    // Clear previous highlights on the page
    sendHighlightRequestToContentScript(null);
}

function displayScoreBar(score) {
    const numericScore = Math.max(0, Math.min(100, Number(score)));
    resultsDiv.style.display = 'flex';
    errorP.textContent = '';
    scoreTextDisplayDiv.textContent = `${numericScore} / 100`;
    let colorClass = 'score-red';
    if (numericScore >= 90) { colorClass = 'score-green'; }
    else if (numericScore >= 70) { colorClass = 'score-yellow'; }
    requestAnimationFrame(() => {
        progressBarDiv.style.width = `${numericScore}%`;
        progressBarDiv.classList.remove('score-red', 'score-yellow', 'score-green');
        progressBarDiv.classList.add(colorClass);
    });
}
function showLoading(isLoading) {
    loadingIndicator.style.display = isLoading ? 'block' : 'none';
    analyzeButton.disabled = isLoading;
}
function showError(message) {
    resultsDiv.style.display = 'none';
    errorP.textContent = `Error: ${message}`;
    console.error("Error displayed to user:", message);
    showLoading(false);
}
function clearResults() {
    sendHighlightRequestToContentScript(null); // Clear highlights
    scoreTextDisplayDiv.textContent = '-- / 100';
    progressBarDiv.style.width = '0%';
    progressBarDiv.classList.remove('score-red', 'score-yellow', 'score-green');
    analysisRawTextPre.textContent = '';
    analysisRawTextPre.style.display = 'none';
    errorP.textContent = '';
    resultsDiv.style.display = 'none';
}