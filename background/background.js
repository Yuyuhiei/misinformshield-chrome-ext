// background/background.js

// --- Window Management (Keep if you reverted, remove if you kept the window popup) ---
let popupWindowId = null;
// ... (rest of window management code if applicable) ...

// Set of known unreliable domains (Curate this list carefully!)
const unreliableDomains = new Set([
    'infowars.com',
    'breitbart.com',
    'naturalnews.com',
    'dailycaller.com',
    'smninewschannel.com',
    // Add more based on reputable sources and clear criteria
]);

// Listener for messages from popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Background script received message:", request);

    if (request.action === "analyzeText") {
        chrome.storage.local.get(['geminiApiKey'], (result) => {
            const apiKey = result.geminiApiKey;
            if (!apiKey) {
                console.error("Gemini API Key not found in storage.");
                sendResponse({ success: false, error: "API Key not set. Please set it in the popup." });
                return true; // Exit early if no API key
            }

            // Query for the active tab to get its URL for domain checking
            // This is necessary because messages from the popup don't have sender.tab.url
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (chrome.runtime.lastError || !tabs || tabs.length === 0 || !tabs[0].url) {
                    console.error("Error querying active tab or tab URL missing:", chrome.runtime.lastError?.message);
                    // Proceed without domain check if tab query fails
                    performAnalysis(request.text, apiKey, null, false, sendResponse);
                    return;
                }

                const activeTabUrl = tabs[0].url;
                let domain = null;
                let isUnreliable = false;

                try {
                    const url = new URL(activeTabUrl);
                    // Ensure it's an http/https URL before checking domain
                    if (url.protocol === "http:" || url.protocol === "https:") {
                        domain = url.hostname.replace(/^www\./, ''); // Remove 'www.'
                        if (unreliableDomains.has(domain)) {
                            isUnreliable = true;
                            console.log(`Domain found in unreliable list: ${domain}`);
                        }
                    } else {
                        console.log(`Skipping domain check for non-http(s) URL: ${activeTabUrl}`);
                    }
                } catch (e) {
                    console.error("Could not parse active tab URL:", activeTabUrl, e);
                }

                // Perform the analysis *after* getting the domain info
                // Pass the determined domain and isUnreliable status to performAnalysis
                performAnalysis(request.text, apiKey, domain, isUnreliable, sendResponse);
            }); // End chrome.tabs.query

        }); // End chrome.storage.local.get
        return true; // Keep channel open for async response from tabs.query and fetch
    }
    // *** Listener case for snippet verification *** (Keep this as it was before the last correction attempt)
    else if (request.action === "verifySnippet") {
        chrome.storage.local.get(['geminiApiKey'], (result) => {
            const apiKey = result.geminiApiKey;
            if (!apiKey) {
                console.error("Gemini API Key not found for verification.");
                sendResponse({ success: false, error: "API Key not set." });
                return true;
            }

            console.log(`[Background] Received verifySnippet for: "${request.snippet.substring(0, 50)}..."`);
            // Get the tab ID from the sender
            const senderTabId = sender.tab?.id;
            if (!senderTabId) {
                console.error("[Background] Could not get sender tab ID for verification result.");
                sendResponse({ success: false, error: "Internal error: Missing sender tab ID." });
                return true; // Still need to return true for async potential
            }

            verifySnippetWithSources(request.snippet, request.reason, apiKey)
                .then(verificationData => {
                    console.log("[Background] Verification successful. Sending result to tab:", senderTabId, verificationData);
                    // Send the result specifically to the content script tab
                    chrome.tabs.sendMessage(senderTabId, {
                        action: "verificationResult",
                        success: true,
                        ...verificationData
                    });
                    // Send a simple success response back to the original caller (handleIconClick)
                    sendResponse({ success: true });
                })
                .catch(error => {
                    console.error("[Background] Verification failed. Sending error result to tab:", senderTabId, error);
                    // Send the error specifically to the content script tab
                    chrome.tabs.sendMessage(senderTabId, {
                        action: "verificationResult",
                        success: false,
                        error: error.message || "Failed to fetch or process verification from Gemini"
                    });
                    // Send a simple failure response back to the original caller (handleIconClick)
                    sendResponse({ success: false, error: error.message || "Verification process failed." });
                });
        });
        return true; // Keep channel open for async response
    }
}); // End chrome.runtime.onMessage.addListener


