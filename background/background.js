// background/background.js

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Clear popup state when a tab starts loading a new page or is reloaded
    if (changeInfo.status === 'loading') {
        console.log(`Tab ${tabId} is loading, clearing its popup state.`);
        chrome.storage.local.remove(`popupState_${tabId}`);
    }
});

let supabase = null;

async function initSupabase() {
  try {
    // Ensure the path to supabaseClient.js is correct relative to dist/background.js
    // If supabaseClient.js is in dist/config/supabaseClient.js, then './config/supabaseClient.js' is correct.
    const module = await import('./config/supabaseClient.js');
    supabase = module.default;
    if (supabase) {
        console.log('Supabase initialized successfully.');
    } else {
        console.error('Supabase client was not properly initialized from supabaseClient.js. Check for errors there.');
    }
  } catch (error) {
    console.error('Failed to initialize Supabase:', error);
    supabase = null; // Ensure supabase is null if initialization fails
  }
}

// Call this only once (e.g. on startup)
initSupabase();


// Listener for messages from popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Background script received message:", request);

    if (request.action === "analyzeText") {
        chrome.storage.local.get(['geminiApiKey'], (result) => {
            const apiKey = result.geminiApiKey;
            if (!apiKey) {
                console.error("Gemini API Key not found in storage.");
                sendResponse({ success: false, error: "API Key not set. Please set it in the popup." });
                return; // No need for 'return true' here as sendResponse is synchronous
            }
            
            // Check if Supabase is ready before proceeding with operations that need it
            if (!supabase) {
                console.error("Supabase client not initialized. Cannot perform domain check for analyzeText.");
                // Decide if you want to proceed without domain check or send an error
                // Option 1: Proceed without domain check
                // performAnalysis(request.text, apiKey, null, false, request.sens, sendResponse);
                // Option 2: Send an error
                sendResponse({ success: false, error: "Database connection not ready. Please try again shortly." });
                return; // No need for 'return true' here
            }
    
            chrome.windows.getCurrent({ populate: true }, (window) => {
                if (chrome.runtime.lastError) {
                    console.error("Error getting current window:", chrome.runtime.lastError.message);
                    performAnalysis(request.text, apiKey, null, false, request.sens, sendResponse); // Proceed without domain check
                    return;
                }
                chrome.tabs.query({ active: true, windowId: window.id }, (tabs) => {
                    if (chrome.runtime.lastError || !tabs || tabs.length === 0 || !tabs[0].url) {
                        console.error("Error querying active tab or tab URL missing:", chrome.runtime.lastError?.message);
                        performAnalysis(request.text, apiKey, null, false, request.sens, sendResponse); // Proceed without domain check
                        return;
                    }
        
                    const activeTabUrl = tabs[0].url;
                    let domain = null;
        
                    try {
                        const url = new URL(activeTabUrl);
                        if (url.protocol === "http:" || url.protocol === "https:") {
                            domain = url.hostname.replace(/^www\./, '');
                        } else {
                            console.log(`Skipping domain check for non-http(s) URL: ${activeTabUrl}`);
                        }
                    } catch (e) {
                        console.error("Could not parse active tab URL:", activeTabUrl, e);
                    }
                    
                    // Fetch unreliable domains from Supabase
                    supabase
                        .from('unreliable_domain')
                        .select('domain_url, reliability')
                        .then(({ data, error }) => {
                            if (error) {
                                console.error("Error fetching unreliable domains from Supabase:", error);
                                performAnalysis(request.text, apiKey, domain, false, request.sens, sendResponse); // Proceed but indicate domain check failed
                                return;
                            }
                            console.log("Unreliable domains fetched from Supabase:", data);
                            const matchedEntry = data.find(item => item.domain_url === domain);

                            if (matchedEntry) {
                                console.log(`Domain found in unreliable list: ${domain}`);
                                performAnalysis(request.text, apiKey, domain, true, request.sens, sendResponse, matchedEntry.reliability);
                            } else {
                                performAnalysis(request.text, apiKey, domain, false, request.sens, sendResponse);
                            }
                        })
                        .catch((dbError) => {
                            console.error("Error querying Supabase for unreliable domains:", dbError);
                            performAnalysis(request.text, apiKey, domain, false, request.sens, sendResponse); // Proceed, domain check failed
                        });
                }); 
            });
        });
        return true; // Crucial: Keep the channel open for async response
    }
    else if (request.action === "verifySnippet") {
        chrome.storage.local.get(['geminiApiKey'], (result) => {
            const apiKey = result.geminiApiKey;
            if (!apiKey) {
                console.error("Gemini API Key not found for verification.");
                sendResponse({ success: false, error: "API Key not set." });
                return; // Synchronous response
            }

            console.log(`[Background] Received verifySnippet for: "${request.snippet.substring(0, 50)}..."`);
            const senderTabId = sender.tab?.id;
            if (!senderTabId) {
                console.error("[Background] Could not get sender tab ID for verification result.");
                sendResponse({ success: false, error: "Internal error: Missing sender tab ID." });
                return; // Synchronous response
            }

            verifySnippetWithSources(request.snippet, request.reason, apiKey, request.sens)
                .then(verificationData => {
                    console.log("[Background] Verification successful. Sending result to tab:", senderTabId, verificationData);
                    chrome.tabs.sendMessage(senderTabId, {
                        action: "verificationResult",
                        success: true,
                        sens: request.sens,
                        ...verificationData
                    }, () => { // Add callback for sendMessage to content script
                        if (chrome.runtime.lastError) {
                            console.error("Error sending verificationResult to content script:", chrome.runtime.lastError.message);
                        }
                    });
                    sendResponse({ success: true }); // Respond to original popup message
                })
                .catch(error => {
                    console.error("[Background] Verification failed. Sending error result to tab:", senderTabId, error);
                    chrome.tabs.sendMessage(senderTabId, {
                        action: "verificationResult",
                        success: false,
                        sens: request.sens,
                        error: error.message || "Failed to fetch or process verification from Gemini"
                    }, () => { // Add callback
                        if (chrome.runtime.lastError) {
                            console.error("Error sending error verificationResult to content script:", chrome.runtime.lastError.message);
                        }
                    });
                    sendResponse({ success: false, error: error.message || "Verification process failed." }); // Respond to original popup message
                });
        });
        return true; // Crucial: Keep channel open
    }
    else if (request.action === "logNewUnreliableDomain") {
        if (!supabase) {
            console.error("Supabase client not initialized. Cannot log unreliable domain.");
            sendResponse({ success: false, error: "Database connection not ready." });
            return false; // Synchronous response as we are not proceeding
        }
        handleLogUnreliableDomain(request).then(() => {
            sendResponse({ success: true });
        }).catch((error) => {
            console.error("Error logging unreliable domain:", error);
            sendResponse({ success: false, error: error.message });
        });
        return true; // Crucial: Keep channel open
    }
    else if (request.action === "getUnreliableDomains") {
        if (!supabase) { 
            console.error("Supabase client not initialized in background script.");
            sendResponse({ success: false, error: "Database connection not ready." });
            return false; 
        }
        
        console.log("Background: Received request to get unreliable domains.");
        (async () => {
            try {
                const { data, error } = await supabase
                    .from('unreliable_domain') 
                    .select('domain_id, domain_url, reliability, reason')
                    .order('domain_url', { ascending: true });

                if (error) {
                    console.error("Error fetching unreliable domains from Supabase:", error);
                    sendResponse({ success: false, error: error.message || "Failed to fetch domains from database." });
                } else {
                    console.log("Background: Successfully fetched unreliable domains:", data);
                    sendResponse({ success: true, data: data });
                }
            } catch (e) {
                console.error("Exception while fetching unreliable domains:", e);
                sendResponse({ success: false, error: e.message || "An unexpected error occurred while fetching domains." });
            }
        })();
        return true; // Crucial: Keep channel open
    }
    // Add a default case or return false if no action matches and no async response is pending
    // else {
    //     console.warn("Unknown action received in background script:", request.action);
    //     return false; // No response will be sent
    // }
});


