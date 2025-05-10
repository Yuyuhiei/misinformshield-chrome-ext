// domains_table.js

document.addEventListener('DOMContentLoaded', () => {
    const domainsTableContainer = document.getElementById('domainsTableContainer');

    /**
     * Fetches unreliable domain data from the background script and initiates table rendering.
     */
    function fetchAndDisplayUnreliableDomains() {
        if (!domainsTableContainer) {
            console.error("Domains table container not found.");
            return;
        }
        domainsTableContainer.innerHTML = '<p class="table-message table-loading">Loading domains...</p>';
        console.log("domains_table.js: Sending 'getUnreliableDomains' message to background.");

        chrome.runtime.sendMessage({ action: "getUnreliableDomains" }, (response) => {
            console.log("domains_table.js: Received response for 'getUnreliableDomains'.", "Last Error:", chrome.runtime.lastError, "Response:", response);
            if (chrome.runtime.lastError) {
                console.error("domains_table.js: Error fetching unreliable domains:", chrome.runtime.lastError.message);
                if (domainsTableContainer) domainsTableContainer.innerHTML = `<p class="table-message table-error">Error: ${chrome.runtime.lastError.message}</p>`;
                return;
            }
            if (!response) {
                console.error("domains_table.js: No response received from background for 'getUnreliableDomains'. Port might have closed.");
                if (domainsTableContainer) domainsTableContainer.innerHTML = `<p class="table-message table-error">Failed to load domains: No response from background script.</p>`;
                return;
            }
            if (response.success) {
                renderDomainsTable(response.data);
            } else {
                console.error("domains_table.js: Failed to fetch unreliable domains (success=false):", response.error);
                if (domainsTableContainer) domainsTableContainer.innerHTML = `<p class="table-message table-error">Failed to load domains: ${response.error || 'Unknown error from background'}</p>`;
            }
        });
    }

    /**
     * Renders the HTML table with the provided domain data.
     * @param {Array<Object>} domains - Array of domain objects.
     */
    function renderDomainsTable(domains) {
        if (!domainsTableContainer) return;
        if (!domains || domains.length === 0) {
            domainsTableContainer.innerHTML = '<p class="table-message table-empty">No unreliable domains listed yet.</p>';
            return;
        }

        const table = document.createElement('table');
        table.className = 'domains-table';
        
        const thead = document.createElement('thead');
        thead.innerHTML = `
            <tr>
                <th class="col-url">Domain URL</th>
                <th class="col-reliability">Reliability</th>
                <th class="col-reason">Reason</th>
            </tr>
        `;
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        domains.forEach(domain => {
            const row = tbody.insertRow();
            
            // Domain URL Cell
            const cellDomain = row.insertCell();
            cellDomain.className = 'col-url'; // Apply class for styling
            const domainLink = document.createElement('a');
            const urlString = String(domain.domain_url);
            domainLink.href = urlString.startsWith('http') ? urlString : `http://${urlString}`;
            domainLink.textContent = domain.domain_url;
            domainLink.target = "_blank"; 
            domainLink.rel = "noopener noreferrer";
            cellDomain.appendChild(domainLink);

            // Reliability Cell
            const cellReliability = row.insertCell();
            cellReliability.className = 'col-reliability'; // Apply class for styling
            cellReliability.textContent = domain.reliability !== null && typeof domain.reliability !== 'undefined' ? domain.reliability : 'N/A';
            // Add color class based on reliability score
            if (typeof domain.reliability === 'number') {
                if (domain.reliability <= 3) {
                    cellReliability.classList.add('reliability-score-low');
                } else if (domain.reliability <= 7) {
                    cellReliability.classList.add('reliability-score-medium');
                } else {
                    cellReliability.classList.add('reliability-score-high');
                }
            }


            // Reason Cell
            const cellReason = row.insertCell();
            cellReason.className = 'col-reason'; // Apply class for styling
            cellReason.textContent = domain.reason || 'N/A'; 
            if (domain.reason) { // Add title for full reason if it's long
                cellReason.title = domain.reason;
            }
        });
        table.appendChild(tbody);

        domainsTableContainer.innerHTML = ''; 
        domainsTableContainer.appendChild(table);
    }

    // Initial fetch of domains when the page loads
    fetchAndDisplayUnreliableDomains();
});
