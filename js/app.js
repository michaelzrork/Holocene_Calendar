// ============ CONFIGURATION ============
const CONFIG = {
    pxPerYear: 4,           // Scale: pixels per year (adjustable via UI)
    minPxPerYear: 0.5,      // Minimum scale
    maxPxPerYear: 100,      // Maximum scale
    centuryInterval: 100,   // Label every N years
    decadeInterval: 10,     // Tick every N years
};

// ============ STATE ============
const STATE = {
    datasets: [],           // Array of loaded datasets
    allEvents: [],          // Merged and sorted events from all datasets
    pointEvents: [],        // Events without endYear
    rangeEvents: [],        // Events with endYear
    categories: {},         // Category definitions from datasets
    activeFilters: new Set(), // Currently active category filters (empty = show all)
    filterMode: 'all',      // 'all' = show all, 'filtered' = show only active
    lockedEvent: null,      // Currently locked/focused event element
    hoveredEvent: null,     // Currently hovered event element (smart hover)
};

// ============ DATE CONVERSION UTILITIES ============

/**
 * Get the current year in Holocene Era
 * @returns {number} Current year in HE
 */
function getCurrentHoloceneYear() {
    return new Date().getFullYear() + 10000;
}

/**
 * Convert a year from CE/BCE to Holocene Era (HE)
 * @param {number} year - The year number
 * @param {string} era - 'CE', 'AD', 'BCE', or 'BC' (default: 'CE')
 * @returns {number} Year in Holocene Era
 */
function toHoloceneYear(year, era = 'CE') {
    era = era.toUpperCase();
    if (era === 'CE' || era === 'AD') {
        return year + 10000;
    } else if (era === 'BCE' || era === 'BC') {
        // 1 BCE = 10000 HE, 2 BCE = 9999 HE, etc.
        return 10001 - year;
    } else if (era === 'HE') {
        return year; // Already in HE
    }
    console.warn(`Unknown era "${era}", assuming CE`);
    return year + 10000;
}

/**
 * Convert a Holocene Era year to CE/BCE
 * @param {number} heYear - Year in Holocene Era
 * @returns {object} { year: number, era: 'CE' | 'BCE' }
 */
function fromHoloceneYear(heYear) {
    if (heYear >= 10001) {
        return { year: heYear - 10000, era: 'CE' };
    } else if (heYear === 10000) {
        return { year: 1, era: 'BCE' }; // There's no year 0
    } else {
        return { year: 10001 - heYear, era: 'BCE' };
    }
}

/**
 * Parse a date string - treats plain numbers as HE years
 * Only converts if explicitly marked as CE/AD/BCE/BC
 * Supports: "12025", "2025 CE", "500 BCE", "44 BC", "HE 12025", "-2025" (as BCE)
 * @param {string|number} dateInput 
 * @returns {number} Year in Holocene Era
 */
function parseDateToHE(dateInput) {
    if (typeof dateInput === 'number') {
        return dateInput; // Assume already in HE
    }
    
    const str = String(dateInput).trim().toUpperCase();
    
    // Check for "HE" prefix/suffix - already in HE
    const heMatch = str.match(/^(?:HE\s*)?(\d+)(?:\s*HE)?$/);
    if (heMatch && str.includes('HE')) {
        return parseInt(heMatch[1], 10);
    }
    
    // Check for BCE/BC - needs conversion
    const bceMatch = str.match(/^(\d+)\s*(?:BCE|BC)$/);
    if (bceMatch) {
        const year = parseInt(bceMatch[1], 10);
        // 0 BCE and 1 BCE both map to 10000 HE
        if (year === 0 || year === 1) {
            return 10000;
        }
        return toHoloceneYear(year, 'BCE');
    }
    
    // Check for explicit CE/AD - needs conversion
    const ceMatch = str.match(/^(\d+)\s*(?:CE|AD)$/);
    if (ceMatch) {
        const year = parseInt(ceMatch[1], 10);
        // 0 CE maps to 10000 HE (same as 1 BCE)
        if (year === 0) {
            return 10000;
        }
        return toHoloceneYear(year, 'CE');
    }
    
    // Check for negative number - treat as BCE
    const negativeMatch = str.match(/^-(\d+)$/);
    if (negativeMatch) {
        const year = parseInt(negativeMatch[1], 10);
        if (year === 0 || year === 1) {
            return 10000;
        }
        return toHoloceneYear(year, 'BCE');
    }
    
    // Plain number without era marker - treat as HE
    const plainMatch = str.match(/^(\d+)$/);
    if (plainMatch) {
        return parseInt(plainMatch[1], 10);
    }
    
    console.warn(`Could not parse date: "${dateInput}"`);
    return NaN;
}

/**
 * Parse a CE/BCE date string - assumes CE unless marked BCE/BC or negative
 * Does NOT accept HE years - use parseDateToHE for that
 * Supports: "2025", "2025 CE", "500 BCE", "44 BC", "-500" (as BCE)
 * @param {string|number} dateInput 
 * @returns {number} Year in Holocene Era
 */