// Helper function to contain the analysis logic
function performAnalysis(textToAnalyze, apiKey, domain, isMarkedUnreliable, sens, sendResponse, reliabilityScore = null) {
    callGeminiAPIForHighlighting(textToAnalyze, apiKey, sens)
        .then(analysisData => {
            console.log("Gemini API Processed Response for Highlighting:", analysisData);

            let finalScore = analysisData.score ?? 100; // Default to 100 if score is null/undefined
            let flags = analysisData.flags || [];

            // Adjust score based on domain reliability if a score was provided
            if (typeof reliabilityScore === 'number') {
                if (reliabilityScore <= 5) {
                    const cap = 10 * reliabilityScore; 
                    finalScore = Math.min(finalScore, cap);
                    // Add a flag indicating the domain's low reliability impacted the score
                    flags.unshift({
                        snippet: `Website Domain (${domain || 'Current Page'})`,
                        reason: `This domain is listed with a low reliability score of ${reliabilityScore}/10, which has capped the overall credibility assessment.`
                    });
                } else if (reliabilityScore === 10) { // Mark for very high reliability
                    finalScore = Math.max(finalScore, 85); // Ensure score is at least 85 for trusted sources
                } else { // For medium reliability (6-9)
                    const cap = 60 + (reliabilityScore * 3); // e.g. 6 -> 78, 9 -> 87
                    finalScore = Math.min(finalScore, cap);
                }
            } else if (domain && isMarkedUnreliable && reliabilityScore === null) {
                // This case might occur if the domain was found in 'unreliable_domain' but reliability score wasn't passed correctly.
                // For safety, treat as low reliability if marked unreliable but no score.
                finalScore = Math.min(finalScore, 40); // Example cap
                 flags.unshift({
                        snippet: `Website Domain (${domain || 'Current Page'})`,
                        reason: `This domain is listed as potentially unreliable. This has impacted the credibility assessment.`
                    });
            }

            sendResponse({
                success: true,
                score: finalScore,
                flags: flags,
                domainInfo: {
                    name: domain,
                    isUnreliable: isMarkedUnreliable, // This might be true even if reliabilityScore is from a different table
                    reliability: reliabilityScore // This is the specific score from 'unreliable_domain'
                }
            });
        })
        .catch(error => {
            console.error("Error calling/processing Gemini API for highlighting:", error);
            sendResponse({ success: false, error: error.message || "Failed to fetch or process analysis from Gemini" });
        });
}


