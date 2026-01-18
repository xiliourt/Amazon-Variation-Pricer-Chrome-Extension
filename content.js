(async function() {
    console.log("🚀 Starting Extraction & UI Render...");

    // ============================================================
    // 1. EXTRACTION LOGIC
    // ============================================================
    
    const cleanText = (text) => text ? text.replace(/\s+/g, ' ').trim() : null;

    const extractPrice = (text) => {
        const priceRegexes = [
            /<span[^>]*class=["'][^"']*aok-offscreen[^"']*["'][^>]*>[^<]*?([\d.,$€£]+)[^<]*?<\/span>/i,
            /<span[^>]*class=["'][^"']*a-offscreen[^"']*["'][^>]*>\s*([\d.,$€£]+)\s*<\/span>/i,
            /<span[^>]*class=["'][^"']*a-price-whole[^"']*["'][^>]*>([\d.,]+)<\/span>/i,
            /id="priceblock_ourprice"[^>]*>([\d.,$€£]+)</i
        ];
        for (const rx of priceRegexes) {
            const match = text.match(rx);
            if (match && match[1]) {
                const val = match[1].trim();
                if (/\d/.test(val)) return val;
            }
        }
        return "N/A";
    };

    const html = document.documentElement.outerHTML;
    const baseUrl = window.location.origin;
    const currentAsin = document.querySelector('input[id="ASIN"]')?.value || 'Unknown';
    const parentPrice = extractPrice(html);
    let variants = [];

    // --- STRATEGY A: CLASSIC JSON ---
    const classicRegex = /dimensionValuesDisplayData"\s*:\s*({[\s\S]*?})(?=\s*,\s*")/m;
    const asinMapRegex = /asinToDimensionIndexMap"\s*:\s*({[\s\S]*?})(?=\s*,\s*")/m;
    const classicMatch = html.match(classicRegex);
    const mapMatch = html.match(asinMapRegex);

    if (classicMatch && mapMatch) {
        try {
            const cleanJson = (str) => str.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
            const variationValues = JSON.parse(cleanJson(classicMatch[1]));
            const asinMap = JSON.parse(cleanJson(mapMatch[1]));
            const dimensions = Object.keys(variationValues);

            for (const [asin, indices] of Object.entries(asinMap)) {
                const nameParts = [];
                dimensions.forEach((dimKey, i) => {
                    nameParts.push(variationValues[dimKey][indices[i]]);
                });
                variants.push({
                    name: nameParts.join(" / "),
                    asin: asin,
                    price: (asin === currentAsin) ? parentPrice : "Requires Fetch",
                    url: `${baseUrl}/dp/${asin}`
                });
            }
        } catch (e) { console.error("Classic Parse Error", e); }
    }

    // --- STRATEGY B: TWISTER PLUS ---
    if (variants.length === 0) {
        const newTwisterRegex = /data-a-state="{&quot;key&quot;:&quot;desktop-twister-sort-filter-data&quot;}">\s*({[\s\S]*?})\s*<\/script>/;
        const newMatch = html.match(newTwisterRegex);
        if (newMatch) {
            try {
                const rawJson = newMatch[1].replace(/&quot;/g, '"'); 
                const data = JSON.parse(rawJson);
                if (data.sortedDimValuesForAllDims) {
                    const dimKeys = Object.keys(data.sortedDimValuesForAllDims);
                    const seenAsins = new Set();
                    const selectedValues = {};
                    dimKeys.forEach(key => {
                        const vals = data.sortedDimValuesForAllDims[key];
                        const sel = vals.find(v => v.dimensionValueState === 'SELECTED');
                        if (sel) selectedValues[key] = sel.dimensionValueDisplayText;
                    });
                    dimKeys.forEach(targetDim => {
                        const values = data.sortedDimValuesForAllDims[targetDim];
                        values.forEach(v => {
                            if (v.defaultAsin && !seenAsins.has(v.defaultAsin)) {
                                const vDims = { ...selectedValues };
                                vDims[targetDim] = v.dimensionValueDisplayText;
                                const nameParts = dimKeys.map(k => vDims[k] || 'Unknown');
                                variants.push({
                                    name: nameParts.join(" / "),
                                    asin: v.defaultAsin,
                                    price: (v.defaultAsin === currentAsin) ? parentPrice : "Requires Fetch",
                                    url: `${baseUrl}/dp/${v.defaultAsin}`
                                });
                                seenAsins.add(v.defaultAsin);
                            }
                        });
                    });
                }
            } catch (e) { console.error("Twister Parse Error", e); }
        }
    }

    // ============================================================
    // 2. UI CREATION
    // ============================================================
    
    const dashboardId = 'amazon-pricer-dashboard';
    const oldDash = document.getElementById(dashboardId);
    if (oldDash) oldDash.remove();

    const dashboard = document.createElement('div');
    dashboard.id = dashboardId;
    dashboard.style.cssText = `
        position: fixed; top: 80px; right: 20px; width: 340px; max-height: 80vh;
        background: white; box-shadow: 0 4px 15px rgba(0,0,0,0.2); border-radius: 8px;
        z-index: 99999; font-family: "Amazon Ember", Arial, sans-serif;
        display: flex; flex-direction: column; border: 1px solid #ddd;
    `;

    const header = document.createElement('div');
    header.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong>Found ${variants.length} Variations</strong>
            <button id="pricer-close" style="background:none; border:none; cursor:pointer; font-size:18px;">&times;</button>
        </div>
        <div style="font-size: 11px; color: #666; margin-top: 4px;">
            Scanning prices... <span id="pricer-progress">0</span>/${variants.length}
        </div>
    `;
    header.style.cssText = `padding: 12px; background: #f8f8f8; border-bottom: 1px solid #eee;`;
    dashboard.appendChild(header);

    const list = document.createElement('div');
    list.style.cssText = `overflow-y: auto; flex-grow: 1; padding: 0;`;
    dashboard.appendChild(list);

    document.body.appendChild(dashboard);
    document.getElementById('pricer-close').onclick = () => dashboard.remove();

    const addRow = (variant, index) => {
        const row = document.createElement('div');
        row.id = `pricer-row-${index}`;
        row.style.cssText = `
            padding: 8px 12px; border-bottom: 1px solid #f0f0f0; font-size: 13px;
            display: flex; justify-content: space-between; align-items: center; transition: background 0.2s;
        `;
        row.innerHTML = `
            <div style="width: 65%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${variant.name}">
                ${variant.name}
            </div>
            <div id="pricer-val-${index}" style="font-weight: bold; color: #555;">
                ${variant.price === "Requires Fetch" ? "..." : variant.price}
            </div>
        `;
        
        if(variant.asin === currentAsin) {
            row.style.backgroundColor = "#e6f3ff"; // Blue for current
            row.style.borderLeft = "4px solid #007185";
        }

        row.style.cursor = "pointer";
        row.onmouseover = () => { if(variant.asin !== currentAsin) row.style.backgroundColor = "#f9f9f9"; }
        row.onmouseout = () => { if(variant.asin !== currentAsin) row.style.backgroundColor = "white"; }
        row.onclick = () => window.location.href = variant.url;
        
        list.appendChild(row);
    };

    variants.forEach((v, i) => addRow(v, i));

    // ============================================================
    // 3. BACKGROUND FETCHING & HIGHLIGHTING
    // ============================================================
    
    // Helper: Parse currency string to float (e.g. "$1,200.50" -> 1200.50)
    const parseVal = (str) => {
        if(!str || str === "N/A" || str === "Requires Fetch" || str === "Unavailable") return Infinity;
        // Remove currency symbols, commas, and whitespace
        const clean = str.replace(/[^0-9.]/g, ''); 
        return parseFloat(clean) || Infinity;
    };

    const highlightCheapest = () => {
        let minVal = Infinity;
        
        // Find Minimum
        variants.forEach(v => {
            const val = parseVal(v.price);
            if (val < minVal) minVal = val;
        });

        if (minVal === Infinity) return;

        // Apply Green Styling
        variants.forEach((v, idx) => {
            const val = parseVal(v.price);
            const row = document.getElementById(`pricer-row-${idx}`);
            const priceDiv = document.getElementById(`pricer-val-${idx}`);

            if (val === minVal) {
                // HIGHLIGHT CHEAPEST
                priceDiv.style.color = "#007600"; // Amazon Green
                priceDiv.style.fontSize = "14px";
                priceDiv.innerText = `★ ${v.price}`;
                row.style.backgroundColor = "#efffe8"; // Light Green BG
                row.style.borderLeft = "4px solid #007600";
            } 
        });
    };

    const MAX_FETCH = 30; 
    const variantsToFetch = variants.filter(v => v.price === "Requires Fetch").slice(0, MAX_FETCH);
    let completed = 0;
    const progressEl = document.getElementById('pricer-progress');

    // Initial check (if current item is already cheapest)
    highlightCheapest();

    if (variantsToFetch.length > 0) {
        const updateRow = (index, price, isError = false) => {
            const el = document.getElementById(`pricer-val-${index}`);
            if(el) {
                el.innerText = price;
                el.style.color = isError ? "red" : "#333";
            }
        };

        const CHUNK_SIZE = 4;
        for (let i = 0; i < variantsToFetch.length; i += CHUNK_SIZE) {
            const chunk = variantsToFetch.slice(i, i + CHUNK_SIZE);
            await Promise.all(chunk.map(async (variant) => {
                const realIndex = variants.indexOf(variant);
                try {
                    const res = await fetch(variant.url);
                    if(!res.ok) throw new Error("Network");
                    const text = await res.text();
                    const p = extractPrice(text);
                    variant.price = (p !== "N/A") ? p : "Unavailable";
                    updateRow(realIndex, variant.price);
                } catch (err) {
                    variant.price = "Failed";
                    updateRow(realIndex, "Error", true);
                } finally {
                    completed++;
                    if(progressEl) progressEl.innerText = completed;
                }
            }));
            // Update highlights after every chunk for "live" feel
            highlightCheapest();
            await new Promise(r => setTimeout(r, 300));
        }
    }
    
    if(progressEl) progressEl.innerText = "Done";
    console.log("✅ Dashboard updated with lowest prices.");

})();