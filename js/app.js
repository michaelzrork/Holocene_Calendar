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
    
    // Merge all events
    STATE.allEvents = STATE.datasets
        .flatMap(dataset => dataset.events || [])
        .sort((a, b) => a.year - b.year);
    
    // Add dynamic "Today" event
    const todayEvent = {
        year: getCurrentHoloceneYear(),
        title: "Today",
        desc: "You are here!",
        isToday: true
    };
    STATE.allEvents.push(todayEvent);
    
    // Re-sort after adding Today
    STATE.allEvents.sort((a, b) => a.year - b.year);
    
    console.log(`Loaded ${STATE.datasets.length} datasets with ${STATE.allEvents.length} total events`);
}

// ============ RENDER FUNCTIONS ============

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
    const side = index % 2 === 0 ? 'left' : 'right';
    event.className = `event ${side}`;
    event.style.top = yearToPixels(eventData.year) + 'px';
    
    const dotColor = eventData.color || 'var(--gold-dim)';
    const yearLabel = formatYear(eventData.year, eventData.approximate);
    
    event.innerHTML = `
        <div class="content">
            <div class="connector" style="background: ${dotColor}"></div>
            <div class="event-year-marker"><span>${yearLabel}</span></div>
            <div class="event-header">
                <span class="event-title">${eventData.title}</span>
            </div>
            <p class="event-desc">${eventData.desc || ''}</p>
        </div>
    `;
    
    return event;
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
    
    // Create events (alternating left/right)
    console.log(`Rendering ${STATE.allEvents.length} events`);
    STATE.allEvents.forEach((eventData, index) => {
        const eventEl = createEvent(eventData, index);
        track.appendChild(eventEl);
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
    
    // Setup scroll tracking
    updateYearDisplay();
    window.addEventListener('scroll', updateYearDisplay);
    window.addEventListener('resize', updateYearDisplay);
    
    console.log('Timeline initialized');
}

document.addEventListener('DOMContentLoaded', init);