// --- Gemini API Call for Highlighting ---
async function callGeminiAPIForHighlighting(textToAnalyze, apiKey, sens) {
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

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

Return only a compact JSON object like this:

{"score": 35, "flags":[{"snippet":"...", "reason":"..."}, ...]}

Do NOT wrap it in markdown or add extra text. Avoid line breaks if needed. Response must be valid JSON within token limits.

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

Return only a compact JSON object like this:

{"score": 35, "flags":[{"snippet":"...", "reason":"..."}, ...]}

Do NOT wrap it in markdown or add extra text. Avoid line breaks if needed. Response must be valid JSON within token limits.

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
                const analysisData = tryRepairJson(jsonString);
                console.log("Successfully parsed or repaired analysis JSON.");
            
                const score = analysisData.score;
                const flags = analysisData.flags;
            
                console.log("Extracted Score:", score);
                console.log("Extracted Flags:", flags);
                return { score, flags };
            
            } catch (parseError) {
                console.error("Failed to parse or repair JSON:", parseError);
                throw new Error("Invalid JSON from Gemini API and repair failed.");
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

function tryRepairJson(jsonString) {
    // Step 1: Try parsing raw JSON first
    try {
        return JSON.parse(jsonString);
    } catch (_) {
        // Step 2: Fallback to repair
        console.warn("Initial JSON parsing failed. Attempting repair...");

        // Try to extract everything before the last complete object
        const flagsStart = jsonString.indexOf('"flags": [');
        if (flagsStart === -1) throw new Error("Missing 'flags' array in JSON.");

        const flagsPart = jsonString.slice(flagsStart + 9); // Skip past `"flags": [`
        const splitFlags = flagsPart.split('{').slice(1); // Split into flag entries (omit first empty part)

        const repairedFlags = [];
        for (const part of splitFlags) {
            const maybeObject = `{${part}`;
            try {
                const fixed = maybeObject.replace(/,\s*}$/, '}'); // Remove trailing comma if any
                repairedFlags.push(JSON.parse(fixed));
            } catch {
                break; // Stop at first incomplete/corrupt object
            }
        }

        const scoreMatch = jsonString.match(/"score"\s*:\s*(\d+)/);
        const score = scoreMatch ? Math.max(0, Math.min(100, parseInt(scoreMatch[1], 10))) : 50;

        return {
            score,
            flags: repairedFlags
        };
    }
}

