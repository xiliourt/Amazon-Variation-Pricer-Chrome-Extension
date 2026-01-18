(async function() {
    console.log("🚀 Starting Extraction & UI Render...");

    // ============================================================
    // 1. EXTRACTION LOGIC (The one that works)
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
    // 2. UI CREATION (The "Neat Display")
    // ============================================================
    
    // Create container
    const dashboardId = 'amazon-pricer-dashboard';
    const oldDash = document.getElementById(dashboardId);
    if (oldDash) oldDash.remove();

    const dashboard = document.createElement('div');
    dashboard.id = dashboardId;
    dashboard.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        width: 320px;
        max-height: 80vh;
        background: white;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        border-radius: 8px;
        z-index: 99999;
        font-family: "Amazon Ember", Arial, sans-serif;
        display: flex;
        flex-direction: column;
        border: 1px solid #e7e7e7;
        overflow: hidden;
    `;

    // Header
    const header = document.createElement('div');
    header.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong>Found ${variants.length} Variations</strong>
            <button id="pricer-close" style="background:none; border:none; cursor:pointer; font-size:16px;">&times;</button>
        </div>
        <div style="font-size: 11px; color: #666; margin-top: 4px;">Fetching prices... <span id="pricer-progress">0</span>/${variants.length}</div>
    `;
    header.style.cssText = `
        padding: 12px;
        background: #f7f7f7;
        border-bottom: 1px solid #ddd;
    `;
    dashboard.appendChild(header);

    // List Container
    const list = document.createElement('div');
    list.style.cssText = `
        overflow-y: auto;
        flex-grow: 1;
        padding: 0;
    `;
    dashboard.appendChild(list);

    document.body.appendChild(dashboard);
    document.getElementById('pricer-close').onclick = () => dashboard.remove();

    // Helper to add row
    const addRow = (variant, index) => {
        const row = document.createElement('div');
        row.id = `pricer-row-${index}`;
        row.style.cssText = `
            padding: 8px 12px;
            border-bottom: 1px solid #eee;
            font-size: 13px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;
        row.innerHTML = `
            <div style="width: 65%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${variant.name}">
                ${variant.name}
            </div>
            <div id="pricer-val-${index}" style="font-weight: bold; color: #555;">
                ${variant.price === "Requires Fetch" ? "..." : variant.price}
            </div>
        `;
        
        // Highlight current item
        if(variant.asin === currentAsin) {
            row.style.backgroundColor = "#e6f3ff";
            row.style.borderLeft = "4px solid #007185";
        }

        // Click to visit
        row.style.cursor = "pointer";
        row.onclick = () => window.location.href = variant.url;
        
        list.appendChild(row);
    };

    // Render initial list
    variants.forEach((v, i) => addRow(v, i));

    // ============================================================
    // 3. BACKGROUND FETCHING & UPDATING UI
    // ============================================================
    
    const MAX_FETCH = 20; 
    const variantsToFetch = variants.filter(v => v.price === "Requires Fetch").slice(0, MAX_FETCH);
    let completed = 0;
    const progressEl = document.getElementById('pricer-progress');

    if (variantsToFetch.length > 0) {
        
        // Helper to update specific row
        const updateRow = (index, price, isError = false) => {
            const el = document.getElementById(`pricer-val-${index}`);
            if(el) {
                el.innerText = price;
                el.style.color = isError ? "red" : "#B12704"; // Amazon Red
            }
        };

        // Fetch loop
        const CHUNK_SIZE = 4; // Slightly faster for dashboard
        for (let i = 0; i < variantsToFetch.length; i += CHUNK_SIZE) {
            const chunk = variantsToFetch.slice(i, i + CHUNK_SIZE);
            
            await Promise.all(chunk.map(async (variant) => {
                // Find original index
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
            
            // Short delay
            await new Promise(r => setTimeout(r, 300));
        }
    }
    
    if(progressEl) progressEl.innerText = "Done";
    console.log("✅ Dashboard updated.");

})();