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
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
    const promptLight = `You are a fact-checking assistant...Text to analyze:\n---\n${textToAnalyze}\n---\n\nJSON Analysis:`; // Truncated for brevity
    const promptMedium = `You are an AI assistant tasked with evaluating a text...Text to analyze:\n---\n${textToAnalyze}\n---\n\nJSON Analysis:`; // Truncated for brevity
    let prompt = (sens === 'light') ? promptLight : promptMedium;

    console.log("Sending text to Gemini API for highlighting analysis (sens: " + sens + ")");
    try {
        const response = await fetch(API_URL, { /* ... fetch options ... */ 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                "contents": [{ "parts": [{ "text": prompt }] }],
                "generationConfig": {
                    "response_mime_type": "application/json",
                    "temperature": 0.3, 
                    "maxOutputTokens": 800 
                }
            })
        });
        // ... (rest of the function as previously provided)
        if (!response.ok) {
            let errorBodyText = await response.text(); console.error("API Error Response Text:", errorBodyText);
            let errorJson = {}; try { errorJson = JSON.parse(errorBodyText); } catch(e) {}
            const errorMessage = errorJson?.error?.message || errorBodyText || `API request failed with status ${response.status}`;
            throw new Error(errorMessage);
        }
        const data = await response.json();
        if (data.candidates && data.candidates[0]?.content?.parts?.[0]) {
            let jsonString = data.candidates[0].content.parts[0].text;
            const jsonMatch = jsonString.match(/```json\s*([\s\S]*?)\s*```/);
            if (jsonMatch && jsonMatch[1]) jsonString = jsonMatch[1];
            try {
                const analysisData = JSON.parse(jsonString);
                const score = (analysisData && typeof analysisData.score === 'number') ? Math.max(0, Math.min(100, analysisData.score)) : 50;
                const flags = (analysisData && Array.isArray(analysisData.flags)) ? analysisData.flags.filter(f => f && typeof f.snippet === 'string' && typeof f.reason === 'string') : [];
                return { score, flags };
            } catch (parseError) { console.error("Failed to parse JSON from Gemini (highlighting):", jsonString, parseError); throw new Error("Bad JSON from API."); }
        } else if (data.promptFeedback?.blockReason) { throw new Error(`Request blocked by API (highlighting): ${data.promptFeedback.blockReason}.`);}
        else { throw new Error("Unexpected API response format (highlighting)."); }
    } catch (error) { console.error("Gemini API call (highlighting) error:", error); throw error; }
}

// --- Gemini API Call for Snippet Verification ---
async function verifySnippetWithSources(snippet, reason, apiKey, sens) {
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
    let prompt = "";
    if (sens === "deep") {
        prompt = `A piece of text was flagged...Snippet: "${snippet}"\nReason: "${reason}"...JSON Verification:`; // Truncated
    } else {
        prompt = `A piece of text was flagged...Snippet: "${snippet}"\nReason: "${reason}"...JSON Verification:`; // Truncated
    }
    console.log(`Sending snippet to Gemini API for verification (sens: ${sens}): "${snippet.substring(0, 50)}..."`);
    try {
        const response = await fetch(API_URL, { /* ... fetch options ... */ 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                "contents": [{ "parts": [{ "text": prompt }] }],
                "generationConfig": {
                    "response_mime_type": "application/json",
                    "temperature": 0.4, 
                    "maxOutputTokens": 500
                }
            })
        });
        // ... (rest of the function as previously provided)
        if (!response.ok) {
            let errorBodyText = await response.text(); console.error("API Verification Error Text:", errorBodyText);
            let errorJson = {}; try { errorJson = JSON.parse(errorBodyText); } catch(e) {}
            const errorMessage = errorJson?.error?.message || errorBodyText || `API verification failed: ${response.status}`;
            throw new Error(errorMessage);
        }
        const data = await response.json();
        if (data.candidates && data.candidates[0]?.content?.parts?.[0]) {
            let jsonString = data.candidates[0].content.parts[0].text;
            const jsonMatch = jsonString.match(/```json\s*([\s\S]*?)\s*```/);
            if (jsonMatch && jsonMatch[1]) jsonString = jsonMatch[1];
            try {
                const verificationData = JSON.parse(jsonString);
                const summary = (verificationData && typeof verificationData.summary === 'string') ? verificationData.summary.trim() : "Could not generate explanation.";
                const sources = (verificationData && Array.isArray(verificationData.sources)) ? verificationData.sources.filter(s => typeof s === 'string' && s.trim().startsWith('http')) : [];
                return { summary, sources };
            } catch (parseError) { console.error("Failed to parse JSON from Gemini (verification):", jsonString, parseError); throw new Error("Bad JSON from API (verification).");}
        } else if (data.promptFeedback?.blockReason) { throw new Error(`Request blocked by API (verification): ${data.promptFeedback.blockReason}.`);}
        else { throw new Error("Unexpected API response format (verification)."); }
    } catch (error) { console.error("Gemini API call (verification) error:", error); throw error; }
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