function parseCEDateToHE(dateInput) {
    if (typeof dateInput === 'number') {
        return dateInput + 10000; // Assume CE
    }
    
    const str = String(dateInput).trim().toUpperCase();
    
    // Check for BCE/BC - needs conversion
    const bceMatch = str.match(/^(\d+)\s*(?:BCE|BC)$/);
    if (bceMatch) {
        const year = parseInt(bceMatch[1], 10);
        if (year === 0 || year === 1) {
            return 10000;
        }
        return toHoloceneYear(year, 'BCE');
    }
    
    // Check for explicit CE/AD
    const ceMatch = str.match(/^(\d+)\s*(?:CE|AD)$/);
    if (ceMatch) {
        const year = parseInt(ceMatch[1], 10);
        if (year === 0) {
            return 10000;
        }
        return toHoloceneYear(year, 'CE');
    }
    
    // Check for negative number - treat as BCE
    const negativeMatch = str.match(/^-(\d+)$/);
    if (negativeMatch) {
        const year = parseInt(negativeMatch[1], 10);
        if (year === 0 || year === 1) {
            return 10000;
        }
        return toHoloceneYear(year, 'BCE');
    }
    
    // Plain number - assume CE
    const plainMatch = str.match(/^(\d+)$/);
    if (plainMatch) {
        const year = parseInt(plainMatch[1], 10);
        if (year === 0) {
            return 10000;
        }
        return toHoloceneYear(year, 'CE');
    }
    
    console.warn(`Could not parse CE date: "${dateInput}"`);
    return NaN;
}

// ============ PIXEL/YEAR CONVERSION ============

function yearToPixels(year) {
    return year * CONFIG.pxPerYear;
}

function pixelsToYear(px) {
    return Math.floor(px / CONFIG.pxPerYear);
}

function yearToCE(year) {
    return Math.floor(year - 10000);
}

// ============ FORMATTING ============

function formatYear(year, approximate = false) {
    return `${year.toLocaleString()} HE`;
}

// ============ DATA LOADING ============

/**
 * Load a dataset from a JSON file
 * @param {string} url - Path to the JSON file
 * @returns {Promise<object>} The dataset object
 */
async function loadDataset(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        
        // Normalize events (ensure all years are in HE)
        if (data.events) {
            data.events = data.events.map(event => ({
                ...event,
                year: typeof event.year === 'number' ? event.year : parseDateToHE(event.year),
                sourceDataset: data.id,
                color: data.color || '#c9a227'
            }));
        }
        
        console.log(`Loaded dataset "${data.id}" with ${data.events?.length || 0} events`);
        return data;
    } catch (error) {
        console.error(`Failed to load dataset from ${url}:`, error);
        return null;
    }
}

/**
 * Load multiple datasets and merge them
 * @param {string[]} urls - Array of paths to JSON files
 */
async function loadAllDatasets(urls) {
    const results = await Promise.all(urls.map(url => loadDataset(url)));
    
    STATE.datasets = results.filter(d => d !== null);
    
    // Merge categories from all datasets
    STATE.categories = {};
    STATE.datasets.forEach(dataset => {
        if (dataset.categories) {
            STATE.categories = { ...STATE.categories, ...dataset.categories };
        }
    });
    
    // Merge all events
    STATE.allEvents = STATE.datasets
        .flatMap(dataset => dataset.events || [])
        .sort((a, b) => a.year - b.year);
    
    // Add dynamic "Today" event
    // (Removed - just using a marker instead)
    
    // Separate point events and range events
    STATE.pointEvents = STATE.allEvents.filter(e => !e.endYear);
    STATE.rangeEvents = STATE.allEvents.filter(e => e.endYear);
    
    // Pre-assign colors and sides to all events based on their position in the FULL sorted list
    // This ensures colors don't change when filtering
    const allSorted = [...STATE.allEvents].map(e => ({
        event: e,
        sortYear: e.endYear ? e.year + (e.endYear - e.year) / 2 : e.year
    })).sort((a, b) => a.sortYear - b.sortYear);
    
    allSorted.forEach(({ event }, index) => {
        event.colorIndex = index;
        event.side = index % 2 === 0 ? 'left' : 'right';
    });
    
    // Initialize filters - all categories active by default
    STATE.activeFilters = new Set(Object.keys(STATE.categories));
    
    // Build filter UI
    buildFilterUI();
    
    console.log(`Loaded ${STATE.datasets.length} datasets with ${STATE.pointEvents.length} point events and ${STATE.rangeEvents.length} range events`);
    console.log(`Categories: ${Object.keys(STATE.categories).join(', ')}`);
}

// ============ FILTER FUNCTIONS ============

/**
 * Build the filter UI checkboxes
 */
function buildFilterUI() {
    const filterOptions = document.getElementById('filterOptions');
    if (!filterOptions) return;
    
    filterOptions.innerHTML = '';
    
    Object.entries(STATE.categories).forEach(([key, category]) => {
        const label = document.createElement('label');
        label.className = 'filter-option';
        label.innerHTML = `
            <input type="checkbox" value="${key}" checked>
            <span class="filter-option-icon">${category.icon || ''}</span>
            <span class="filter-option-label">${category.name}</span>
        `;
        
        const checkbox = label.querySelector('input');
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                STATE.activeFilters.add(key);
            } else {
                STATE.activeFilters.delete(key);
            }
            updateFilterCount();
            renderTimeline();
        });
        
        filterOptions.appendChild(label);
    });
    
    updateFilterCount();
}

