// background/background.js

// --- Window Management (Keep if you reverted, remove if you kept the window popup) ---
let popupWindowId = null;
// ... (rest of window management code if applicable) ...

// Listener for messages from popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Background script received message:", request);

    if (request.action === "analyzeText") {
        chrome.storage.local.get(['geminiApiKey'], (result) => {
            const apiKey = result.geminiApiKey;
            if (!apiKey) {
                console.error("Gemini API Key not found in storage.");
                sendResponse({ success: false, error: "API Key not set. Please set it in the popup." });
                return true;
            }

            // *** Call the updated Gemini API function ***
            callGeminiAPIForHighlighting(request.text, apiKey)
                .then(analysisData => {
                    console.log("Gemini API Processed Response for Highlighting:", analysisData);
                    // *** Send score AND highlight data ***
                    sendResponse({ success: true, ...analysisData });
                })
                .catch(error => {
                    console.error("Error calling/processing Gemini API for highlighting:", error);
                    sendResponse({ success: false, error: error.message || "Failed to fetch or process analysis from Gemini" });
                });
        });
        return true;
    }
});

// *** RENAMED and MODIFIED function for highlighting ***
async function callGeminiAPIForHighlighting(textToAnalyze, apiKey) {
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

    // --- Prompt Engineering for Highlighting ---
    // ** CRITICAL STEP **
    // Ask for a score AND specific snippets with reasons in JSON format.
    // This prompt attempts to get structured output. It might need refinement.
    const prompt = `Analyze the following text for potential signs of misinformation, bias, or manipulative language.

Provide your analysis in JSON format with two main keys: "score" and "flags".
1.  "score": A numerical credibility score between 0 (very low credibility) and 100 (very high credibility).
2.  "flags": An array of objects. Each object should represent a specific problematic text snippet and have two keys:
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
            // Assuming the JSON object is the first part's text
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

console.log("Background script loaded (v4 - Highlighting).");
