// ============ CONFIGURATION ============
const CONFIG = {
    pxPerYear: 4,           // Scale: pixels per year (adjustable via UI)
    minPxPerYear: 0.5,      // Minimum scale
    maxPxPerYear: 100,      // Maximum scale
    centuryInterval: 100,   // Label every N years
    decadeInterval: 10,     // Tick every N years
    futureBuffer: 100,      // Years to show past current year
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
 * Get the maximum year shown on timeline (current + buffer)
 * @returns {number} Max year in HE
 */
function getTimelineEndYear() {
    return getCurrentHoloceneYear() + CONFIG.futureBuffer;
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

// ============ PIXEL/YEAR CONVERSION ============

function yearToPixels(year) {
    return year * CONFIG.pxPerYear;
}

function pixelsToYear(px) {
    return Math.floor(px / CONFIG.pxPerYear);
}

// ============ FORMATTING ============

function formatYear(year, approximate = false) {
    const prefix = approximate ? "~" : "";
    return `${prefix}${year.toLocaleString()} HE`;
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

function createDecadeTick(year) {
    const tick = document.createElement('div');
    tick.className = 'decade-tick';
    tick.style.top = yearToPixels(year) + 'px';
    return tick;
}

function createEvent(eventData, index) {
    const event = document.createElement('div');
    const side = index % 2 === 0 ? 'left' : 'right';
    event.className = `event ${side}`;
    event.style.top = yearToPixels(eventData.year) + 'px';
    
    const colorStyle = eventData.color ? `background: ${eventData.color}` : '';
    const dotColor = eventData.color || 'var(--gold-dim)';
    
    event.innerHTML = `
        <div class="connector" style="background: ${dotColor}"></div>
        <div class="dot" style="border-color: ${dotColor}"></div>
        <div class="content">
            <div class="event-header">
                ${eventData.color ? `<span class="category-dot" style="${colorStyle}"></span>` : ''}
                <span class="event-year">${formatYear(eventData.year, eventData.approximate)}</span>
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
    if (!track) {
        console.error('Timeline track element not found');
        return;
    }
    
    track.innerHTML = '';
    
    const endYear = getTimelineEndYear();
    
    // Set track height (includes future buffer)
    const totalHeight = yearToPixels(endYear);
    track.style.height = totalHeight + 'px';
    
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
    
    // Create century markers (include future)
    for (let year = 0; year <= endYear; year += CONFIG.centuryInterval) {
        track.appendChild(createCenturyMarker(year));
    }
    
    // Create decade ticks (skip centuries)
    for (let year = CONFIG.decadeInterval; year <= endYear; year += CONFIG.decadeInterval) {
        if (year % CONFIG.centuryInterval !== 0) {
            track.appendChild(createDecadeTick(year));
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
    
    // Where would year 0 be on first load (no scrolling)?
    // That's just trackOffset pixels from the top of the page
    // On first load, scrollY = 0, so year 0 is at trackOffset in viewport
    // But we want the reference point relative to current viewport
    // The reference should be min(50% viewport, trackOffset) from viewport top
    // But trackOffset is page-relative... we need viewport-relative.
    
    // Actually simpler: the reference line should be at a fixed viewport position
    // that is the minimum of (50% viewport height) and (where track starts when at top of page)
    // Since trackOffset is where the track starts on the page, if we're scrolled to top (scrollY=0),
    // the track top is at trackOffset from viewport top.
    
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
    // Reference point is referencePoint pixels from viewport top
    // Track starts at (trackOffset - scrollY) from viewport top
    // So pixels into track = referencePoint - (trackOffset - scrollY)
    //                      = referencePoint - trackOffset + scrollY
    const pixelsIntoTrack = window.scrollY + referencePoint - trackOffset;
    
    return Math.max(0, pixelsToYear(pixelsIntoTrack));
}

function updateYearDisplay() {
    const yearInput = document.getElementById('currentYear');
    const scrollProgress = document.getElementById('scrollProgress');
    
    if (!yearInput) return;
    
    // Don't update if user is editing
    if (isEditingYear) return;
    
    const endYear = getTimelineEndYear();
    let displayYear = getYearAtReference();
    displayYear = Math.min(endYear, displayYear);
    
    yearInput.value = displayYear.toLocaleString();
    
    if (scrollProgress) {
        const scrollPercent = (displayYear / endYear) * 100;
        scrollProgress.style.width = scrollPercent + '%';
    }
}

/**
 * Scroll to a specific year on the timeline
 * @param {number} year - Year in HE to scroll to
 */
function scrollToYear(year) {
    const endYear = getTimelineEndYear();
    const clampedYear = Math.max(0, Math.min(endYear, year));
    
    const trackOffset = getTrackOffset();
    const referencePoint = getReferencePoint();
    
    // We want the year to land at the reference point
    // Reference point is referencePoint pixels from viewport top
    // Year is at yearToPixels(year) pixels into the track
    // Track starts at trackOffset from page top
    // So year is at (trackOffset + yearToPixels(year)) from page top
    // We want that to be at referencePoint from viewport top
    // So: scrollY + referencePoint = trackOffset + yearToPixels(year)
    // scrollY = trackOffset + yearToPixels(year) - referencePoint
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
    if (!yearInput) return;
    
    // When user focuses the input
    yearInput.addEventListener('focus', () => {
        isEditingYear = true;
        yearInput.select(); // Select all text for easy replacement
    });
    
    // When user leaves the input without pressing Enter
    yearInput.addEventListener('blur', () => {
        isEditingYear = false;
        updateYearDisplay(); // Reset to current scroll position
    });
    
    // When user presses Enter
    yearInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            
            // Parse the input value (remove commas)
            // Plain numbers are treated as HE, no conversion
            const inputValue = yearInput.value.replace(/,/g, '').trim();
            const targetYear = parseDateToHE(inputValue);
            
            if (!isNaN(targetYear)) {
                isEditingYear = false;
                yearInput.blur();
                scrollToYear(targetYear);
            } else {
                // Invalid input - flash red briefly
                yearInput.style.color = '#d4442e';
                setTimeout(() => {
                    yearInput.style.color = '';
                }, 500);
            }
        } else if (e.key === 'Escape') {
            isEditingYear = false;
            yearInput.blur();
            updateYearDisplay();
        }
    });
}

// ============ SCALE CONTROL ============

function setupScaleControl() {
    const slider = document.getElementById('scaleSlider');
    if (!slider) return;
    
    slider.min = CONFIG.minPxPerYear;
    slider.max = CONFIG.maxPxPerYear;
    slider.step = 0.5;
    slider.value = CONFIG.pxPerYear;
    
    slider.addEventListener('input', (e) => {
        const newScale = parseFloat(e.target.value);
        
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
    });
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
    getTimelineEndYear,
    
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
    console.log('Timeline ends at:', getTimelineEndYear());
    
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