/**
 * Update the filter count display
 */
function updateFilterCount() {
    const filterCount = document.getElementById('filterCount');
    if (!filterCount) return;
    
    const total = Object.keys(STATE.categories).length;
    const active = STATE.activeFilters.size;
    
    if (active === total) {
        filterCount.textContent = '';
    } else {
        filterCount.textContent = `${active}/${total}`;
    }
}

/**
 * Setup filter controls (toggle, all/none buttons)
 */
function setupFilterControls() {
    const filterToggle = document.getElementById('filterToggle');
    const filterPanel = document.getElementById('filterPanel');
    const filterAll = document.getElementById('filterAll');
    const filterNone = document.getElementById('filterNone');
    
    if (filterToggle && filterPanel) {
        filterToggle.addEventListener('click', () => {
            filterPanel.classList.toggle('open');
        });
    }
    
    if (filterAll) {
        filterAll.addEventListener('click', () => {
            STATE.activeFilters = new Set(Object.keys(STATE.categories));
            document.querySelectorAll('#filterOptions input[type="checkbox"]').forEach(cb => {
                cb.checked = true;
            });
            updateFilterCount();
            renderTimeline();
        });
    }
    
    if (filterNone) {
        filterNone.addEventListener('click', () => {
            STATE.activeFilters.clear();
            document.querySelectorAll('#filterOptions input[type="checkbox"]').forEach(cb => {
                cb.checked = false;
            });
            updateFilterCount();
            renderTimeline();
        });
    }
}

/**
 * Check if an event passes the current filters
 * @param {object} event - The event to check
 * @returns {boolean} True if event should be shown
 */
function eventPassesFilter(event) {
    // If no categories defined on event, show it (uncategorized)
    if (!event.categories || event.categories.length === 0) return true;
    
    // If no filters active, hide all categorized events
    if (STATE.activeFilters.size === 0) return false;
    
    // Show if any of the event's categories are active
    return event.categories.some(cat => STATE.activeFilters.has(cat));
}

/**
 * Get filtered events
 */
function getFilteredEvents() {
    return {
        pointEvents: STATE.pointEvents.filter(eventPassesFilter),
        rangeEvents: STATE.rangeEvents.filter(eventPassesFilter)
    };
}

// ============ RENDER FUNCTIONS ============

// Color palette for ranges - NO GOLD (reserved for single events)
// Shuffled so adjacent ranges have contrasting colors
const RANGE_COLORS = [
    { bg: 'rgba(100, 149, 237, 0.3)', border: '#4a7dc4', text: '#6495ed' },  // blue
    { bg: 'rgba(255, 100, 50, 0.3)', border: '#cc5020', text: '#ff6432' },   // burnt orange
    { bg: 'rgba(138, 43, 226, 0.3)', border: '#6a20b0', text: '#8a2be2' },   // purple
    { bg: 'rgba(144, 238, 144, 0.3)', border: '#5a9a5a', text: '#90ee90' },  // green
    { bg: 'rgba(255, 105, 180, 0.3)', border: '#cc5090', text: '#ff69b4' },  // hot pink
    { bg: 'rgba(64, 224, 208, 0.3)', border: '#2a9a8a', text: '#40e0d0' },   // turquoise
    { bg: 'rgba(212, 68, 46, 0.3)', border: '#a33322', text: '#d4442e' },    // red
    { bg: 'rgba(255, 220, 50, 0.3)', border: '#ccaa20', text: '#ffdc32' },   // yellow
    { bg: 'rgba(221, 160, 221, 0.3)', border: '#9a6a9a', text: '#dda0dd' },  // plum
];

/**
 * Assign ranges to tracks (left or right side) to minimize overlap
 * Returns array of ranges with track assignments
 */
function assignRangeTracks(ranges) {
    // Sort by start year
    const sorted = [...ranges].sort((a, b) => a.year - b.year);
    
    // Track end years for each side
    const leftTracks = [];   // Array of track end years
    const rightTracks = [];  // Array of track end years
    
    return sorted.map((range, index) => {
        // Assign color based on index
        const colorIndex = index % RANGE_COLORS.length;
        const color = RANGE_COLORS[colorIndex];
        
        // Calculate duration for z-index (shorter = higher z-index)
        const duration = range.endYear - range.year;
        
        // Try to find a track on the left that's free
        let assignedSide = 'left';
        let assignedTrack = -1;
        
        // Check left tracks
        for (let i = 0; i < leftTracks.length; i++) {
            if (leftTracks[i] < range.year) {
                assignedTrack = i;
                leftTracks[i] = range.endYear;
                break;
            }
        }
        
        // If no free left track, check right
        if (assignedTrack === -1) {
            assignedSide = 'right';
            for (let i = 0; i < rightTracks.length; i++) {
                if (rightTracks[i] < range.year) {
                    assignedTrack = i;
                    rightTracks[i] = range.endYear;
                    break;
                }
            }
        }
        
        // If still no track, create new one
        if (assignedTrack === -1) {
            // Prefer the side with fewer tracks
            if (leftTracks.length <= rightTracks.length) {
                assignedSide = 'left';
                assignedTrack = leftTracks.length;
                leftTracks.push(range.endYear);
            } else {
                assignedSide = 'right';
                assignedTrack = rightTracks.length;
                rightTracks.push(range.endYear);
            }
        }
        
        return {
            ...range,
            side: assignedSide,
            track: assignedTrack,
            color,
            duration
        };
    });
}

