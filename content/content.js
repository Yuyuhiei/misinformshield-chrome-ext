// content/content.js

console.log("MisinformShield Content Script Loaded!");

const HIGHLIGHT_CLASS = 'misinformshield-highlight';
const TOOLTIP_CLASS = 'misinformshield-tooltip';
const ICON_CLASS = 'misinformshield-icon';

const MODAL_OVERLAY_ID = 'misinformshield-modal-overlay';
const MODAL_CONTENT_ID = 'misinformshield-modal-content';
const MODAL_CLOSE_ID = 'misinformshield-modal-close';
const MODAL_SNIPPET_ID = 'misinformshield-modal-snippet';
const MODAL_REASON_ID = 'misinformshield-modal-reason';
const MODAL_SUMMARY_ID = 'misinformshield-modal-summary';
const MODAL_SOURCES_ID = 'misinformshield-modal-sources';
const MODAL_LOADING_ID = 'misinformshield-modal-loading';

// --- Text Extraction Logic --- (No changes needed here)
function extractPageText() { /* ... */ }
// --- (End Text Extraction Logic) ---


// --- Message Listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getText") {
        console.log("Content script received getText request.");
        (async () => {
            try {
                // Await the result of the async function
                const text = await extractPageText(); // Use the enhanced function name

                if (text && text !== "Content extraction failed or page has no significant text.") {
                    console.log("Successfully extracted text.");
                    sendResponse({ success: true, text: text });
                } else {
                    console.error("Failed to extract significant text from the page.");
                    sendResponse({ success: false, error: "Could not extract significant text." });
                }
            } catch (error) {
                console.error("Error during text extraction:", error);
                sendResponse({ success: false, error: `Extraction failed: ${error.message}` });
            }
        })();
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
         // return true; // No need to return true if highlightSnippets is sync
     }
     // *** NEW: Handle response from background script's verification ***
     else if (request.action === "verificationResult") {
         if (request.success) {
             updateModalContent(request.summary, request.sources);
         } else {
             updateModalContent(`Error verifying snippet: ${request.error}`, []);
         }
         // No need to sendResponse back to background script
     }
 });

 // --- Modal Management Variables (declare only) ---
 let modalOverlay = null;
 let modalContent = null;
 let modalSnippetDiv = null;
 let modalReasonDiv = null;
 let modalSummaryDiv = null;
 let modalSourcesUl = null;
 let modalLoadingDiv = null;

 // --- Modal Management Functions ---
 function showModal(snippet, reason) {
     // Ensure elements are assigned (might be redundant if initModalElements is guaranteed to run first)
     if (!modalOverlay) initModalElements();
     if (!modalOverlay) {
         console.error("Modal overlay not found!");
         return;
     }
     console.log("Showing modal for:", snippet);
     modalSnippetDiv.textContent = snippet;
     modalReasonDiv.textContent = reason;
     modalSummaryDiv.textContent = ''; // Clear previous summary
     modalSourcesUl.innerHTML = ''; // Clear previous sources
     modalLoadingDiv.style.display = 'block'; // Show loading indicator
     modalOverlay.classList.add('visible');
 }

 function hideModal() {
      if (!modalOverlay) return;
      modalOverlay.classList.remove('visible');
 }

 function updateModalContent(summary, sources) {
     modalSummaryDiv.textContent = summary || "No explanation provided.";
     modalSourcesUl.innerHTML = ''; // Clear previous sources

     if (sources && sources.length > 0) {
         sources.forEach(url => {
             if (url) { // Ensure URL is not empty string
                 const li = document.createElement('li');
                 const a = document.createElement('a');
                 a.href = url;
                 a.textContent = url;
                 a.target = '_blank'; // Open in new tab
                 a.rel = 'noopener noreferrer'; // Security best practice
                 li.appendChild(a);
                 modalSourcesUl.appendChild(li);
             }
         });
     } else {
         const li = document.createElement('li');
         li.textContent = 'No supporting sources found.';
         li.className = 'no-sources';
         modalSourcesUl.appendChild(li);
     }

     modalLoadingDiv.style.display = 'none'; // Hide loading indicator
 }


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
                        // iconSpan.title = `Credibility Check: ${reason}`; // REMOVED title

                        // *** Store data on the icon for click handling ***
                        iconSpan.dataset.snippet = snippetText;
                        iconSpan.dataset.reason = reason;

                        // *** Add click listener ***
                        iconSpan.addEventListener('click', handleIconClick);

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