// Helper function to contain the analysis logic after getting domain info
function performAnalysis(textToAnalyze, apiKey, domain, isUnreliable, sendResponse) {
    callGeminiAPIForHighlighting(textToAnalyze, apiKey)
        .then(analysisData => {
            console.log("Gemini API Processed Response for Highlighting:", analysisData);

            // *** Modify response based on domain check ***
            let finalScore = analysisData.score;
            let flags = analysisData.flags || [];

            if (isUnreliable) {
                // Option 1: Drastically reduce score (Example: cap at 15)
                // This is a policy decision - adjust as needed.
                finalScore = Math.min(finalScore ?? 100, 15); // Use ?? 100 to handle undefined score

                // Option 2: Add a specific flag (Example: add to beginning)
                flags.unshift({
                    snippet: `Website Domain (${domain})`,
                    reason: "This domain is on a list of sources frequently associated with unreliable information."
                });
            }

            // *** Send score, flags, AND domain status ***
            sendResponse({
                success: true,
                score: finalScore, // Send potentially modified score
                flags: flags,      // Send potentially modified flags
                domainInfo: {      // Add domain info to the response
                    name: domain,
                    isUnreliable: isUnreliable
                }
            });
        })
        .catch(error => {
            console.error("Error calling/processing Gemini API for highlighting:", error);
            sendResponse({ success: false, error: error.message || "Failed to fetch or process analysis from Gemini" });
        });
} // End performAnalysis function


console.log("Background script loaded (v5 - Verification Added).");


// *** Function for initial text analysis and highlighting flags ***
async function callGeminiAPIForHighlighting(textToAnalyze, apiKey) {
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

    // --- Prompt Engineering for Highlighting ---
    // ** CRITICAL STEP **
    // Ask for a score AND specific snippets with reasons in JSON format.
    // This prompt attempts to get structured output. It might need refinement.
    const prompt = `Analyze the following text for potential signs of misinformation, bias, or manipulative language.

Provide your analysis in JSON format with two main keys: "score" and "flags".
1. 	"score": A numerical credibility score between 0 (very low credibility) and 100 (very high credibility).
2. 	"flags": An array of objects. Each object should represent a specific problematic text snippet and have two keys:
    - "snippet": The exact text snippet (maximum 2 sentences) that contains potential issues.
    - "reason": A brief explanation (1 sentence) of why this snippet is flagged (e.g., "Uses emotionally charged language", "Lacks supporting evidence", "Potential logical fallacy").

Example JSON output format:
\`\`\`json
{
    "score": 45,
    "flags": [
        {
            "snippet": "This outrageous policy will bankrupt the nation overnight!",
            "reason": "Uses highly sensational and exaggerated language without evidence."
        },
        {
            "snippet": "Everyone agrees that this is the only solution.",
            "reason": "Makes a broad generalization ('Everyone agrees') that is likely untrue."
        }
    ]
}
\`\`\`

If no specific issues are found, return an empty "flags" array. Ensure the entire output is valid JSON.

Text to analyze:
---
${textToAnalyze}
---

JSON Analysis:`;
    // --- End Prompt Engineering ---

    console.log("Sending text to Gemini API for highlighting analysis...");

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                "contents": [{ "parts": [{ "text": prompt }] }],
                // *** IMPORTANT: Tell Gemini to output JSON ***
                "generationConfig": {
                    "response_mime_type": "application/json", // Request JSON output
                    "temperature": 0.3, // Lower temperature for more predictable JSON
                    "maxOutputTokens": 800 // May need more tokens for JSON + analysis
                }
            })
        });

        if (!response.ok) {
             // Handle non-JSON error responses if necessary
            let errorBodyText = await response.text();
            console.error("API Error Response Text:", errorBodyText);
             let errorJson = {};
             try { errorJson = JSON.parse(errorBodyText); } catch(e) { /* ignore parsing error */ }
             const errorMessage = errorJson?.error?.message || errorBodyText || `API request failed with status ${response.status}`;
             throw new Error(errorMessage);
        }

        const data = await response.json(); // Response should already be JSON
        console.log("Raw Gemini JSON Response Data:", data);

        // Gemini API structure for JSON might be slightly different, often directly in candidates
        if (data.candidates && data.candidates.length > 0 &&
            data.candidates[0].content && data.candidates[0].content.parts &&
            data.candidates[0].content.parts.length > 0)
        {
             // Sometimes Gemini wraps JSON in ```json ... ```, try to extract it
             let jsonString = data.candidates[0].content.parts[0].text;
             const jsonMatch = jsonString.match(/```json\s*([\s\S]*?)\s*```/);
             if (jsonMatch && jsonMatch[1]) {
                 jsonString = jsonMatch[1];
             }

             try {
                 const analysisData = JSON.parse(jsonString);
                 console.log("Successfully parsed analysis JSON from Gemini.");

                 // Validate the structure
                 const score = (analysisData && typeof analysisData.score === 'number')
                     ? Math.max(0, Math.min(100, analysisData.score))
                     : 50; // Default score if missing/invalid
                 const flags = (analysisData && Array.isArray(analysisData.flags))
                     ? analysisData.flags.filter(f => f && typeof f.snippet === 'string' && typeof f.reason === 'string') // Basic validation
                     : []; // Default to empty array

                 console.log("Extracted Score:", score);
                 console.log("Extracted Flags:", flags);

                 return { score, flags }; // Return the parsed object

             } catch (parseError) {
                 console.error("Failed to parse JSON response from Gemini:", parseError);
                 console.error("Received text:", jsonString); // Log what was received
                 throw new Error("Failed to parse analysis JSON from API response.");
             }

        } else if (data.promptFeedback && data.promptFeedback.blockReason) {
            // Handle blocked prompts
            console.error("Prompt blocked by Gemini:", data.promptFeedback.blockReason);
            throw new Error(`Request blocked by API due to safety settings: ${data.promptFeedback.blockReason}.`);
        } else {
            // Handle unexpected response format
            console.error("Unexpected API response format:", data);
            throw new Error("Unexpected response format from Gemini API.");
        }

    } catch (error) {
        console.error("Fetch or processing error:", error);
        throw error; // Re-throw the error
    }
}