function createRangeBar(rangeData, index, maxDuration) {
    const range = document.createElement('div');
    // Use pre-assigned side from data loading
    const side = rangeData.side || (index % 2 === 0 ? 'left' : 'right');
    range.className = `event range ${side}`;
    
    const startPx = yearToPixels(rangeData.year);
    const endPx = yearToPixels(rangeData.endYear);
    const heightPx = endPx - startPx;
    const midPx = startPx + (heightPx / 2);
    
    // Base z-index is 9 (set via CSS), DOM order handles stacking
    const zIndex = 9;
    
    // Position at midpoint like point events
    range.style.top = midPx + 'px';
    range.dataset.zIndex = zIndex;
    range.dataset.year = rangeData.sortYear || (rangeData.year + (rangeData.endYear - rangeData.year) / 2);
    
    const yearLabel = `${rangeData.year.toLocaleString()} – ${rangeData.endYear.toLocaleString()} HE`;
    
    // Use pre-assigned colorIndex from data loading
    const colorIndex = (rangeData.colorIndex !== undefined ? rangeData.colorIndex : index) % RANGE_COLORS.length;
    const color = RANGE_COLORS[colorIndex];
    const barBgColor = color.bg.replace('0.3', '0.6'); // More opaque for bar
    const barBgColorHover = color.bg.replace('0.3', '0.9'); // Even more opaque on hover
    const borderColor = color.border; // For card top border
    
    // Build source link if available
    const sourceLink = rangeData.source 
        ? `<a href="${rangeData.source}" target="_blank" rel="noopener noreferrer" class="event-source" style="color: ${color.text}">Learn more →</a>`
        : '';
    
    range.innerHTML = `
        <div class="content" style="border-top: 5px solid ${borderColor}">
            <div class="connector" style="background: ${color.border}"></div>
            <div class="range-bar-indicator" 
                 style="--bar-height: ${heightPx}px; 
                        --bar-bg: ${barBgColor}; 
                        --bar-bg-hover: ${barBgColorHover}; 
                        --bar-border: ${color.border};
                        background-color: var(--bar-bg); 
                        border-color: var(--bar-border);"></div>
            <div class="event-header">
                <span class="event-title">${rangeData.title}</span>
            </div>
            <span class="range-dates" style="color: ${color.text}">${yearLabel}</span>
            <p class="event-desc">${rangeData.desc || ''}</p>
            ${sourceLink}
        </div>
    `;
    
    // Click-to-lock behavior
    range.addEventListener('click', (e) => {
        e.stopPropagation();
        handleEventClick(range, zIndex);
    });
    
    // Hover is handled globally by setupSmartHover()
    
    return range;
}

function createCenturyMarker(year) {
    const marker = document.createElement('div');
    marker.className = 'century-marker';
    if (year % 1000 === 0) {
        marker.classList.add('millennium');
    }
    marker.style.top = yearToPixels(year) + 'px';
    marker.innerHTML = `<span>${year.toLocaleString()} HE</span>`;
    return marker;
}

function createDecadeMarker(year) {
    const marker = document.createElement('div');
    marker.className = 'decade-marker';
    marker.style.top = yearToPixels(year) + 'px';
    marker.innerHTML = `<span>${year.toLocaleString()} HE</span>`;
    return marker;
}

function createDecadeTick(year) {
    const tick = document.createElement('div');
    tick.className = 'decade-tick';
    tick.style.top = yearToPixels(year) + 'px';
    return tick;
}

function createYearTick(year) {
    const tick = document.createElement('div');
    tick.className = 'year-tick';
    tick.style.top = yearToPixels(year) + 'px';
    return tick;
}

function createEvent(eventData, index) {
    const event = document.createElement('div');
    
    // Use pre-assigned side from data loading
    const side = eventData.side || (index % 2 === 0 ? 'left' : 'right');
    event.className = `event ${side}`;
    event.style.top = yearToPixels(eventData.year) + 'px';
    
    // Base z-index is 9 (set via CSS), DOM order handles stacking
    const zIndex = 9;
    event.dataset.zIndex = zIndex;
    event.dataset.year = eventData.year;
    
    // Use pre-assigned colorIndex from data loading (same as ranges)
    const colorIndex = (eventData.colorIndex !== undefined ? eventData.colorIndex : index) % RANGE_COLORS.length;
    const color = RANGE_COLORS[colorIndex];
    const borderColor = color.border;
    const textColor = color.text;
    
    const yearLabel = formatYear(eventData.year, eventData.approximate);
    
    // Build source link if available
    const sourceLink = eventData.source 
        ? `<a href="${eventData.source}" target="_blank" rel="noopener noreferrer" class="event-source" style="color: ${textColor}">Learn more →</a>`
        : '';
    
    event.innerHTML = `
        <div class="content" style="border-top: 5px solid ${borderColor}">
            <div class="connector" style="background: ${borderColor}"></div>
            <div class="event-dot" style="background: ${borderColor}; box-shadow: 0 0 0 1px ${borderColor}"></div>
            <div class="event-header">
                <span class="event-title">${eventData.title}</span>
            </div>
            <span class="event-year-text" style="color: ${textColor}">${yearLabel}</span>
            <p class="event-desc">${eventData.desc || ''}</p>
            ${sourceLink}
        </div>
    `;
    
    // Store color for hover state
    event.dataset.color = borderColor;
    
    // Click-to-lock behavior
    event.addEventListener('click', (e) => {
        e.stopPropagation();
        handleEventClick(event, zIndex);
    });
    
    // Hover is handled globally by setupSmartHover()
    
    return event;
}

