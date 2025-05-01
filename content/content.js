// content/content.js

console.log("MisinformShield Content Script Loaded!");

const HIGHLIGHT_CLASS = 'misinformshield-highlight';
const TOOLTIP_CLASS = 'misinformshield-tooltip';
const ICON_CLASS = 'misinformshield-icon';

// --- Text Extraction Logic --- (No changes needed here)
function extractPageText() { /* ... */ }
// --- (End Text Extraction Logic) ---


// --- Message Listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getText") {
        console.log("Content script received getText request.");
        const text = extractPageText();
        if (text) {
            sendResponse({ success: true, text: text });
        } else {
            console.error("Failed to extract text from the page.");
            sendResponse({ success: false, error: "Could not extract text." });
        }
        return true; // Indicate asynchronous response potential
    }
    else if (request.action === "highlightText") {
        console.log("Content script received highlightText request:", request.flags);
        clearHighlights(); // Remove previous highlights first
        if (request.flags && request.flags.length > 0) {
            try {
                highlightSnippets(request.flags);
                sendResponse({ success: true });
            } catch (error) {
                 console.error("Error during highlighting:", error);
                 sendResponse({ success: false, error: error.message });
            }
        } else {
             sendResponse({ success: true, message: "No flags to highlight or clear request." });
        }
         // Consider if response needs to be async depending on highlightSnippets complexity
         // return true;
    }
});

// --- Highlighting Logic ---

function clearHighlights() {
    console.log("Clearing previous highlights...");
    // Remove highlight spans
    const highlights = document.querySelectorAll(`.${HIGHLIGHT_CLASS}`);
    highlights.forEach(span => {
        // Replace the span with its text content
        const parent = span.parentNode;
        while (span.firstChild) {
            parent.insertBefore(span.firstChild, span);
        }
        parent.removeChild(span);
        // Normalize text nodes (merge adjacent text nodes) - optional but cleaner
        parent.normalize();
    });

    // Remove icons/tooltips (if they exist separately)
    const icons = document.querySelectorAll(`.${ICON_CLASS}`);
    icons.forEach(icon => icon.remove());
    const tooltips = document.querySelectorAll(`.${TOOLTIP_CLASS}`);
    tooltips.forEach(tooltip => tooltip.remove());
}


function highlightSnippets(flags) {
    console.log("Starting highlighting process...");
    flags.forEach((flag, index) => {
        const snippetText = flag.snippet.trim(); // Trim whitespace
        const reason = flag.reason;

        if (!snippetText) return; // Skip empty snippets

        // *** DOM Searching - This is the fragile part ***
        // We'll search within common content containers first for performance.
        const searchAreas = document.querySelectorAll('article, main, .post-content, .entry-content, #content, #main-content, body');
        let found = false;

        searchAreas.forEach(area => {
            if (found) return; // Stop searching if already found in a previous area

            // Use TreeWalker to efficiently find text nodes
            const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT, null, false);
            let node;
            while (node = walker.nextNode()) {
                const nodeText = node.nodeValue;
                let startIndex = nodeText.indexOf(snippetText);

                if (startIndex !== -1) {
                    console.log(`Found snippet: "${snippetText.substring(0, 50)}..." in node:`, node);
                    try {
                        const range = document.createRange();
                        range.setStart(node, startIndex);
                        range.setEnd(node, startIndex + snippetText.length);

                        // Create highlight span
                        const highlightSpan = document.createElement('span');
                        highlightSpan.className = HIGHLIGHT_CLASS;

                        // Create icon/tooltip trigger
                        const iconSpan = document.createElement('span');
                        iconSpan.className = ICON_CLASS;
                        iconSpan.textContent = '❓'; // Simple question mark icon
                        iconSpan.title = `Credibility Check: ${reason}`; // Use title attribute for basic tooltip

                        // Wrap the found text range with the highlight span
                        range.surroundContents(highlightSpan);

                        // Insert the icon *before* the highlight span
                        highlightSpan.parentNode.insertBefore(iconSpan, highlightSpan);

                        found = true; // Mark as found
                        // **Important**: Stop searching within this node if found.
                        // If the same snippet appears multiple times, this only highlights the first.
                        // Highlighting all occurrences is much more complex.
                        break; // Exit the while loop for this node

                    } catch (error) {
                         // Log errors during DOM manipulation (e.g., range issues)
                         console.error(`Error highlighting snippet "${snippetText.substring(0, 50)}...":`, error);
                         // Continue searching other nodes
                    }
                }
            } // end while loop (TreeWalker)
        }); // end searchAreas.forEach

        if (!found) {
            console.warn(`Could not find snippet on page: "${snippetText.substring(0, 50)}..."`);
        }
    }); // end flags.forEach
    console.log("Highlighting process finished.");
}


// --- Inject CSS for Highlighting and Tooltips ---
function addHighlightStyles() {
    const styleId = 'misinformshield-styles';
    if (document.getElementById(styleId)) return; // Style already added

    const css = `
        .${HIGHLIGHT_CLASS} {
            background-color: yellow;
            cursor: help; /* Indicate interactivity */
        }
        .${ICON_CLASS} {
            cursor: help;
            font-size: 0.8em; /* Smaller icon */
            margin-right: 3px; /* Space between icon and text */
            vertical-align: super; /* Align slightly above text */
            display: inline-block; /* Needed for positioning */
            position: relative; /* Needed if using pseudo-elements for tooltips */
            /* Basic tooltip using title is handled by browser */
        }
        /* Optional: More advanced CSS tooltip (requires more JS for positioning) */
        /*
        .${ICON_CLASS}:hover .${TOOLTIP_CLASS} {
            display: block;
        }
        .${TOOLTIP_CLASS} {
            display: none;
            position: absolute;
            bottom: 120%; // Position above the icon
            left: 50%;
            transform: translateX(-50%);
            background-color: #333;
            color: #fff;
            padding: 5px 8px;
            border-radius: 4px;
            font-size: 0.9em;
            white-space: nowrap;
            z-index: 10000; // Ensure it's on top
        }
        */
    `;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);
}

addHighlightStyles(); // Add styles when the content script loads

// --- Text Extraction Logic ---
function extractPageText() {
    const mainContentSelectors = ['article', 'main', '.post-content', '.entry-content', '#content', '#main-content'];
    let mainText = '';
    let foundContent = false;
    for (const selector of mainContentSelectors) {
        const element = document.querySelector(selector);
        if (element) {
            mainText = element.innerText; foundContent = true; break;
        }
    }
    if (!foundContent) {
        const bodyClone = document.body.cloneNode(true);
        const selectorsToRemove = ['nav', 'header', 'footer', 'aside', 'script', 'style', '.sidebar', '#sidebar', '.ads', '.advertisement'];
        selectorsToRemove.forEach(selector => { bodyClone.querySelectorAll(selector).forEach(el => el.remove()); });
        mainText = bodyClone.innerText;
    }
    mainText = mainText.replace(/(\s\s+|\n\n+)/g, '\n').trim();
    const MAX_LENGTH = 10000;
    if (mainText.length > MAX_LENGTH) {
        mainText = mainText.substring(0, MAX_LENGTH) + "... (truncated)";
    }
    return mainText;
}