// --- Icon Click Handler ---
function handleIconClick(event) {
    event.preventDefault(); // Prevent any default action
    event.stopPropagation(); // Stop event bubbling

    const icon = event.target;
    const snippet = icon.dataset.snippet;
    const reason = icon.dataset.reason;

    if (snippet && reason) {
        showModal(snippet, reason); // Show modal with initial info + loading

        // Send message to background script to start verification
        console.log("Sending snippet to background for verification:", snippet);
        chrome.runtime.sendMessage(
            { action: "verifySnippet", snippet: snippet, reason: reason },
            (response) => {
                // Handle immediate errors from background (e.g., API key missing)
                if (chrome.runtime.lastError) {
                    console.error("Error sending verification request:", chrome.runtime.lastError.message);
                    updateModalContent(`Error: ${chrome.runtime.lastError.message}`, []);
                } else if (response && !response.success) {
                     console.error("Background script reported verification error:", response.error);
                     updateModalContent(`Error: ${response.error}`, []);
                }
                // Otherwise, wait for the async "verificationResult" message handled by the listener
            }
        );
    } else {
        console.error("Could not retrieve snippet/reason from icon data attributes.");
    }
}


// --- Inject CSS for Highlighting and Tooltips ---
function addHighlightStyles() {
    const styleId = 'misinformshield-styles';
    if (document.getElementById(styleId)) return; // Style already added

    const css = `
        .${HIGHLIGHT_CLASS} {
            background-color: rgba(255, 255, 0, 0.6); /* Slightly transparent yellow */
            /* cursor: help; /* Remove cursor change on text */
            border-bottom: 1px dotted #b0a000; /* Subtle underline */
        }
        .${ICON_CLASS} {
            cursor: pointer; /* Make icon clickable */
            font-size: 0.9em; /* Slightly larger icon */
            margin-right: 3px;
            vertical-align: super;
            display: inline-block;
            position: relative;
            color: #007bff; /* Blue icon */
            text-decoration: none; /* Remove underline if any */
            transition: transform 0.2s ease;
        }
        .${ICON_CLASS}:hover {
            transform: scale(1.2); /* Enlarge icon on hover */
            color: #0056b3; /* Darker blue */
        }

        /* --- Modal Styles --- */
        #${MODAL_OVERLAY_ID} {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.6); /* Dark overlay */
            display: none; /* Hidden by default */
            justify-content: center;
            align-items: center;
            z-index: 9999; /* Below modal content */
            opacity: 0;
            transition: opacity 0.3s ease;
        }
        #${MODAL_OVERLAY_ID}.visible {
            display: flex;
            opacity: 1;
        }

        #${MODAL_CONTENT_ID} {
            background-color: #fff;
            padding: 25px 30px;
            border-radius: 8px;
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
            width: 90%;
            max-width: 600px; /* Max width */
            max-height: 80vh; /* Max height */
            overflow-y: auto; /* Scroll if content overflows */
            position: relative; /* For close button positioning */
            z-index: 10000; /* Above overlay */
            transform: scale(0.9);
            transition: transform 0.3s ease;
        }
         #${MODAL_OVERLAY_ID}.visible #${MODAL_CONTENT_ID} {
             transform: scale(1);
         }


        #${MODAL_CLOSE_ID} {
            position: absolute;
            top: 10px;
            right: 15px;
            font-size: 1.8em;
            font-weight: bold;
            color: #aaa;
            background: none;
            border: none;
            cursor: pointer;
            line-height: 1;
            padding: 0;
        }
        #${MODAL_CLOSE_ID}:hover {
            color: #333;
        }

        #${MODAL_CONTENT_ID} h3 {
            margin-top: 0;
            margin-bottom: 15px;
            color: #333;
            border-bottom: 1px solid #eee;
            padding-bottom: 10px;
            font-size: 1.2em;
        }
         #${MODAL_CONTENT_ID} h4 {
            margin-top: 20px;
            margin-bottom: 8px;
            color: #555;
            font-size: 1em;
         }

        #${MODAL_SNIPPET_ID}, #${MODAL_REASON_ID} {
            background-color: #f8f9fa;
            border-left: 3px solid #007bff;
            padding: 10px 15px;
            margin-bottom: 15px;
            font-style: italic;
            color: #555;
            border-radius: 4px;
            font-size: 0.95em;
        }
         #${MODAL_SNIPPET_ID} strong, #${MODAL_REASON_ID} strong {
             font-style: normal;
             color: #333;
             margin-right: 5px;
         }


        #${MODAL_SUMMARY_ID} {
            margin-top: 10px;
            line-height: 1.6;
            color: #333;
            font-size: 1em;
        }

        #${MODAL_SOURCES_ID} {
            margin-top: 10px;
            padding-left: 0; /* Remove default list padding */
            list-style: none; /* Remove default list bullets */
        }
        #${MODAL_SOURCES_ID} li {
            margin-bottom: 8px;
        }
        #${MODAL_SOURCES_ID} a {
            color: #007bff;
            text-decoration: none;
            word-break: break-all; /* Prevent long URLs from overflowing */
            font-size: 0.9em;
        }
        #${MODAL_SOURCES_ID} a:hover {
            text-decoration: underline;
        }
         #${MODAL_SOURCES_ID} .no-sources {
             font-style: italic;
             color: #888;
         }

        #${MODAL_LOADING_ID} {
            text-align: center;
            padding: 20px;
            font-style: italic;
            color: #888;
            display: none; /* Hidden initially */
        }
    `;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);
}

