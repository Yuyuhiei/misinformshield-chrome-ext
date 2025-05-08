// background/background.js

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading') {
        chrome.storage.local.remove(`popupState_${tabId}`);
    }
});

let supabase = null;

async function initSupabase() {
  const module = await import('./config/supabaseClient.js');
  supabase = module.default;
  console.log('Supabase initialized:', supabase);
}

// Call this only once (e.g. on startup)
initSupabase();

// Set of known unreliable domains (Curate this list carefully!)
// const unreliableDomains = new Set([
//     'infowars.com',
//     'breitbart.com',
//     'naturalnews.com',
//     'dailycaller.com',
//     'smninewschannel.com',
//     // Add more based on reputable sources and clear criteria
// ]);

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
    
            chrome.windows.getCurrent({ populate: true }, (window) => {
                // Query for the active tab to get its URL for domain checking
                console.log("Querying active tab...");
                chrome.tabs.query({ active: true, windowId: window.id }, (tabs) => {
                    console.log("Tabs found:", tabs);
                    if (chrome.runtime.lastError || !tabs || tabs.length === 0 || !tabs[0].url) {
                        console.error("Error querying active tab or tab URL missing:", chrome.runtime.lastError?.message);
                        // Proceed without domain check if tab query fails
                        performAnalysis(request.text, apiKey, null, false, request.sens, sendResponse);
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
                        } else {
                            console.log(`Skipping domain check for non-http(s) URL: ${activeTabUrl}`);
                        }
                    } catch (e) {
                        console.error("Could not parse active tab URL:", activeTabUrl, e);
                    }
                    // fetch the table unreliableDomain from supabase
                    supabase
                        .from('unreliable_domain')
                        .select('domain_url, reliability')
                        .then(({ data, error }) => {
                            if (error) {
                                console.error("Error fetching unreliable domains from Supabase:", error);
                                // Proceed with analysis even if the domain check fails
                                performAnalysis(request.text, apiKey, domain, false, request.sens, sendResponse);
                                return;
                            }
                            console.log("Unreliable domains fetched from Supabase:", data);
                            console.log("Domain to check:", domain);
                            
                            // Find matching domain entry
                            const matchedEntry = data.find(item => item.domain_url === domain);

                            if (matchedEntry) {
                                console.log(`Domain found in unreliable list: ${domain}`);
                                performAnalysis(request.text, apiKey, domain, true, request.sens, sendResponse, matchedEntry.reliability);
                            } else {
                                performAnalysis(request.text, apiKey, domain, false, request.sens, sendResponse);
                            }

                        })
                        .catch((error) => {
                            console.error("Error querying Supabase:", error);
                            // Proceed with analysis even if there’s an issue fetching the domains
                           performAnalysis(request.text, apiKey, domain, isUnreliable, request.sens, sendResponse);
                        });
                }); // End chrome.tabs.query
            });
            
        }); // End chrome.storage.local.get
        return true; // Keep the channel open for async response from tabs.query and fetch
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

            verifySnippetWithSources(request.snippet, request.reason, apiKey, request.sens)
                .then(verificationData => {
                    console.log("[Background] Verification successful. Sending result to tab:", senderTabId, verificationData);
                    // Send the result specifically to the content script tab
                    chrome.tabs.sendMessage(senderTabId, {
                        action: "verificationResult",
                        success: true,
                        sens: request.sens,
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
                        sens: request.sens,
                        error: error.message || "Failed to fetch or process verification from Gemini"
                    });
                    // Send a simple failure response back to the original caller (handleIconClick)
                    sendResponse({ success: false, error: error.message || "Verification process failed." });
                });
        });
        return true; // Keep channel open for async response
    }
    else if (request.action === "logNewUnreliableDomain") {
        handleLogUnreliableDomain(request).then(() => {
            sendResponse({ success: true });
        }).catch((error) => {
            console.error("Error logging unreliable domain:", error);
            sendResponse({ success: false, error: error.message });
        });

        // IMPORTANT: keep this true to allow async sendResponse
        return true;
    }
}); // End chrome.runtime.onMessage.addListener


