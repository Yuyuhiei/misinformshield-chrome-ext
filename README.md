# MisinformShield: AI-Powered Misinformation Detector for Chrome

MisinformShield is a powerful Chrome browser extension designed to empower users in navigating the complex digital landscape by identifying potentially misleading or false information in real-time. Leveraging advanced AI and web technologies, this extension provides users with immediate feedback on the credibility of web content as they browse.

## Features

* **Comprehensive Text Analysis:** Extracts and analyzes textual content from webpages, focusing on articles, posts, and other text-heavy elements.

* **AI-Powered Detection:** Utilizes the power of the **Gemini API** for sophisticated natural language processing to identify linguistic patterns, inconsistencies, and emotional manipulation techniques often associated with misinformation.

* **Source Credibility Check:** Integrates with the **Serp API** and potentially a curated database to assess the reputation and reliability of the website domain hosting the content.

* **Deep Scan Toggle:** Provides a "deep scan" feature to perform a more thorough analysis when needed, replacing granular threshold options for simplified user control.

* **Visual Feedback:** Highlights potentially misleading content directly on the webpage with clear visual indicators.

* **Explanatory Tooltips:** Offers brief explanations upon hovering over flagged content, detailing why it was marked as potentially problematic.

* **Seamless Integration:** Operates as a browser extension for real-time analysis without interrupting the user's browsing experience.

## Tech Stack

Here are the core technologies used in MisinformShield:

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Google Cloud (for Gemini)](https://img.shields.io/badge/Google%20Cloud-4285F4?style=for-the-badge&logo=google-cloud&logoColor=white)
![SerpAPI](https://img.shields.io/badge/SerpApi-056599?style=for-the-badge&logo=serpapi&logoColor=white)

* **Frontend:** HTML, CSS, JavaScript (Vanilla) for the browser extension interface (popup, content scripts) and logic.
* **AI Analysis:** Google's **Gemini API** for natural language processing and content evaluation.
* **Source Credibility/Fact-Checking:** **Serp API** for fetching external information and potentially a local database of known sources.

## Setup

To set up and run the MisinformShield extension locally:

1.  **Clone the Repository:**

    ```bash
    git clone [repository_url]
    cd [repository_name]

    ```

2.  **Obtain API Keys:**

    * Get a **Gemini API Key** from Google AI Studio (<https://aistudio.google.com/>).

    * Get a **Serp API Key** from <https://serpapi.com/>.

3.  **Configure API Keys:**

    * You will need to securely store and access your API keys within the extension's background script or storage. Refer to the project's documentation for the specific method implemented (e.g., using `chrome.storage.sync`).

4.  **Load the Extension in Chrome:**

    * Open Chrome and go to `chrome://extensions/`.

    * Enable "Developer mode" using the toggle in the top right corner.

    * Click "Load unpacked" in the top left corner.

    * Select the project directory (`[repository_name]`).

5.  **Pin the Extension:**

    * Click the extensions icon (puzzle piece) in the Chrome toolbar.

    * Click the pin icon next to "MisinformShield" to make it easily accessible.

## Usage

1.  Navigate to a webpage you wish to analyze.

2.  Click the MisinformShield extension icon in the Chrome toolbar.

3.  Use the interface to initiate the content scan and view the analysis results.

4.  Toggle the "Deep Scan" feature for a more in-depth analysis.

5.  Hover over highlighted text on the page for explanations.

## Authors
![@yuyuhiei](https://github.com/Yuyuhiei)
![@lanseudesu](https://github.com/lanseudesu)
![@zumeragi](https://github.com/zumeragi)