addHighlightStyles(); // Add styles when the content script loads

// --- Modal Creation ---
function createVerificationModal() {
    if (document.getElementById(MODAL_OVERLAY_ID)) return; // Already created

    const overlay = document.createElement('div');
    overlay.id = MODAL_OVERLAY_ID;

    const content = document.createElement('div');
    content.id = MODAL_CONTENT_ID;

    content.innerHTML = `
        <button id="${MODAL_CLOSE_ID}" title="Close">&times;</button>
        <h3>Verification Details</h3>
        <h4>Flagged Snippet:</h4>
        <div id="${MODAL_SNIPPET_ID}"></div>
        <h4>Reason:</h4>
        <div id="${MODAL_REASON_ID}"></div>
        <hr>
        <h4>Explanation:</h4>
        <div id="${MODAL_SUMMARY_ID}"></div>
        <div id="${MODAL_LOADING_ID}">Loading verification details...</div>
        <h4>Supporting Sources:</h4>
        <ul id="${MODAL_SOURCES_ID}"></ul>
    `;

    overlay.appendChild(content);
    document.body.appendChild(overlay);

    // Close functionality moved to initModalElements to ensure elements exist
}

createVerificationModal(); // Create the modal structure when script loads

// --- Assign Modal Element Variables (after creation) ---
function initModalElements() {
    modalOverlay = document.getElementById(MODAL_OVERLAY_ID);
    modalContent = document.getElementById(MODAL_CONTENT_ID);
    modalSnippetDiv = document.getElementById(MODAL_SNIPPET_ID);
    modalReasonDiv = document.getElementById(MODAL_REASON_ID);
    modalSummaryDiv = document.getElementById(MODAL_SUMMARY_ID);
    modalSourcesUl = document.getElementById(MODAL_SOURCES_ID);
    modalLoadingDiv = document.getElementById(MODAL_LOADING_ID);

    // Add close functionality here as well, ensuring it's attached after creation
    const closeButton = document.getElementById(MODAL_CLOSE_ID);
     if (closeButton) {
        closeButton.addEventListener('click', hideModal);
     } else {
         console.error("Modal close button not found during init!");
     }
     if (modalOverlay) {
        modalOverlay.addEventListener('click', (event) => {
            if (event.target === modalOverlay) {
                hideModal();
            }
        });
     } else {
          console.error("Modal overlay not found during init!");
     }
}

// Initialize modal elements immediately after creation
initModalElements();