/**
 * Handle click-to-lock behavior for events
 */
function handleEventClick(eventEl, originalZIndex) {
    // If clicking the already-locked event, unlock it and collapse
    if (STATE.lockedEvent === eventEl) {
        eventEl.classList.remove('locked');
        eventEl.classList.remove('hovered');
        eventEl.style.zIndex = '';
        STATE.lockedEvent = null;
        // Also clear from hoveredEvent so it doesn't immediately re-hover
        STATE.hoveredEvent = null;
        return;
    }
    
    // Unlock any previously locked event
    if (STATE.lockedEvent) {
        STATE.lockedEvent.classList.remove('locked');
        STATE.lockedEvent.style.zIndex = '';
    }
    
    // Lock this event
    eventEl.classList.add('locked');
    eventEl.style.zIndex = 500;
    STATE.lockedEvent = eventEl;
}

/**
 * Setup click-away-to-unlock on the document
 */
function setupClickAwayUnlock() {
    document.addEventListener('click', (e) => {
        if (STATE.lockedEvent && !STATE.lockedEvent.contains(e.target)) {
            STATE.lockedEvent.classList.remove('locked');
            STATE.lockedEvent.classList.remove('hovered');
            STATE.lockedEvent.style.zIndex = '';
            STATE.lockedEvent = null;
            STATE.hoveredEvent = null;
        }
    });
}

/**
 * Setup smart hover - when mouse moves over stacked events, creates a sweep-through
 * effect in both directions. Moving down reveals newer cards (later in DOM),
 * moving up reveals older cards (earlier in DOM).
 */
function setupSmartHover() {
    const track = document.getElementById('timelineTrack');
    if (!track) return;
    
    let lastY = null;
    
    document.addEventListener('mousemove', (e) => {
        // Don't change hover if an event is locked
        if (STATE.lockedEvent) return;
        
        // Determine direction of mouse movement
        const movingDown = lastY !== null && e.clientY > lastY;
        const movingUp = lastY !== null && e.clientY < lastY;
        lastY = e.clientY;
        
        // Get all event elements in the track
        const allEvents = track.querySelectorAll('.event');
        
        // Find which events contain the mouse point
        const eventsUnderCursor = [];
        
        allEvents.forEach(eventEl => {
            const rect = eventEl.getBoundingClientRect();
            const isUnder = (e.clientX >= rect.left && e.clientX <= rect.right &&
                            e.clientY >= rect.top && e.clientY <= rect.bottom);
            
            if (isUnder) {
                eventsUnderCursor.push(eventEl);
            }
        });
        
        // If no events under cursor, clear hover
        if (eventsUnderCursor.length === 0) {
            if (STATE.hoveredEvent) {
                STATE.hoveredEvent.classList.remove('hovered');
                STATE.hoveredEvent.style.zIndex = '';
                STATE.hoveredEvent = null;
            }
            return;
        }
        
        // Determine which event to show based on direction
        let topmostEvent = null;
        
        if (eventsUnderCursor.length === 1) {
            // Only one event, show it
            topmostEvent = eventsUnderCursor[0];
        } else {
            // Multiple events - pick based on movement direction
            const currentIdx = STATE.hoveredEvent ? eventsUnderCursor.indexOf(STATE.hoveredEvent) : -1;
            
            if (currentIdx === -1) {
                // Not currently hovering any in this stack - show topmost (last in DOM)
                topmostEvent = eventsUnderCursor[eventsUnderCursor.length - 1];
            } else if (movingDown) {
                // Moving down through timeline - go to next in DOM order (newer)
                const nextIdx = Math.min(currentIdx + 1, eventsUnderCursor.length - 1);
                topmostEvent = eventsUnderCursor[nextIdx];
            } else if (movingUp) {
                // Moving up through timeline - go to previous in DOM order (older)
                const prevIdx = Math.max(currentIdx - 1, 0);
                topmostEvent = eventsUnderCursor[prevIdx];
            } else {
                // No movement, keep current
                topmostEvent = STATE.hoveredEvent;
            }
        }
        
        // If same as current hover, do nothing
        if (topmostEvent === STATE.hoveredEvent) return;
        
        // Remove hover from previous
        if (STATE.hoveredEvent) {
            STATE.hoveredEvent.classList.remove('hovered');
            STATE.hoveredEvent.style.zIndex = '';
        }
        
        // Add hover to new
        if (topmostEvent) {
            topmostEvent.classList.add('hovered');
            topmostEvent.style.zIndex = topmostEvent.classList.contains('range') ? 200 : 100;
        }
        
        STATE.hoveredEvent = topmostEvent;
    });
    
    // Clear hover when mouse leaves the document
    document.addEventListener('mouseleave', () => {
        if (STATE.hoveredEvent && !STATE.lockedEvent) {
            STATE.hoveredEvent.classList.remove('hovered');
            STATE.hoveredEvent.style.zIndex = '';
            STATE.hoveredEvent = null;
        }
        lastY = null;
    });
}