// --- Gemini API Call for Snippet Verification ---
async function verifySnippetWithSources(snippet, reason, apiKey, sens) {
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const SERPAPI_URL = 'https://serpapi.com/search.json';

    // --- Prompt Engineering based on sensitivity ---
    let prompt = "";
    if (sens === "deep") {
        console.log("sens is deep", sens);
        prompt = `A piece of text was flagged with the following snippet and reason:
Snippet: "${snippet}"
Reason: "${reason}"

Please do the following:
1. Briefly elaborate (2-3 sentences) on *why* the snippet might be considered problematic, focusing on how it could be misleading, unsubstantiated, or concerning given the reason.
2. Create a concise search query (under 20 words) that could help find supporting or contradicting *credible sources* (e.g., news articles, official reports) for the claims or ideas in the snippet.

Respond strictly in this JSON format:
\`\`\`json
{
  "summary": "Your 2-3 sentence explanation here."
  "search_query": "A focused Google search query for finding credible sources."
}
\`\`\`

Return only valid JSON.

JSON Verification:`;
    } else {
        console.log(sens);
        // Light or Medium scan
        prompt = `A piece of text was flagged with the following snippet and reason:
Snippet: "${snippet}"
Reason: "${reason}"

Please explain in 2-3 sentences why this snippet might be considered problematic based on the reason provided. Focus on a clear, unbiased explanation.

Return the response in the following JSON format:
\`\`\`json
{
    "summary": "Your explanation here.",
}
\`\`\`

If no meaningful explanation can be provided, return an empty summary. Ensure valid JSON output.

JSON Verification:`;
    }
    // --- End Prompt Engineering ---
    console.log(`Sending snippet to Gemini API for verification: "${snippet.substring(0, 50)}..."`);

    try {
        console.log(prompt);
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
                
                const searchQuery = (verificationData && typeof verificationData.search_query === 'string')
                    ? verificationData.search_query.trim()
                    : null;

                let sources = [];
                let serpApiKey = 'f07c21bcf1e4c3b1e93afd4230ebe0a3a9193394c0a4762db6822ca165017c8a';

                if (sens === 'deep') {
                    // --- SerpAPI Integration ---
                    if (!searchQuery) {
                        throw new Error("No valid search query generated from Gemini.");
                    }
                    const serpResponse = await fetch(
                        `${SERPAPI_URL}?q=${encodeURIComponent(searchQuery)}&api_key=${serpApiKey}`
                    );
                    if (!serpResponse.ok) {
                        console.error('SerpAPI request failed:', await serpResponse.text());
                        throw new Error('Failed to fetch supporting sources from SerpAPI.');
                    }
                    const serpData = await serpResponse.json();
                    const organicResults = serpData.organic_results || [];
                    sources = organicResults
                        .filter((result) => result.link && typeof result.link === 'string')
                        .slice(0, 3)
                        .map((result) => result.link);

                    // Pad with empty strings if less than 3 sources
                    while (sources.length < 3) {
                        sources.push('');
                    }
                }

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

// --- Database Interaction for Unreliable Domains ---
async function handleLogUnreliableDomain(request) {
    const domain = request.domain;
    const score = request.score;

    if (!supabase) {
        console.error("Supabase not initialized, cannot log domain score.");
        throw new Error("Database connection not ready."); // This will be caught by the caller
    }

    try {
        const { data, error: selectError } = await supabase
            .from('scores')
            .select('increment, score_average')
            .eq('domain_url', domain)
            .single();

        if (selectError && selectError.code !== 'PGRST116') { // PGRST116: "Single row not found"
            console.error("Error selecting from scores table:", selectError);
            throw selectError;
        }

        if (!data) { // Domain not in scores table yet
            const { error: insertError } = await supabase.from('scores').insert({
                domain_url: domain,
                increment: 1,
                score_average: score
            });
            if (insertError) { console.error("Error inserting into scores table:", insertError); throw insertError; }
        } else { // Domain already in scores table
            const { increment, score_average } = data;
            const newIncrement = increment + 1; // Always increment

            if (newIncrement >= 10) { // Check if it REACHES 10 with this increment
                const finalAverage = ((score_average * increment) + score) / newIncrement;
                const reliability = Math.max(1, Math.min(10, Math.round(finalAverage / 10))); // Scale 0-100 to 1-10

                console.log(`Domain ${domain} reached ${newIncrement} reports. Avg score: ${finalAverage.toFixed(2)}. Calculated reliability: ${reliability}`);
                
                const { error: upsertError } = await supabase
                    .from('unreliable_domain')
                    .upsert({ domain_url: domain, reliability: reliability, reason: `Automatically flagged after ${newIncrement} reports with an average low score.` }, { onConflict: 'domain_url' });
                if (upsertError) { console.error("Error upserting into unreliable_domain table:", upsertError); throw upsertError; }
                
                // Optionally, reset or remove from 'scores' table after promotion
                // const { error: deleteError } = await supabase.from('scores').delete().eq('domain_url', domain);
                // if (deleteError) console.error("Error deleting from scores table:", deleteError);

            } else { // Still less than 10 increments
                const newAverage = ((score_average * increment) + score) / newIncrement;
                const { error: updateError } = await supabase
                    .from('scores')
                    .update({
                        increment: newIncrement,
                        score_average: newAverage
                    })
                    .eq('domain_url', domain);
                if (updateError) { console.error("Error updating scores table:", updateError); throw updateError; }
            }
        }
    } catch (dbError) {
        console.error("Database operation failed in handleLogUnreliableDomain:", dbError);
        throw dbError; // Re-throw to be caught by the onMessage listener's catch block
    }
}

console.log("Background script loaded.");
