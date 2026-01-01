// ============ CONFIGURATION ============
const CONFIG = {
    pxPerYear: 4,           // Scale: pixels per year (adjustable via UI)
    minPxPerYear: 0.5,      // Minimum scale
    maxPxPerYear: 100,       // Maximum scale
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
 * Parse a date string and convert to HE
 * Supports: "2025", "2025 CE", "500 BCE", "44 BC", "HE 12025"
 * @param {string|number} dateInput 
 * @returns {number} Year in Holocene Era
 */
function parseDateToHE(dateInput) {
    if (typeof dateInput === 'number') {
        return dateInput; // Assume already in HE
    }
    
    const str = String(dateInput).trim().toUpperCase();
    
    // Check for "HE" prefix/suffix
    const heMatch = str.match(/^(?:HE\s*)?(\d+)(?:\s*HE)?$/);
    if (heMatch && str.includes('HE')) {
        return parseInt(heMatch[1], 10);
    }
    
    // Check for BCE/BC
    const bceMatch = str.match(/^(\d+)\s*(?:BCE|BC)$/);
    if (bceMatch) {
        return toHoloceneYear(parseInt(bceMatch[1], 10), 'BCE');
    }
    
    // Check for CE/AD
    const ceMatch = str.match(/^(\d+)\s*(?:CE|AD)?$/);
    if (ceMatch) {
        return toHoloceneYear(parseInt(ceMatch[1], 10), 'CE');
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
    
    const currentYear = getCurrentHoloceneYear();
    
    // Set track height
    const totalHeight = yearToPixels(currentYear);
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
    
    // Create century markers
    for (let year = 0; year <= currentYear; year += CONFIG.centuryInterval) {
        track.appendChild(createCenturyMarker(year));
    }
    
    // Create decade ticks (skip centuries)
    for (let year = CONFIG.decadeInterval; year <= currentYear; year += CONFIG.decadeInterval) {
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

function updateYearDisplay() {
    const track = document.getElementById('timelineTrack');
    const yearDisplay = document.getElementById('currentYear');
    const scrollProgress = document.getElementById('scrollProgress');
    
    if (!track || !yearDisplay) return;
    
    const currentYear = getCurrentHoloceneYear();
    const rect = track.getBoundingClientRect();
    const header = document.querySelector('header');
    const headerHeight = header ? header.offsetHeight : 0;
    
    const scrolledIntoTimeline = (headerHeight + 100) - rect.top;
    
    let displayYear = pixelsToYear(scrolledIntoTimeline);
    displayYear = Math.max(0, Math.min(currentYear, displayYear));
    
    yearDisplay.textContent = displayYear.toLocaleString();
    
    if (scrollProgress) {
        const scrollPercent = (displayYear / currentYear) * 100;
        scrollProgress.style.width = scrollPercent + '%';
    }
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
        const track = document.getElementById('timelineTrack');
        const rect = track.getBoundingClientRect();
        const header = document.querySelector('header');
        const headerHeight = header ? header.offsetHeight : 0;
        const currentScrollYear = pixelsToYear((headerHeight + 100) - rect.top);
        
        // Update scale
        CONFIG.pxPerYear = newScale;
        
        // Re-render
        renderTimeline();
        
        // Restore scroll position
        const newScrollTop = yearToPixels(currentScrollYear) + headerHeight - 100;
        window.scrollTo(0, newScrollTop);
        
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
            const header = document.querySelector('header');
            const headerHeight = header ? header.offsetHeight : 0;
            window.scrollTo({
                top: yearToPixels(newEvent.year) + headerHeight - 100,
                behavior: 'smooth'
            });
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
    
    // Setup scroll tracking
    updateYearDisplay();
    window.addEventListener('scroll', updateYearDisplay);
    window.addEventListener('resize', updateYearDisplay);
    
    console.log('Timeline initialized');
}

document.addEventListener('DOMContentLoaded', init);