// ============ MAIN RENDER ============

function renderTimeline() {
    const track = document.getElementById('timelineTrack');
    const container = document.querySelector('.timeline-container');
    if (!track) {
        console.error('Timeline track element not found');
        return;
    }
    
    track.innerHTML = '';
    
    const currentYear = getCurrentHoloceneYear();
    
    // Set track height to current year
    const totalHeight = yearToPixels(currentYear);
    track.style.height = totalHeight + 'px';
    
    // Add bottom padding to container so we can scroll the last year to the reference point
    // Padding = viewport height - reference point position
    // Reference point is at min(50% viewport, trackOffset), so max padding needed is 50% viewport
    if (container) {
        container.style.paddingBottom = '50vh';
    }
    
    // Update scale display
    const scaleDisplay = document.getElementById('scaleDisplay');
    if (scaleDisplay) {
        scaleDisplay.textContent = `100 years = ${Math.round(CONFIG.pxPerYear * 100)} pixels`;
    }
    
    // Update scale slider
    const scaleSlider = document.getElementById('scaleSlider');
    if (scaleSlider) {
        scaleSlider.value = CONFIG.pxPerYear;
    }
    
    const scaleValue = document.getElementById('scaleValue');
    if (scaleValue) {
        scaleValue.textContent = `${CONFIG.pxPerYear}px/yr`;
    }
    
    const scaleInput = document.getElementById('scaleInput');
    if (scaleInput && !isEditingScale) {
        scaleInput.value = CONFIG.pxPerYear;
    }
    
    // Create century markers up to current year
    for (let year = 0; year <= currentYear; year += CONFIG.centuryInterval) {
        track.appendChild(createCenturyMarker(year));
    }
    
    // Add "Today" marker at current year (styled like millennium)
    const todayMarker = document.createElement('div');
    todayMarker.className = 'century-marker millennium today-marker';
    todayMarker.style.top = yearToPixels(currentYear) + 'px';
    todayMarker.innerHTML = `<span>${currentYear.toLocaleString()} HE</span>`;
    track.appendChild(todayMarker);
    
    // Create decade markers/ticks (skip centuries)
    // At high zoom (>10px/yr), show labeled decade markers; otherwise just ticks
    const useDecadeMarkers = CONFIG.pxPerYear > 10;
    for (let year = CONFIG.decadeInterval; year <= currentYear; year += CONFIG.decadeInterval) {
        if (year % CONFIG.centuryInterval !== 0) {
            if (useDecadeMarkers) {
                track.appendChild(createDecadeMarker(year));
            } else {
                track.appendChild(createDecadeTick(year));
            }
        }
    }
    
    // At high zoom (>10px/yr), also show year ticks
    if (CONFIG.pxPerYear > 10) {
        for (let year = 1; year <= currentYear; year++) {
            // Skip decades and centuries
            if (year % CONFIG.decadeInterval !== 0) {
                track.appendChild(createYearTick(year));
            }
        }
    }
    
    // Create all events together (point + range) for proper alternation
    // Sort by midpoint year for ranges (visual position determines stacking)
    // Use filtered events
    const { pointEvents, rangeEvents } = getFilteredEvents();
    
    const allEventsForRender = [
        ...pointEvents.map(e => ({ ...e, isRange: false, sortYear: e.year })),
        ...rangeEvents.map(e => ({ ...e, isRange: true, sortYear: e.year + (e.endYear - e.year) / 2 }))
    ].sort((a, b) => a.sortYear - b.sortYear);
    
    const maxDuration = rangeEvents.length > 0 
        ? Math.max(...rangeEvents.map(r => r.endYear - r.year))
        : 1;
    
    console.log(`Rendering ${allEventsForRender.length} total events (${pointEvents.length} point, ${rangeEvents.length} range)`);
    
    // Clear locked event since we're re-rendering
    STATE.lockedEvent = null;
    
    // Events are rendered in chronological order (already sorted by sortYear)
    // DOM order determines stacking: later elements (newer events) appear on top
    // Base z-index is 9 (below markers at 10), hover/locked go higher
    
    allEventsForRender.forEach((eventData, index) => {
        if (eventData.isRange) {
            const rangeEl = createRangeBar(eventData, index, maxDuration);
            track.appendChild(rangeEl);
        } else {
            const eventEl = createEvent(eventData, index);
            track.appendChild(eventEl);
        }
    });
}

// ============ SCROLL TRACKING ============

// Track if user is currently editing the year input
let isEditingYear = false;