// --- Text Extraction Logic ---
async function extractPageText(timeoutMs = 5000) {
    const mainContentSelectors = [
        'article[class*="article"]', // More specific article tags
        'article.post',
        'article.story',
        'div[class*="article-body"]',
        'div[class*="post-content"]',
        'div[class*="entry-content"]',
        'div[class*="story-content"]',
        'div[id*="article-content"]',
        'div[itemprop="articleBody"]', // Schema.org microdata
        'section[class*="article-content"]',
        'div.main-content', // Common generic wrappers
        'div#main-content',
        'div.td-post-content', // Newspaper/Magazine themes
        'div.content__body', // Some news sites (e.g., The Guardian)
        'main[id*="main"]',
        'article', 'main', '.post-content', '.entry-content', '#content', '#main-content', // Generic fallback
        // Add more as you identify common patterns
    ];

    const selectorsToRemove = [
        'nav', 'header', 'footer', 'aside', 'script', 'style',
        '.sidebar', '#sidebar',
        '.ads', '.advertisement', '.ad-slot', 'div[class*="ad"]',
        '.comments', '#comments', '.comment-section',
        '.related-articles', '.related-posts', 'div[class*="related"]',
        '.social-share', '.sharing-buttons', 'div[class*="share"]',
        '.author-bio', '.author-box', // Sometimes these are separate and verbose
        '.newsletter-signup', 'div[class*="newsletter"]',
        '.print-button', '.email-button',
        'figure > figcaption', // Remove figcaptions if they are too noisy, or adjust if needed
        '.breaking-news-banner',
        '#top-navigation',
        '.site-header',
        '.site-footer',
        'form', // Remove forms like search or comments
        'ul[class*="nav"]', // Navigation lists
        'div[class*="cookie"]', // Cookie banners
        'div[id*="cookie"]',
        'div[class*="banner"]',
        // Be cautious with very generic selectors here, they might remove content
    ];

    let mainElement = null;
    let foundContent = false;

    async function waitForElement(selector, interval = 100, timeout = timeoutMs) {
        return new Promise((resolve) => {
            const endTime = Date.now() + timeout;
            const timer = setInterval(() => {
                const element = document.querySelector(selector);
                if (element) {
                    clearInterval(timer);
                    resolve(element);
                } else if (Date.now() > endTime) {
                    clearInterval(timer);
                    resolve(null); // Timeout
                }
            }, interval);
        });
    }

    for (const selector of mainContentSelectors) {
        const element = await waitForElement(selector, 200, timeoutMs / mainContentSelectors.length); // Distribute timeout
        if (element && element.innerText && element.innerText.trim().length > 100) { // Basic check for some content
            // Check if this element isn't just a wrapper for another more specific selector we already have
            let isBestCandidate = true;
            if (mainElement) {
                if (mainElement.contains(element)) { // 'element' is inside 'mainElement', so mainElement is better
                    isBestCandidate = false;
                } else if (element.contains(mainElement)) { // 'mainElement' was inside 'element', so 'element' is better
                    mainElement = element;
                } else {
                     // If they are separate, prefer the one with more text or a more specific selector (hard to quantify easily here)
                     // For now, let's assume the first one that's sufficiently long is good, or override if clearly better
                }
            } else {
                 mainElement = element;
            }

            if(isBestCandidate && mainElement === element) {
                console.log("Found main content with selector:", selector);
                foundContent = true;
                // You could break here if you are satisfied with the first good match
                // or continue to see if a more deeply nested (and thus potentially more specific) selector matches.
                // For now, let's try to get the most specific one that still has decent content.
            }
        }
    }

    let mainText = '';

    if (mainElement) {
        // Clone the found element to avoid altering the live page if we do more aggressive cleanup
        const mainContentClone = mainElement.cloneNode(true);

        // Remove unwanted sub-elements from the cloned main content
        selectorsToRemove.forEach(selector => {
            mainContentClone.querySelectorAll(selector).forEach(el => el.remove());
        });
        mainText = mainContentClone.innerText;
    }


    // 2. Fallback if no specific main content element was found
    if (!foundContent || !mainText.trim()) {
        console.log("Falling back to generic body cleanup.");
        const bodyClone = document.body.cloneNode(true);
        selectorsToRemove.forEach(selector => {
            bodyClone.querySelectorAll(selector).forEach(el => el.remove());
        });
        mainText = bodyClone.innerText;
    }

    // 3. Clean up the extracted text
    // Remove excessive newlines and trim whitespace
    mainText = mainText.replace(/(\s*\n\s*){3,}/g, '\n\n'); // Replace 3+ newlines (with optional surrounding spaces) with double newlines
    mainText = mainText.replace(/[ \t\r]+/g, ' '); // Replace multiple spaces/tabs with a single space
    mainText = mainText.split('\n').map(line => line.trim()).filter(line => line.length > 0).join('\n');
    mainText = mainText.trim();


    // 4. Truncate if necessary
    const MAX_LENGTH = 15000; // Increased for potentially longer articles
    if (mainText.length > MAX_LENGTH) {
        mainText = mainText.substring(0, MAX_LENGTH) + "... (truncated)";
    }

    if (!mainText) {
        console.warn("Could not extract significant text.");
        return "Content extraction failed or page has no significant text.";
    }

    return mainText;
}