// *** NEW: Function to verify a snippet and get sources ***
async function verifySnippetWithSources(snippet, reason, apiKey) {
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

    // --- Prompt Engineering for Verification ---
    // Ask for explanation and credible sources in JSON format.
    const prompt = `A piece of text was flagged with the following snippet and reason:
Snippet: "${snippet}"
Reason: "${reason}"

Please perform the following tasks based *only* on the provided snippet and reason:
1. 	**Explain:** Briefly elaborate (2-3 sentences) on *why* the snippet might be considered problematic given the reason. Focus on explaining the reasoning itself.
2. 	**Find Sources:** Search the web for 3 highly credible and relevant sources (e.g., reputable news organizations, academic institutions, established fact-checking sites) that provide context or evidence related to the explanation. Avoid opinion blogs or unreliable sources.

Provide your response strictly in the following JSON format:
\`\`\`json
{
    "summary": "Your 2-3 sentence explanation here.",
    "sources": [
        "URL of source 1",
        "URL of source 2",
        "URL of source 3"
    ]
}
\`\`\`

If you cannot find 3 credible sources, provide as many as you can find (minimum 1 if possible) and leave the remaining entries as empty strings (""). If you cannot provide a meaningful explanation or find any sources, return an empty summary and an empty sources array. Ensure the entire output is valid JSON.

JSON Verification:`;
    // --- End Prompt Engineering ---

    console.log(`Sending snippet to Gemini API for verification: "${snippet.substring(0, 50)}..."`);

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                "contents": [{ "parts": [{ "text": prompt }] }],
                "generationConfig": {
                    "response_mime_type": "application/json", // Request JSON output
                    "temperature": 0.4, // Slightly higher temp for more nuanced explanation
                    "maxOutputTokens": 500 // Adjust as needed
                },
                // Enable web search tool if available/needed for the model version
                // "tools": [{ "google_search_retrieval": {} }] // Uncomment if using a model version that supports this tool explicitly
            })
        });

        if (!response.ok) {
            let errorBodyText = await response.text();
            console.error("API Verification Error Response Text:", errorBodyText);
            let errorJson = {};
            try { errorJson = JSON.parse(errorBodyText); } catch(e) { /* ignore */ }
            const errorMessage = errorJson?.error?.message || errorBodyText || `API verification request failed with status ${response.status}`;
            throw new Error(errorMessage);
        }

        const data = await response.json();
        console.log("Raw Gemini Verification JSON Response Data:", data);

        if (data.candidates && data.candidates.length > 0 &&
            data.candidates[0].content && data.candidates[0].content.parts &&
            data.candidates[0].content.parts.length > 0)
        {
            let jsonString = data.candidates[0].content.parts[0].text;
            const jsonMatch = jsonString.match(/```json\s*([\s\S]*?)\s*```/);
            if (jsonMatch && jsonMatch[1]) {
                jsonString = jsonMatch[1];
            }

            try {
                const verificationData = JSON.parse(jsonString);
                console.log("Successfully parsed verification JSON from Gemini.");

                // Basic validation
                const summary = (verificationData && typeof verificationData.summary === 'string')
                    ? verificationData.summary.trim()
                    : "Could not generate explanation.";
                const sources = (verificationData && Array.isArray(verificationData.sources))
                    ? verificationData.sources.filter(s => typeof s === 'string' && s.trim().startsWith('http')) // Ensure they are strings and look like URLs
                    : [];

                console.log("Extracted Summary:", summary);
                console.log("Extracted Sources:", sources);

                return { summary, sources };

            } catch (parseError) {
                console.error("Failed to parse verification JSON response from Gemini:", parseError);
                console.error("Received text:", jsonString);
                throw new Error("Failed to parse verification JSON from API response.");
            }

        } else if (data.promptFeedback && data.promptFeedback.blockReason) {
            console.error("Verification prompt blocked by Gemini:", data.promptFeedback.blockReason);
            throw new Error(`Verification request blocked by API: ${data.promptFeedback.blockReason}.`);
        } else {
            console.error("Unexpected API verification response format:", data);
            throw new Error("Unexpected response format from Gemini API during verification.");
        }

    } catch (error) {
        console.error("Verification fetch or processing error:", error);
        throw error; // Re-throw
    }
}