/**
 * Get the offset from the top of the page to the top of the timeline track
 * @returns {number} Pixels from page top to track top
 */
function getTrackOffset() {
    const track = document.getElementById('timelineTrack');
    if (!track) return 0;
    
    // Get the track's position relative to the document (not viewport)
    const rect = track.getBoundingClientRect();
    return rect.top + window.scrollY;
}

/**
 * Get the reference point (in viewport pixels from top) where we measure/scroll to years
 * This is 50% of viewport height, but clamped to not go below where year 0 lands on first load
 * @returns {number} Pixels from top of viewport to the reference line
 */
function getReferencePoint() {
    const viewportHalf = window.innerHeight / 2;
    const trackOffset = getTrackOffset();
    
    // Reference = min(viewportHalf, trackOffset)
    // This ensures we never set a reference point below where year 0 can physically be
    return Math.min(viewportHalf, trackOffset);
}

/**
 * Get the year at the reference point in the viewport
 * @returns {number} Year in HE at the reference line
 */
function getYearAtReference() {
    const track = document.getElementById('timelineTrack');
    if (!track) return 0;
    
    const trackOffset = getTrackOffset();
    const referencePoint = getReferencePoint();
    
    // How many pixels into the track is our reference point?
    const pixelsIntoTrack = window.scrollY + referencePoint - trackOffset;
    
    return Math.max(0, pixelsToYear(pixelsIntoTrack));
}

function updateYearDisplay() {
    const yearInput = document.getElementById('currentYear');
    const yearInputCE = document.getElementById('currentYearCE');
    const setBCE = document.getElementById('set-bce');
    const scrollProgress = document.getElementById('scrollProgress');
    
    if (!yearInput) return;
    
    // Don't update if user is editing
    if (isEditingYear) return;
    
    const currentYear = getCurrentHoloceneYear();
    let displayYear = getYearAtReference();
    displayYear = Math.min(currentYear, displayYear);
    
    yearInput.value = displayYear.toLocaleString();
    
    // Update CE/BCE display
    const converted = fromHoloceneYear(displayYear);
    yearInputCE.value = converted.year;
    setBCE.textContent = converted.era === 'BCE' ? 'BCE' : '\u00A0CE';
    
    if (scrollProgress) {
        const scrollPercent = (displayYear / currentYear) * 100;
        scrollProgress.style.width = scrollPercent + '%';
    }
}

/**
 * Scroll to a specific year on the timeline
 * @param {number} year - Year in HE to scroll to
 */
function scrollToYear(year) {
    const currentYear = getCurrentHoloceneYear();
    const clampedYear = Math.max(0, Math.min(currentYear, year));
    
    const trackOffset = getTrackOffset();
    const referencePoint = getReferencePoint();
    
    // Scroll so the year lands at the reference point
    const targetScroll = trackOffset + yearToPixels(clampedYear) - referencePoint;
    
    window.scrollTo({
        top: Math.max(0, targetScroll),
        behavior: 'smooth'
    });
}

/**
 * Setup the year input for user interaction
 */
function setupYearInput() {
    const yearInput = document.getElementById('currentYear');
    const yearInputCE = document.getElementById('currentYearCE');
    
    // ===== HE Year Input =====
    if (yearInput) {
        yearInput.addEventListener('focus', () => {
            isEditingYear = true;
            yearInput.select();
        });
        
        yearInput.addEventListener('blur', () => {
            isEditingYear = false;
            updateYearDisplay();
        });
        
        yearInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const inputValue = yearInput.value.replace(/,/g, '').trim();
                const targetYear = parseDateToHE(inputValue);
                
                if (!isNaN(targetYear)) {
                    isEditingYear = false;
                    yearInput.blur();
                    scrollToYear(targetYear);
                } else {
                    yearInput.style.color = '#d4442e';
                    setTimeout(() => { yearInput.style.color = ''; }, 500);
                }
            } else if (e.key === 'Escape') {
                isEditingYear = false;
                yearInput.blur();
                updateYearDisplay();
            }
        });
    }
    
    // ===== CE/BCE Year Input =====
    if (yearInputCE) {
        yearInputCE.addEventListener('focus', () => {
            isEditingYear = true;
            // Append the current era to the value so user knows context
            const currentEra = document.getElementById('set-bce').textContent.trim();
            const currentValue = yearInputCE.value.replace(/,/g, '');
            yearInputCE.value = `${currentValue} ${currentEra}`;
            yearInputCE.select();
        });
        
        yearInputCE.addEventListener('blur', () => {
            isEditingYear = false;
            updateYearDisplay();
        });
        
        yearInputCE.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const inputValue = yearInputCE.value.replace(/,/g, '').trim();
                const targetYear = parseCEDateToHE(inputValue);
                
                if (!isNaN(targetYear)) {
                    isEditingYear = false;
                    yearInputCE.blur();
                    scrollToYear(targetYear);
                } else {
                    yearInputCE.style.color = '#d4442e';
                    setTimeout(() => { yearInputCE.style.color = ''; }, 500);
                }
            } else if (e.key === 'Escape') {
                isEditingYear = false;
                yearInputCE.blur();
                updateYearDisplay();
            }
        });
    }
}