// Helper function to contain the analysis logic after getting domain info
function performAnalysis(textToAnalyze, apiKey, domain, isUnreliable, sens, sendResponse, reliability = null) {
    callGeminiAPIForHighlighting(textToAnalyze, apiKey, sens)
        .then(analysisData => {
            console.log("Gemini API Processed Response for Highlighting:", analysisData);

            // *** Modify response based on domain check ***
            let finalScore = analysisData.score ?? 100;
            let flags = analysisData.flags || [];

            if (typeof reliability === 'number') {
                if (reliability <= 5) {
                    // Unreliable source — cap based on reliability
                    const cap = 10 * reliability; // e.g., 3 → cap at 30
                    finalScore = Math.min(finalScore, cap);

                    flags.unshift({
                        snippet: `Website Domain (${domain})`,
                        reason: `This domain is marked unreliable with a reliability score of ${reliability}/10. Lower reliability reduces the maximum trust score.`
                    });
                } else if (reliability === 10) {
                    // Trusted source — floor at 75
                    finalScore = Math.max(finalScore, 85);
                } else {
                    // Medium reliability — cap between 75 and 90
                    const cap = 60 + (reliability * 3); // e.g., 6 → 78, 9 → 87
                    finalScore = Math.min(finalScore, cap);
                }
            }

            // *** Send score, flags, AND domain status ***
            sendResponse({
                success: true,
                score: finalScore, // Send potentially modified score
                flags: flags,      // Send potentially modified flags
                domainInfo: {      // Add domain info to the response
                    name: domain,
                    isUnreliable: isUnreliable,
                    reliability: reliability
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
async function callGeminiAPIForHighlighting(textToAnalyze, apiKey, sens) {
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

    // --- Prompt Engineering for Highlighting ---
    // ** CRITICAL STEP **
    // Ask for a score AND specific snippets with reasons in JSON format.
    // This prompt attempts to get structured output. It might need refinement.
    const promptLight = `You are a fact-checking assistant. Your task is to analyze the following text and identify statements that may qualify as **fake news** or **claims lacking evidence**.

Ignore any signs of bias, emotional tone, or persuasive language **unless** they are directly linked to a factually incorrect or unsubstantiated claim.

Return your analysis in **valid JSON format** with two keys: "score" and "flags".
1. 	"score": A numerical credibility score between 0 (very low credibility) and 100 (very high credibility).
2. 	"flags": An array of objects. Each object should represent a specific problematic text snippet and have two keys:
    - "snippet": The exact text snippet (maximum 2 sentences) of the problematic claim.
    - "reason": A short explanation (1 sentence) explaining why this claim appears false or unsupported (e.g., "Claim is widely debunked", "No supporting evidence provided").

Example JSON output format:
\`\`\`json
{
    "score": 42,
    "flags": [
        {
            "snippet": "The COVID-19 vaccine implants microchips into people.",
            "reason": "This claim has been widely debunked by multiple health organizations."
        },
        {
            "snippet": "Experts say the earth might be flat after all.",
            "reason": "Scientific consensus strongly supports a spherical Earth; this claim lacks evidence."
        }
    ]
}
\`\`\`

If no fake or unsupported claims are found, return an empty "flags" array.

Text to analyze:
---
${textToAnalyze}
---

JSON Analysis:`;

const promptMedium = `You are an AI assistant tasked with evaluating a text for potential misinformation and signs of bias or manipulation. 

Your analysis should identify:
1. **Fake or unsubstantiated claims** (e.g., statements presented as facts without evidence).
2. **Biased or emotionally manipulative language** (e.g., overly strong wording, logical fallacies, emotionally charged phrases, or broad generalizations that influence opinion rather than inform).

Return the results in **valid JSON format** with two keys:
1. "score": A number from 0 (very unreliable/manipulative) to 100 (very reliable and neutral), based on the overall credibility and tone of the text.
2. "flags": An array of flagged text snippets. Each item should include:
   - "snippet": A short excerpt (max 2 sentences) of the problematic text.
   - "reason": A short explanation of why it was flagged (e.g., "Lacks supporting evidence", "Uses emotionally charged language", "Presents opinion as fact").

Example JSON output:
\`\`\`json
{
    "score": 58,
    "flags": [
    {
        "snippet": "This disastrous policy will destroy the economy overnight!",
        "reason": "Uses emotionally charged and alarmist language without supporting evidence."
    },
    {
        "snippet": "Everyone agrees this is the only solution.",
        "reason": "Makes a broad generalization likely untrue and manipulative."
    },
    {
        "snippet": "Studies show vaccines cause autism.",
        "reason": "This claim has been widely debunked and lacks credible evidence."
    }
    ]
}
\`\`\`

If no issues are found, return an empty "flags" array.

Text to analyze:
---
${textToAnalyze}
---

JSON Analysis:`;
    // --- End Prompt Engineering ---

    let prompt = "";

    if (sens == 'light') {
        prompt = promptLight;
    } else {
        prompt = promptMedium;
    } 

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
async function verifySnippetWithSources(snippet, reason, apiKey, sens) {
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

    // --- Prompt Engineering based on sensitivity ---
    let prompt = "";
    if (sens === "deep") {
        console.log("sens is deep", sens);
        prompt = `A piece of text was flagged with the following snippet and reason:
Snippet: "${snippet}"
Reason: "${reason}"

Please perform the following tasks based *only* on the provided snippet and reason:
1.  **Explain:** Briefly elaborate (2-3 sentences) on *why* the snippet might be considered problematic given the reason. Focus on explaining the reasoning itself.
2.  **Find Sources:** Search the web for 3 highly credible and relevant sources (e.g., reputable news organizations, academic institutions, established fact-checking sites) that provide context or evidence related to the explanation. Avoid opinion blogs or unreliable sources.

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

If you cannot find 3 credible sources, provide as many as you can and leave the rest as empty strings (""). If you can't provide any, return empty values.
JSON Verification:`;
    } else {
        console.log(sens);
        // Light or Medium scan
        prompt = `A piece of text was flagged with the following snippet and reason:
Snippet: "${snippet}"
Reason: "${reason}"

Please explain in 2-3 sentences why this snippet might be considered problematic based on the reason provided. Focus on a clear, unbiased explanation. Do not search the web or include any sources.

Return the response in the following JSON format:
\`\`\`json
{
    "summary": "Your explanation here.",
    "sources": []
}
\`\`\`

If no meaningful explanation can be provided, return an empty summary and an empty array for sources. Ensure valid JSON output.

JSON Verification:`;
    }
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

                return {
                    summary,
                    sources
                };

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

async function handleLogUnreliableDomain(request) {
    const domain = request.domain;
    const score = request.score;

    const { data, error } = await supabase
        .from('scores')
        .select('increment, score_average')
        .eq('domain_url', domain)
        .single();

    if (error && error.code !== 'PGRST116') {
        throw error;
    }

    if (!data) {
        await supabase.from('scores').insert({
            domain_url: domain,
            increment: 1,
            score_average: score
        });
    } else {
        const { increment, score_average } = data;

        if (increment >= 10) {
            const reliability = Math.max(1, Math.ceil(score_average / 20));

            await supabase
                .from('unreliable_domain')
                .upsert({ domain_url: domain, reliability });

            return;
        }

        const newIncrement = increment + 1;
        const newAverage = ((score_average * increment) + score) / newIncrement;

        await supabase
            .from('scores')
            .update({
                increment: newIncrement,
                score_average: newAverage
            })
            .eq('domain_url', domain);
    }
}
