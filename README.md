# MisinformShield System Proposal Analysis (MVP)

This document analyzes the feasibility of developing the "MisinformShield" Chrome extension Minimum Viable Product (MVP) within a 12-day timeframe, with approximately 3-4 hours of coding available per day. It also outlines a potential tech stack, key system entities, an overview, a simplified roadmap, and required tools, updated to reflect the use of the **Gemini API**.

## 1. Overview

MisinformShield aims to be an AI-powered Chrome browser extension designed to help users identify potentially misleading or false information while browsing the web. It plans to achieve this by:

* Extracting text content from web pages.
* Analyzing the text using AI (**Google's Gemini API**) and potentially basic heuristic patterns (like sensational language).
* Assessing the credibility of the website domain based on a curated list (future enhancement).
* Providing visual feedback to the user via the popup, showing the AI's analysis.
* (Future) Offering brief explanations (tooltips) for why content was flagged or highlighting content directly.

## 2. Feasibility Analysis (12 Days @ 3-4 hrs/day)

* **Total Estimated Hours:** 12 days * ~3.5 hours/day = **~42 hours**.
* **Original Project Timeline (Gantt Chart):** The provided Gantt chart in the initial proposal spanned approximately 7.5 weeks, indicating a significantly larger time budget was planned for the full version.
* **Scope vs. Time:** The proposed features for a full version included text extraction, AI analysis, heuristic matching, source credibility checks, UI feedback (highlighting, tooltips), and user settings.
* **Assessment:**
    * Developing a *fully functional and robust* version with all originally listed features, thorough testing, and refinement within 42 hours is **highly ambitious and likely not feasible**.
    * However, creating a **Minimum Viable Product (MVP)** demonstrating the core concept (text extraction, Gemini API call, result display in popup) **is challenging but achievable** within the 42 hours, as demonstrated by the progress made.
    * **Key Challenges Remaining for Full Version:** Reliable text extraction across diverse websites, effective scoring logic combining multiple factors (AI, source, heuristics), robust UI implementation (highlighting, tooltips), and comprehensive testing.

* **Conclusion:** Building the polished, comprehensive version as detailed in the original documents is **not feasible** in 12 days. An MVP focusing on the core loop (extract text -> analyze with Gemini -> display result) is **achievable**.

## 3. Easiest Tech Stack for MVP

To maximize progress within the limited time, simplicity is key:

* **Frontend (Chrome Extension):**
    * `HTML`: For the popup structure.
    * `CSS`: For basic styling of the popup.
    * `JavaScript (Vanilla)`: For DOM manipulation (extracting text), handling user interaction (popup buttons), making API calls (`fetch` via background script), and implementing core logic.
* **AI Analysis:**
    * **`Gemini API`**: Accessed via Google AI Studio or Google Cloud. Use JavaScript's `fetch` API (from the background script) to send requests. Requires careful prompt engineering.
* **Source Credibility (Future MVP Enhancement):**
    * `JavaScript Object/Array`: Start with a hardcoded list of known unreliable domains directly within the background JavaScript code.
* **Backend:**
    * `None (Direct API Call from Background)`: API calls are made directly from the extension's background script to the Gemini API. Requires managing the API key securely within the extension's storage.

## 4. Key System Entities/Roles (Simplified for MVP)

Based on the diagrams and functionality, we can define three core logical components:

1.  **`Content Extractor & Processor`**: (content.js) Runs within the webpage, extracts relevant text content from the DOM upon request from the popup.
2.  **`Analysis Engine`**: (background.js) Listens for requests, retrieves the API key, calls the Gemini API with the text and appropriate prompt, and returns the analysis.
3.  **`User Interface Manager`**: (popup.html/css/js) Handles the presentation to the user (popup window), allows saving the API key, triggers the analysis, displays loading states, shows results, and handles errors.

## 5. Simplified 12-Day Roadmap (MVP Focus - Achieved Core Loop)

This was the aggressive timeline focusing only on core functionality:

* **Days 1-2: Setup & Basic Extraction (Done)**
    * Create basic Chrome Extension structure (`manifest.json`, popup HTML/JS, content script JS).
    * Implement basic text extraction from the current page using the content script.
* **Days 3-5: API Integration (Done - Switched to Gemini)**
    * Set up Gemini API access.
    * Implement JS `fetch` call from the background script to send extracted text to Gemini.
    * Receive and display the raw AI analysis result in the popup.
* **Days 6-8: Basic Analysis & Scoring (Partially Done - Displaying Raw Result)**
    * Display the analysis result from Gemini.
    * _(Next Steps): Implement simple heuristic checks (e.g., excessive caps), implement hardcoded domain credibility check._
* **Days 9-10: Basic UI Feedback (Done - Popup Display)**
    * Display the final analysis clearly in the popup.
    * _(Next Steps): Implement highlighting based on score/flags._
* **Days 11-12: Testing & Refinement (Ongoing)**
    * Test on different websites.
    * Minimal debugging and refinement.

## 6. Tools Needed

* **Code Editor:** VS Code, Sublime Text, Atom, etc.
* **Web Browser:** Google Chrome (for development and testing).
* **Version Control:** Git & GitHub.
* **AI Account:** **Google Account** for accessing [Google AI Studio](https://aistudio.google.com/) and generating a **Gemini API Key**.
* **Chrome Developer Account:** Required *only* if publishing to the Chrome Web Store (costs a small one-time fee).
* **Basic Command Line/Terminal:** For Git usage.
* **(Optional) Image Editor:** For creating/editing extension icons (GIMP, Figma, etc.).

This updated analysis reflects the successful integration of the Gemini API and provides a basis for planning the next steps toward a more feature-complete extension.