// ============ SCALE CONTROL ============

let isEditingScale = false;

function applyScale(newScale) {
    // Remember scroll position as a year
    const currentScrollYear = getYearAtReference();
    
    // Update scale
    CONFIG.pxPerYear = newScale;
    
    // Re-render
    renderTimeline();
    
    // Restore scroll position
    const trackOffset = getTrackOffset();
    const referencePoint = getReferencePoint();
    const newScrollTop = trackOffset + yearToPixels(currentScrollYear) - referencePoint;
    window.scrollTo(0, Math.max(0, newScrollTop));
    
    // Update display
    updateYearDisplay();
}

function setupScaleControl() {
    const slider = document.getElementById('scaleSlider');
    const scaleInput = document.getElementById('scaleInput');
    
    if (slider) {
        slider.min = CONFIG.minPxPerYear;
        slider.max = CONFIG.maxPxPerYear;
        slider.step = 0.5;
        slider.value = CONFIG.pxPerYear;
        
        slider.addEventListener('input', (e) => {
            const newScale = parseFloat(e.target.value);
            if (scaleInput) scaleInput.value = newScale;
            applyScale(newScale);
        });
    }
    
    if (scaleInput) {
        scaleInput.value = CONFIG.pxPerYear;
        
        scaleInput.addEventListener('focus', () => {
            isEditingScale = true;
            scaleInput.select();
        });
        
        scaleInput.addEventListener('blur', () => {
            isEditingScale = false;
            // Validate and apply
            let newScale = parseFloat(scaleInput.value);
            if (isNaN(newScale)) newScale = CONFIG.pxPerYear;
            newScale = Math.max(CONFIG.minPxPerYear, Math.min(CONFIG.maxPxPerYear, newScale));
            scaleInput.value = newScale;
            if (slider) slider.value = newScale;
            applyScale(newScale);
        });
        
        scaleInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                scaleInput.blur();
            } else if (e.key === 'Escape') {
                scaleInput.value = CONFIG.pxPerYear;
                isEditingScale = false;
                scaleInput.blur();
            }
        });
    }
}

// ============ PUBLIC API ============

window.timelineAPI = {
    // Add a single event
    addEvent(year, title, desc, approximate = false, color = null) {
        const newEvent = { 
            year: typeof year === 'number' ? year : parseDateToHE(year), 
            title, 
            desc, 
            approximate,
            color: color || '#d4442e', // User events get accent color
            sourceDataset: 'user'
        };
        STATE.allEvents.push(newEvent);
        STATE.allEvents.sort((a, b) => a.year - b.year);
        renderTimeline();
        
        // Scroll to the new event
        setTimeout(() => {
            scrollToYear(newEvent.year);
        }, 100);
        
        return newEvent;
    },
    
    // Load additional dataset
    async loadDataset(url) {
        const dataset = await loadDataset(url);
        if (dataset) {
            STATE.datasets.push(dataset);
            STATE.allEvents = STATE.datasets
                .flatMap(d => d.events || [])
                .sort((a, b) => a.year - b.year);
            renderTimeline();
        }
        return dataset;
    },
    
    // Get current state
    getEvents: () => [...STATE.allEvents],
    getDatasets: () => [...STATE.datasets],
    getConfig: () => ({ ...CONFIG }),
    getCurrentYear: getCurrentHoloceneYear,
    
    // Set scale
    setScale(pxPerYear) {
        CONFIG.pxPerYear = Math.max(CONFIG.minPxPerYear, Math.min(CONFIG.maxPxPerYear, pxPerYear));
        renderTimeline();
    },
    
    // Scroll to a year
    scrollToYear,
    
    // Date conversion utilities
    toHoloceneYear,
    fromHoloceneYear,
    parseDateToHE,
};

// ============ INITIALIZE ============

async function init() {
    console.log('Initializing timeline...');
    console.log('Current Holocene Year:', getCurrentHoloceneYear());
    
    // Load core dataset
    await loadAllDatasets(['events/core.json']);
    
    // Render timeline
    renderTimeline();
    
    // Setup controls
    setupScaleControl();
    setupYearInput();
    setupNavButtons();
    setupFilterControls();
    setupClickAwayUnlock();
    setupSmartHover();
    
    // Setup scroll tracking
    updateYearDisplay();
    window.addEventListener('scroll', updateYearDisplay);
    window.addEventListener('resize', updateYearDisplay);
    
    console.log('Timeline initialized');
}

function setupNavButtons() {
    const jumpToTop = document.getElementById('jumpToTop');
    const jumpToBottom = document.getElementById('jumpToBottom');
    const controlsToggle = document.getElementById('controlsToggle');
    const controlsWrapper = document.getElementById('controlsWrapper');
    
    if (jumpToTop) {
        jumpToTop.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }
    
    if (jumpToBottom) {
        jumpToBottom.addEventListener('click', () => {
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        });
    }
    
    // Mobile controls toggle
    if (controlsToggle && controlsWrapper) {
        controlsToggle.addEventListener('click', () => {
            controlsToggle.classList.toggle('active');
            controlsWrapper.classList.toggle('open');
        });
    }
}

document.addEventListener('DOMContentLoaded', init);
