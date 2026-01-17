// ============ CONFIGURATION ============
const CONFIG = {
    pxPerYear: 5,           // Scale: pixels per year (adjustable via UI)
    minPxPerYear: 0.5,      // Minimum scale
    maxPxPerYear: 20,       // Maximum scale
    centuryInterval: 100,   // Label every N years
    decadeInterval: 10,     // Tick every N years
};

// ============ STATE ============
const STATE = {
    datasets: [],           // Array of loaded datasets
    allEvents: [],          // Merged and sorted events from all datasets
    pointEvents: [],        // Events without endYear
    rangeEvents: [],        // Events with endYear
    ageEvents: [],          // Events marked as ages (isAge: true)
    categories: {},         // Category definitions from datasets
    activeFilters: new Set(), // Currently active category filters (empty = show all)
    filterMode: 'all',      // 'all' = show all, 'filtered' = show only active
    lockedEvent: null,      // Currently locked/focused event element
    hoveredEvent: null,     // Currently hovered event element (smart hover)
    spreadRanges: true,     // Whether to spread ranges into channels
    showAges: true,         // Whether to show technological ages
};

// ============ CHANNEL SYSTEM FOR RANGES ============
const CHANNEL_CONFIG = {
    channelWidth: 20,       // Pixels per channel (range bar width 12px + 8px gap)
    maxChannels: 15,
};

// ============ CACHED CSS VALUES (for performance) ============
// Cache expensive getComputedStyle calls - initialized once on load
let CACHED_CSS = null;
function getCachedCSS() {
    if (!CACHED_CSS) {
        const rootStyles = getComputedStyle(document.documentElement);
        CACHED_CSS = {
            dotInnerSize: parseFloat(rootStyles.getPropertyValue('--dot-inner-size')) || 10,
            dotBorder: parseFloat(rootStyles.getPropertyValue('--dot-border')) || 2,
            dotOutline: parseFloat(rootStyles.getPropertyValue('--dot-outline')) || 1,
        };
        // Pre-calculate derived values
        CACHED_CSS.dotTotalDiameter = CACHED_CSS.dotInnerSize + (CACHED_CSS.dotBorder * 2) + (CACHED_CSS.dotOutline * 2);
        CACHED_CSS.dotOffset = CACHED_CSS.dotTotalDiameter / 2;
    }
    return CACHED_CSS;
}

// ============ PERFORMANCE UTILITIES ============
/**
 * Throttle function - limits how often a function can be called
 * Uses requestAnimationFrame for smooth visual updates
 */
function throttleRAF(fn) {
    let scheduled = false;
    let lastArgs = null;

    return function(...args) {
        lastArgs = args;
        if (!scheduled) {
            scheduled = true;
            requestAnimationFrame(() => {
                fn.apply(this, lastArgs);
                scheduled = false;
            });
        }
    };
}

/**
 * Get channel configuration based on viewport width.
 * On mobile, uses reduced channels to prevent cards from being pushed off-screen.
 * @returns {object} { maxChannels, channelWidth, maxOffset }
 */
function getMobileChannelConfig() {
    const isMobile = window.innerWidth < 600;
    if (isMobile) {
        return {
            maxChannels: 4,          // Reduced from 15 (prevents extreme offset)
            channelWidth: 15,        // Reduced from 20
            maxOffset: 60            // Hard cap: 4 x 15 = 60px max offset
        };
    }
    return {
        maxChannels: CHANNEL_CONFIG.maxChannels,
        channelWidth: CHANNEL_CONFIG.channelWidth,
        maxOffset: CHANNEL_CONFIG.maxChannels * CHANNEL_CONFIG.channelWidth
    };
}

let channelOccupancy = { left: [], right: [] };

function resetChannels() {
    channelOccupancy = { left: [], right: [] };
}

function findAvailableChannel(side, startYear, endYear) {
    const channels = channelOccupancy[side];
    const config = getMobileChannelConfig();

    // Start at channel 1 so ALL ranges are offset from center (channel 0 unused)
    for (let i = 1; i <= config.maxChannels; i++) {
        if (!channels[i]) channels[i] = [];
        const occupied = channels[i].some(r => !(endYear < r.start || startYear > r.end));
        if (!occupied) {
            channels[i].push({ start: startYear, end: endYear });
            return i;
        }
    }
    return config.maxChannels;
}

// ============ TIMELINE ENTRY CLASS ============
/**
 * TimelineEntry - New architecture for timeline events
 *
 * Key difference from old approach:
 * - Dot, bar, connector, and card are SIBLING elements (not nested)
 * - Each can be positioned independently without inheriting parent transforms
 * - Uses CSS custom properties for dynamic positioning
 *
 * DOM Structure:
 * <div class="timeline-entry" data-year="11861" data-side="left" data-type="range">
 *   <div class="entry-dot"></div>
 *   <div class="entry-bar"></div>
 *   <div class="entry-connector"></div>
 *   <div class="entry-card">...</div>
 * </div>
 */
class TimelineEntry {
    constructor(eventData, index) {
        this.data = eventData;
        this.index = index;
        this.side = eventData.side || (index % 2 === 0 ? 'left' : 'right');
        this.isRange = this.data.endYear !== undefined && this.data.endYear !== null;
        this.isAge = this.data.isAge || false;
        this.showRangeBar = this._shouldShowRangeBar();

        // Calculate positions
        this.startPx = yearToPixels(this.data.year);
        this.endPx = this.isRange ? yearToPixels(this.data.endYear) : this.startPx;
        this.barHeight = this.endPx - this.startPx;

        // Channel offset (for spread ranges)
        this.channel = 0;
        this.channelOffset = 0;

        // Get colors
        this.color = getEventColor(this.data);

        // DOM element references
        this.container = null;
        this.dot = null;
        this.bar = null;
        this.connector = null;
        this.card = null;

        // State
        this.isLocked = false;
        this.isHovered = false;
        this.isNudged = false;
        this.nudgeAmount = 0;
    }

    _shouldShowRangeBar() {
        if (!this.isRange) return false;
        const duration = this.data.endYear - this.data.year;
        return duration >= 1;
    }

    /**
     * Assign a channel for this range event (call before render)
     * Always assigns channel if spreadRanges is enabled, regardless of visibility.
     * CSS handles resetting positions when ranges are hidden.
     */
    assignChannel() {
        if (!this.showRangeBar) return;

        if (STATE.spreadRanges) {
            const config = getMobileChannelConfig();
            this.channel = findAvailableChannel(this.side, this.data.year, this.data.endYear);
            this.channelOffset = Math.min(
                this.channel * config.channelWidth,
                config.maxOffset
            );
        }
    }

    /**
     * Create and return the DOM element
     */
    render() {
        // Create container
        this.container = document.createElement('div');
        this.container.className = `timeline-entry ${this.side}`;
        if (this.showRangeBar) this.container.classList.add('has-range');
        if (this.isAge) this.container.classList.add('is-age');

        this.container.dataset.year = this.data.year;
        this.container.dataset.side = this.side;
        this.container.dataset.type = this.showRangeBar ? 'range' : 'point';

        // Position at start year
        this.container.style.top = `${this.startPx}px`;

        // Set CSS custom properties for colors
        this.container.style.setProperty('--entry-color', this.color.border);
        this.container.style.setProperty('--entry-bg', this.color.bg);
        this.container.style.setProperty('--entry-text', this.color.text);
        this.container.style.setProperty('--entry-glow', this.color.bg.replace('0.3', '0.5'));

        // Set channel offset as CSS custom property
        this.container.style.setProperty('--channel-offset', `${this.channelOffset}px`);

        // Create dot (always present)
        this._createDot();

        // Create bar (only for range events with visible bar)
        if (this.showRangeBar) {
            this._createBar();
        }

        // Create connector
        this._createConnector();

        // Create card
        this._createCard();

        // Set up event handlers
        this._setupEventHandlers();

        // Store reference to this instance on the DOM element
        this.container._timelineEntry = this;

        return this.container;
    }

    _createDot() {
        this.dot = document.createElement('div');
        this.dot.className = 'entry-dot';
        // Dot is always at timeline center (50%)
        // Visibility controlled by CSS based on whether bar is visible
        this.container.appendChild(this.dot);
    }

    _createBar() {
        this.bar = document.createElement('div');
        this.bar.className = 'entry-bar';

        // Use cached CSS values (avoid getComputedStyle per-element)
        const css = getCachedCSS();
        const adjustedBarHeight = this.barHeight + (css.dotOffset * 2);

        // Set bar height (with dot offset added)
        this.bar.style.setProperty('--bar-height', `${adjustedBarHeight}px`);

        // Position bar to start above the dot center
        this.bar.style.top = `${-css.dotOffset}px`;

        // Bar colors
        const barBgColor = this.color.bg.replace('0.3', '0.6');
        const barBgHover = this.color.bg.replace('0.3', '1');
        this.bar.style.setProperty('--bar-bg', barBgColor);
        this.bar.style.setProperty('--bar-bg-hover', barBgHover);
        this.bar.style.setProperty('--bar-border', this.color.border);

        // Apply channel offset for spread ranges
        // Bar moves away from center based on channel assignment
        if (this.channelOffset > 0) {
            // Store offset for potential centering later
            this.bar.dataset.channelOffset = this.channelOffset;
            if (this.side === 'left') {
                // Left side: bar moves left (negative X from center)
                this.bar.style.left = `calc(50% - ${this.channelOffset}px)`;
            } else {
                // Right side: bar moves right (positive X from center)
                this.bar.style.left = `calc(50% + ${this.channelOffset}px)`;
            }
        }

        this.container.appendChild(this.bar);
    }

    _createConnector() {
        this.connector = document.createElement('div');
        this.connector.className = 'entry-connector';

        // Base connector width (extends based on channel offset)
        const baseWidth = window.innerWidth < 600 ? 35 : 60;
        const connectorWidth = baseWidth + this.channelOffset;

        // Set width directly on connector
        this.connector.style.width = `${connectorWidth}px`;

        // Also set CSS variable on container for card positioning
        this.container.style.setProperty('--connector-width', `${connectorWidth}px`);

        // When ranges are spread, the connector endpoint needs to reach the bar position
        // Bar uses left: calc(50% - offset) for left side, left: calc(50% + offset) for right
        // Connector anchors at the bar position, extending toward the card
        if (this.channelOffset > 0) {
            if (this.side === 'left') {
                // Left card: bar is at 50% - offset (to the left of center)
                // Connector right edge should be where bar is
                // In CSS 'right' property: right: X means right edge is X from right side
                // So right: calc(50% + offset) places right edge at 50% - offset from left
                this.connector.style.right = `calc(50% + ${this.channelOffset}px)`;
            } else {
                // Right card: bar is at 50% + offset (to the right of center)
                // Connector left edge should be where bar is
                // left: calc(50% + offset) places left edge at 50% + offset from left
                this.connector.style.left = `calc(50% + ${this.channelOffset}px)`;
            }
        }

        this.container.appendChild(this.connector);
    }

    _createCard() {
        this.card = document.createElement('div');
        this.card.className = 'entry-card';
        this.card.style.borderTop = `5px solid ${this.color.border}`;

        const yearLabel = formatYearDisplay(this.data);
        const sourceLink = this.data.source
            ? `<a href="${this.data.source}" target="_blank" rel="noopener noreferrer" class="event-source" style="color: ${this.color.text}">Learn more →</a>`
            : '';
        const categoryIcons = getCategoryIcons(this.data);

        // Use range-dates for ranges, event-year-text for points
        const dateClass = this.showRangeBar ? 'range-dates' : 'event-year-text';

        this.card.innerHTML = `
            <div class="event-header">
                <span class="event-title">${this.data.title}</span>
            </div>
            <span class="${dateClass}" style="color: ${this.color.text}">${yearLabel}</span>
            <p class="event-desc">${this.data.desc || ''}</p>
            <div class="event-footer">
                ${categoryIcons}
                ${sourceLink}
            </div>
        `;

        this.container.appendChild(this.card);
    }

    _setupEventHandlers() {
        // Click handler on card - captures clicks and prevents passthrough
        // Use capturing phase to intercept before bubbling
        this.card.addEventListener('click', (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();

            // In hide-labels mode and card is not locked/hovered, ignore card clicks
            // Check DOM class directly since handleEventClick updates classList, not instance property
            const hideLabelsMode = document.body.classList.contains('hide-labels');
            const isLocked = this.container.classList.contains('locked');
            const isHovered = this.container.classList.contains('hovered');
            if (hideLabelsMode && !isLocked && !isHovered) {
                return;
            }

            this._handleClick(e);
        }, true); // Capturing phase

        // Click handler on container for dot/bar clicks
        this.container.addEventListener('click', (e) => {
            e.stopPropagation();

            // If click was on the card, it's already handled above
            if (this.card.contains(e.target)) {
                return;
            }

            // In hide-labels mode, only respond to clicks on dot or bar
            const hideLabelsMode = document.body.classList.contains('hide-labels');
            if (hideLabelsMode) {
                const clickedOnDot = this.dot && this.dot.contains(e.target);
                const clickedOnBar = this.bar && this.bar.contains(e.target) &&
                                     window.getComputedStyle(this.bar).opacity > 0;
                if (!clickedOnDot && !clickedOnBar) {
                    return;
                }
            }

            this._handleClick(e);
        });

    }

    _handleClick(e) {
        // This will be integrated with the existing handleEventClick system
        // For now, toggle locked state and call the existing handler
        handleEventClick(this.container, 9);
    }

    /**
     * Nudge the card into viewport on mobile
     * With new architecture, elements are independent - no counter-nudging needed
     */
    nudgeIntoViewport() {
        if (!this.card) return 0;

        const rect = this.card.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const padding = 10;

        let nudge = 0;
        if (rect.left < padding) {
            nudge = padding - rect.left;
        } else if (rect.right > viewportWidth - padding) {
            nudge = (viewportWidth - padding) - rect.right;
        }

        // For range events on mobile, center the bar (remove spread offset)
        // This is done by setting left back to 50% (overriding any channel offset)
        const isMobile = viewportWidth < 600;
        if (this.showRangeBar && isMobile && this.bar && this.channelOffset > 0) {
            // Store original position for reset
            this.bar.dataset.originalLeft = this.bar.style.left;
            // Center the bar (remove spread offset)
            this.bar.style.left = '50%';
            this.bar.dataset.wasCentered = 'true';

            // Also reset connector to center position (remove spread offset)
            if (this.connector) {
                if (this.side === 'left') {
                    this.connector.dataset.originalRight = this.connector.style.right;
                    this.connector.style.right = '50%';
                } else {
                    this.connector.dataset.originalLeft = this.connector.style.left;
                    this.connector.style.left = '50%';
                }
                // Reset connector width to base width (without channel offset)
                const baseWidth = window.innerWidth < 600 ? 35 : 60;
                this.connector.dataset.originalWidth = this.connector.style.width;
                this.connector.style.width = `${baseWidth}px`;
                this.connector.dataset.wasCentered = 'true';
            }
        }

        if (nudge === 0 && !(this.showRangeBar && isMobile && this.channelOffset > 0)) {
            return 0;
        }

        if (nudge !== 0) {
            this.isNudged = true;
            this.nudgeAmount = nudge;

            // Only move the card - dot and bar stay at timeline center
            this.card.style.transform = `translateY(-50%) translateX(${nudge}px)`;

            // Adjust connector to bridge the gap
            // The connector needs to stretch/shrink to connect card edge to timeline
            if (this.connector) {
                const baseWidth = parseInt(getComputedStyle(this.connector).getPropertyValue('--connector-width')) || 35;
                if (this.side === 'left') {
                    // Left card nudged right: connector shrinks
                    this.connector.style.width = `${Math.max(0, baseWidth - nudge)}px`;
                } else {
                    // Right card nudged left: connector shrinks (nudge is negative)
                    this.connector.style.width = `${Math.max(0, baseWidth + nudge)}px`;
                }
            }
        }

        return 1;
    }

    /**
     * Reset nudge to original position
     */
    resetNudge() {
        if (!this.isNudged && !this.bar?.dataset.wasCentered && !this.connector?.dataset.wasCentered) return;

        this.isNudged = false;
        this.nudgeAmount = 0;

        if (this.card) {
            this.card.style.transform = '';
        }

        // Restore connector to its spread position
        if (this.connector && this.connector.dataset.wasCentered) {
            this.connector.style.width = this.connector.dataset.originalWidth || '';
            if (this.side === 'left') {
                this.connector.style.right = this.connector.dataset.originalRight || '';
            } else {
                this.connector.style.left = this.connector.dataset.originalLeft || '';
            }
            delete this.connector.dataset.wasCentered;
            delete this.connector.dataset.originalWidth;
            delete this.connector.dataset.originalRight;
            delete this.connector.dataset.originalLeft;
        } else if (this.connector) {
            // Just reset width if not spread-centered
            this.connector.style.width = '';
        }

        // Restore bar to its spread position
        if (this.bar && this.bar.dataset.wasCentered) {
            this.bar.style.left = this.bar.dataset.originalLeft || '';
            delete this.bar.dataset.wasCentered;
            delete this.bar.dataset.originalLeft;
        }
    }

    /**
     * Set hover state
     */
    setHovered(hovered) {
        this.isHovered = hovered;
        this.container.classList.toggle('hovered', hovered);
    }

    /**
     * Set locked state
     */
    setLocked(locked) {
        this.isLocked = locked;
        this.container.classList.toggle('locked', locked);
    }
}

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
 * @param {number} heYear - Year in Holocene Era (can be negative for pre-Holocene dates)
 * @returns {object} { year: number, era: 'CE' | 'BCE' }
 */
function fromHoloceneYear(heYear) {
    if (heYear >= 10001) {
        return { year: heYear - 10000, era: 'CE' };
    } else if (heYear === 10000) {
        return { year: 1, era: 'BCE' }; // There's no year 0
    } else if (heYear > 0) {
        // Positive HE less than 10001 = BCE years within Holocene
        return { year: 10001 - heYear, era: 'BCE' };
    } else {
        // Negative HE = very ancient BCE dates (pre-Holocene)
        // -3,290,000 HE → 3,300,000 BCE (approximately)
        return { year: 10001 - heYear, era: 'BCE' };
    }
}

/**
 * Parse a date string - treats plain numbers as HE years
 * Only converts if explicitly marked as CE/AD/BCE/BC
 * Supports: "12025", "2025 CE", "500 BCE", "44 BC", "HE 12025", "-2025" (as BCE)
 * Also supports "c. " prefix for circa/approximate dates (e.g., "c. 3150 BCE")
 * When circa prefix is used on round BCE numbers, adds 1 for clean HE conversion
 * @param {string|number} dateInput 
 * @returns {object} { year: number, circa: boolean } - year in HE, circa flag
 */
function parseDateToHEWithCirca(dateInput) {
    if (typeof dateInput === 'number') {
        return { year: dateInput, circa: false }; // Assume already in HE
    }
    
    let str = String(dateInput).trim();
    
    // Handle "present" keyword - returns current year
    if (str.toLowerCase() === 'present') {
        return { year: getCurrentHoloceneYear(), circa: false };
    }
    
    // Check for "c." or "circa" prefix (case insensitive)
    let isCirca = false;
    const circaMatch = str.match(/^(?:c\.?|circa)\s*/i);
    if (circaMatch) {
        isCirca = true;
        str = str.slice(circaMatch[0].length).trim();
    }
    
    const strUpper = str.toUpperCase();
    
    // Check for "HE" prefix/suffix - already in HE
    const heMatch = strUpper.match(/^(?:HE\s*)?(\d+)(?:\s*HE)?$/);
    if (heMatch && strUpper.includes('HE')) {
        return { year: parseInt(heMatch[1], 10), circa: isCirca };
    }
    
    // Check for BCE/BC/B.C.E./B.C. - needs conversion (handles dots)
    // Match: BCE, BC, B.C.E., B.C.E, B.C., B.C (any combo of dots)
    const bceMatch = strUpper.match(/^(\d+)\s*B\.?\s*C\.?\s*(?:E\.?)?$/);
    if (bceMatch) {
        let year = parseInt(bceMatch[1], 10);
        
        // If circa and the BCE year is a round number, add 1 for clean HE display
        // Round = divisible by 10 (catches 10, 100, 1000, etc)
        // BUT don't round 10000 BCE since that would give 0 HE (we want 1 HE)
        if (isCirca && year % 10 === 0 && year !== 10000) {
            year += 1; // e.g., 3150 BCE -> 3151 BCE -> 6850 HE (clean)
        }
        
        // 0 BCE and 1 BCE both map to 10000 HE
        if (year === 0 || year === 1) {
            return { year: 10000, circa: isCirca };
        }
        return { year: toHoloceneYear(year, 'BCE'), circa: isCirca };
    }
    
    // Check for explicit CE/AD/C.E./A.D. - needs conversion (handles dots)
    // Match: CE, AD, C.E., C.E, A.D., A.D (any combo of dots)
    const ceMatch = strUpper.match(/^(\d+)\s*(?:C\.?\s*E\.?|A\.?\s*D\.?)$/);
    if (ceMatch) {
        const year = parseInt(ceMatch[1], 10);
        // 0 CE maps to 10000 HE (same as 1 BCE)
        if (year === 0) {
            return { year: 10000, circa: isCirca };
        }
        return { year: toHoloceneYear(year, 'CE'), circa: isCirca };
    }
    
    // Check for negative number - treat as BCE
    const negativeMatch = strUpper.match(/^-(\d+)$/);
    if (negativeMatch) {
        let year = parseInt(negativeMatch[1], 10);
        
        // If circa and round, add 1 (but not for 10000 which would give 0 HE)
        if (isCirca && year % 10 === 0 && year !== 10000) {
            year += 1;
        }
        
        if (year === 0 || year === 1) {
            return { year: 10000, circa: isCirca };
        }
        return { year: toHoloceneYear(year, 'BCE'), circa: isCirca };
    }
    
    // Plain number without era marker - treat as HE
    const plainMatch = strUpper.match(/^(\d+)$/);
    if (plainMatch) {
        return { year: parseInt(plainMatch[1], 10), circa: isCirca };
    }
    
    console.warn(`Could not parse date: "${dateInput}"`);
    return { year: NaN, circa: false };
}

/**
 * Parse a date string - treats plain numbers as HE years
 * Only converts if explicitly marked as CE/AD/BCE/BC
 * Supports: "12025", "2025 CE", "500 BCE", "44 BC", "HE 12025", "-2025" (as BCE)
 * Also supports "c. " prefix for circa/approximate dates
 * @param {string|number} dateInput 
 * @returns {number} Year in Holocene Era
 */
function parseDateToHE(dateInput) {
    return parseDateToHEWithCirca(dateInput).year;
}

/**
 * Parse a CE/BCE date string - assumes CE unless marked BCE/BC or negative
 * Does NOT accept HE years - use parseDateToHE for that
 * Supports: "2025", "2025 CE", "500 BCE", "44 BC", "44 B.C.", "-500" (as BCE)
 * @param {string|number} dateInput 
 * @returns {number} Year in Holocene Era
 */
function parseCEDateToHE(dateInput) {
    if (typeof dateInput === 'number') {
        return dateInput + 10000; // Assume CE
    }
    
    const str = String(dateInput).trim().toUpperCase();
    
    // Check for BCE/BC/B.C.E./B.C. - needs conversion (handles dots)
    // Match: BCE, BC, B.C.E., B.C.E, B.C., B.C (any combo of dots)
    const bceMatch = str.match(/^(\d+)\s*B\.?\s*C\.?\s*(?:E\.?)?$/);
    if (bceMatch) {
        const year = parseInt(bceMatch[1], 10);
        if (year === 0 || year === 1) {
            return 10000;
        }
        return toHoloceneYear(year, 'BCE');
    }
    
    // Check for explicit CE/AD/C.E./A.D. (handles dots)
    // Match: CE, AD, C.E., C.E, A.D., A.D (any combo of dots)
    const ceMatch = str.match(/^(\d+)\s*(?:C\.?\s*E\.?|A\.?\s*D\.?)$/);
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
    // Clamp negative years to position 0 (they still display but at the top)
    return Math.max(0, year) * CONFIG.pxPerYear;
}

function pixelsToYear(px) {
    return Math.round(px / CONFIG.pxPerYear);
}

function yearToCE(year) {
    return Math.floor(year - 10000);
}

// ============ FORMATTING ============

/**
 * Format a single year for display, handling negative years (BHE)
 * @param {number} year - Year in HE (can be negative)
 * @returns {string} Formatted year string
 */
function formatSingleYear(year) {
    if (year < 0) {
        // Negative HE = Before Holocene Era
        return `${Math.abs(year).toLocaleString()} BHE`;
    }
    return `${year.toLocaleString()} HE`;
}

function formatYear(year) {
    return formatSingleYear(year);
}

/**
 * Format the year display based on event type
 * @param {object} eventData - The event object with year, endYear, and optional type
 * @returns {string} Formatted year string
 * 
 * Type logic:
 * - "person": "b. X - d. Y HE" (birth to death)
 * - "approximate": "Between X - Y HE" (uncertain range) or "c. X HE" (single approximate)
 * - "range": "X - Y HE" (definite range like empires, wars)
 * - "event" or default: "X HE" (single date)
 * 
 * Circa flags:
 * - eventData.circa: if true, shows "c." prefix on start year
 * - eventData.endCirca: if true, shows "c." prefix on end year
 * 
 * Range formatting:
 * - For ranges, only show era (HE/BHE) on the end year to reduce redundancy
 * - Exception: if start is BHE and end is HE, show both eras
 * 
 * If type is not specified:
 * - Has endYear -> defaults to "range"
 * - No endYear -> defaults to "event"
 */
function formatYearDisplay(eventData) {
    const year = eventData.year;
    const endYear = eventData.endYear;
    const circa = eventData.circa || false;
    const endCirca = eventData.endCirca || false;
    const type = eventData.type || (endYear ? 'range' : 'event');
    
    // Check if start and end have different eras (one BHE, one HE)
    const startIsBHE = year < 0;
    const endIsBHE = endYear < 0;
    const sameEra = startIsBHE === endIsBHE;
    
    // Format number with commas but no era suffix
    const formatNumberOnly = (y) => {
        if (y < 0) return Math.abs(y).toLocaleString();
        return y.toLocaleString();
    };
    
    // Helpers to format with optional circa prefix
    // For ranges: start year gets no era suffix (unless eras differ), end year always gets suffix
    const formatStartInRange = () => {
        const num = formatNumberOnly(year);
        const c = circa ? 'c. ' : '';
        // Only add era if it differs from end year's era
        if (!sameEra) {
            return `${c}${num} ${startIsBHE ? 'BHE' : 'HE'}`;
        }
        return `${c}${num}`;
    };
    
    const formatStart = () => circa ? `c. ${formatSingleYear(year)}` : formatSingleYear(year);
    const formatEnd = () => endCirca ? `c. ${formatSingleYear(endYear)}` : formatSingleYear(endYear);
    
    switch (type) {
        case 'person':
            if (endYear) {
                return `b. ${formatStartInRange()} – d. ${formatEnd()}`;
            }
            return `b. ${formatStart()}`;
        
        case 'approximate':
            if (endYear) {
                return `Between ${formatStartInRange()} – ${formatEnd()}`;
            }
            return `c. ${formatSingleYear(year)}`; // Always show c. for single approximate
        
        case 'range':
            if (endYear) {
                return `${formatStartInRange()} – ${formatEnd()}`;
            }
            return formatStart();
        
        case 'event':
        default:
            return formatStart();
    }
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
            data.events = data.events.map(event => {
                // Parse year with circa detection
                let yearValue, yearCirca = false;
                if (typeof event.year === 'number') {
                    yearValue = event.year;
                } else {
                    const parsed = parseDateToHEWithCirca(event.year);
                    yearValue = parsed.year;
                    yearCirca = parsed.circa;
                }
                
                const normalizedEvent = {
                    ...event,
                    year: yearValue,
                    circa: yearCirca,  // Store circa flag on the event
                    sourceDataset: data.id,
                    color: data.color || '#c9a227'
                };
                
                // Also parse endYear if present (with circa detection)
                if (event.endYear !== undefined) {
                    if (typeof event.endYear === 'number') {
                        normalizedEvent.endYear = event.endYear;
                        normalizedEvent.endCirca = false;
                    } else {
                        const endParsed = parseDateToHEWithCirca(event.endYear);
                        normalizedEvent.endYear = endParsed.year;
                        normalizedEvent.endCirca = endParsed.circa;
                    }
                }
                
                return normalizedEvent;
            });
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
    
    // Separate age events (for overlay rendering)
    STATE.ageEvents = STATE.allEvents.filter(e => e.isAge);
    
    // Pre-assign sides to all events based on their START year position
    // Since all events (including ranges) now display at their start year,
    // we sort by start year for proper left/right alternation
    const allSorted = [...STATE.allEvents].sort((a, b) => a.year - b.year);
    
    allSorted.forEach((event, index) => {
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

// Default color for uncategorized events (gold) - defined here so buildFilterUI can use it
const DEFAULT_COLOR = { bg: 'rgba(201, 162, 39, 0.3)', border: '#8a7019', text: '#c9a227' };

/**
 * Build the filter UI checkboxes
 */
function buildFilterUI() {
    const filterOptions = document.getElementById('filterOptions');
    if (!filterOptions) return;
    
    filterOptions.innerHTML = '';
    
    Object.entries(STATE.categories).forEach(([key, category]) => {
        const color = category.color || DEFAULT_COLOR;
        // Create a dimmer version of the color for the toggle background
        const colorDim = color.border.replace('#', '');
        const r = parseInt(colorDim.substr(0, 2), 16);
        const g = parseInt(colorDim.substr(2, 2), 16);
        const b = parseInt(colorDim.substr(4, 2), 16);
        const dimColor = `rgba(${r}, ${g}, ${b}, 0.4)`;
        
        const label = document.createElement('label');
        label.className = 'filter-option active'; // Start active
        label.style.setProperty('--filter-color', color.border);
        label.style.setProperty('--filter-color-dim', dimColor);
        label.innerHTML = `
            <input type="checkbox" value="${key}" checked data-category="${key}">
            <span class="filter-option-text">
                <span class="filter-option-icon">${category.icon || ''}</span>
                <span class="filter-option-label">${category.name}</span>
            </span>
            <span class="filter-toggle"></span>
        `;
        
        const checkbox = label.querySelector('input');
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                STATE.activeFilters.add(key);
                label.classList.add('active');
            } else {
                STATE.activeFilters.delete(key);
                label.classList.remove('active');
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
            document.querySelectorAll('#filterOptions .filter-option').forEach(opt => {
                opt.classList.add('active');
                opt.querySelector('input[type="checkbox"]').checked = true;
            });
            updateFilterCount();
            renderTimeline();
        });
    }
    
    if (filterNone) {
        filterNone.addEventListener('click', () => {
            STATE.activeFilters.clear();
            document.querySelectorAll('#filterOptions .filter-option').forEach(opt => {
                opt.classList.remove('active');
                opt.querySelector('input[type="checkbox"]').checked = false;
            });
            updateFilterCount();
            renderTimeline();
        });
    }
}

/**
 * Setup the "Show Ranges" toggle
 */
function setupRangeToggle() {
    const toggle = document.getElementById('showRangesToggle');
    if (!toggle) return;
    
    // Initialize based on checkbox state
    if (toggle.checked) {
        document.body.classList.add('show-ranges');
    }
    
    toggle.addEventListener('change', () => {
        if (toggle.checked) {
            document.body.classList.add('show-ranges');
        } else {
            document.body.classList.remove('show-ranges');
        }
        // No re-render needed - CSS handles bar visibility via .show-ranges class
    });
}

/**
 * Setup the "Show Ages" toggle
 */
function setupAgeToggle() {
    const toggle = document.getElementById('showAgesToggle');
    if (!toggle) return;
    
    // Initialize based on checkbox state
    STATE.showAges = toggle.checked;
    if (toggle.checked) {
        document.body.classList.add('show-ages');
    }
    
    toggle.addEventListener('change', () => {
        STATE.showAges = toggle.checked;
        if (toggle.checked) {
            document.body.classList.add('show-ages');
        } else {
            document.body.classList.remove('show-ages');
        }
        // No re-render needed - CSS handles bar visibility via .show-ages class
    });
}

/**
 * Setup the "Show Labels" toggle (labels hidden when unchecked)
 */
function setupShowLabelsToggle() {
    const toggle = document.getElementById('showLabelsToggle');
    if (!toggle) return;
    
    // Initialize based on checkbox state (if unchecked, hide labels)
    if (!toggle.checked) {
        document.body.classList.add('hide-labels');
    }
    
    toggle.addEventListener('change', () => {
        if (toggle.checked) {
            document.body.classList.remove('hide-labels');
        } else {
            document.body.classList.add('hide-labels');
        }
    });
}

/**
 * Setup the "Spread Ranges" toggle
 */
function setupSpreadRangesToggle() {
    const toggle = document.getElementById('spreadRangesToggle');
    if (!toggle) return;
    
    // Initialize based on checkbox state
    STATE.spreadRanges = toggle.checked;
    
    toggle.addEventListener('change', () => {
        STATE.spreadRanges = toggle.checked;
        renderTimeline();
    });
}

/**
 * Setup sidebar and top bar controls
 */
// function setupMobileControls() {
//     const menuBtn = document.getElementById('menuBtn');
//     const sidebar = document.getElementById('sidebar');
//     const sidebarOverlay = document.getElementById('sidebarOverlay');
    
//     // Check if we're on desktop (>800px)
//     const isDesktop = () => window.innerWidth > 800;
    
//     // Sidebar open/close
//     const openSidebar = () => {
//         sidebar?.classList.add('open');
//         if (!isDesktop()) {
//             // Mobile: show overlay
//             sidebarOverlay?.classList.add('active');
//         }
//     };
    
//     const closeSidebar = () => {
//         sidebar?.classList.remove('open');
//         sidebarOverlay?.classList.remove('active');
//     };
    
//     // Toggle sidebar
//     const toggleSidebar = () => {
//         if (sidebar?.classList.contains('open')) {
//             closeSidebar();
//         } else {
//             openSidebar();
//         }
//     };
    
//     // Menu button toggles sidebar
//     menuBtn?.addEventListener('click', toggleSidebar);
    
//     // Clicking overlay closes sidebar (mobile)
//     sidebarOverlay?.addEventListener('click', closeSidebar);
    
//     // On desktop, sidebar starts closed (user can open if needed)
//     // On mobile, sidebar also starts closed
//     if (window.innerWidth > 1600) {
//         openSidebar();
//     }


//     // Handle resize: adjust overlay behavior when crossing 800px threshold
//     let wasDesktop = isDesktop();
//     window.addEventListener('resize', () => {
//         const nowDesktop = isDesktop();
        
//         if (sidebar?.classList.contains('open')) {
//             if (nowDesktop && !wasDesktop) {
//                 // Crossed from mobile to desktop while open
//                 sidebarOverlay?.classList.remove('active');
//             } else if (!nowDesktop && wasDesktop) {
//                 // Crossed from desktop to mobile while open
//                 sidebarOverlay?.classList.add('active');
//             }
//         }
        
//         wasDesktop = nowDesktop;
//     });
// }

function setupSidebarControls() {
    const menuBtn = document.getElementById('menuBtn');
    const sidebar = document.getElementById('sidebar');
    autoOpenWidth = 1600;
    
    menuBtn?.addEventListener('click', () => {
        sidebar?.classList.toggle('open');
    });
    
    // Click outside closes sidebar
    document.addEventListener('click', (e) => {
        if (!sidebar?.classList.contains('open')) return;
        if (sidebar.contains(e.target)) return;
        if (menuBtn.contains(e.target)) return;
        if (window.innerWidth > autoOpenWidth) return;
        
        sidebar.classList.remove('open');
    });
    
    // Start open on wide screens
    if (window.innerWidth > autoOpenWidth) {
        sidebar?.classList.add('open');
    }
}

/**
 * Populate filter options (called after categories are loaded)
 */
function populateMobileFilters() {
    // No longer needed - we only have one set of filter controls now
    // This function is kept for compatibility but does nothing
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

// ============ COLOR FUNCTIONS ============

/**
 * Get the color for an event based on its categories and current filter state
 * When viewing all categories: use first active category's color
 * When viewing a single category: use a DIFFERENT category's color for variety
 * Age events (isAge: true) always use their ageColor
 * @param {object} event - The event object
 * @returns {object} Color object with bg, border, text properties
 */
function getEventColor(event) {
    // Age events always use their unique ageColor
    if (event.isAge && event.ageColor) {
        const hex = event.ageColor;
        // Convert hex to rgba for bg
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return {
            bg: `rgba(${r}, ${g}, ${b}, 0.3)`,
            border: hex,
            text: hex
        };
    }
    
    // No categories = default gold
    if (!event.categories || event.categories.length === 0) {
        return DEFAULT_COLOR;
    }
    
    const totalCategories = Object.keys(STATE.categories).length;
    const activeCount = STATE.activeFilters.size;
    
    // Check if we're in "single category" mode (only one filter active)
    const singleCategoryMode = activeCount === 1;
    
    if (singleCategoryMode) {
        // Find a category that's NOT the active filter (for visual variety)
        const activeCategory = [...STATE.activeFilters][0];
        
        for (const catKey of event.categories) {
            if (catKey !== activeCategory && STATE.categories[catKey]?.color) {
                return STATE.categories[catKey].color;
            }
        }
        // Fall back to the active category if it's the only one
        if (STATE.categories[activeCategory]?.color) {
            return STATE.categories[activeCategory].color;
        }
    } else {
        // Normal mode: find first category that's currently active in filters
        for (const catKey of event.categories) {
            if (STATE.activeFilters.has(catKey) && STATE.categories[catKey]?.color) {
                return STATE.categories[catKey].color;
            }
        }
        
        // No active categories found, use first category's color anyway
        const firstCat = event.categories[0];
        if (STATE.categories[firstCat]?.color) {
            return STATE.categories[firstCat].color;
        }
    }
    
    // Fallback to default
    return DEFAULT_COLOR;
}

/**
 * Get the category icons for an event
 * @param {object} event - The event object
 * @returns {string} HTML string of icons
 */
function getCategoryIcons(event) {
    if (!event.categories || event.categories.length === 0) {
        return '';
    }
    
    const icons = event.categories
        .map(catKey => STATE.categories[catKey]?.icon || '')
        .filter(icon => icon !== '');
    
    if (icons.length === 0) return '';
    
    return `<span class="event-category-icons">${icons.join('')}</span>`;
}

// ============ RENDER FUNCTIONS ============

/**
 * Determine if an event should show a range bar on hover/click
 * @param {object} eventData - The event object
 * @returns {boolean} True if range bar should be shown
 */
function shouldShowRangeBar(eventData) {
    // No endYear = no range bar
    if (!eventData.endYear) return false;
    
    // If explicitly set to "event" type, suppress range bar
    if (eventData.type === 'event') return false;
    
    // All other cases with endYear show the range bar:
    // - type: "range" (explicit range)
    // - type: "person" (lifespan)
    // - type: "approximate" (uncertain range)
    // - no type (defaults to range when endYear exists)
    return true;
}

function createRangeBar(rangeData, index, maxDuration) {
    const range = document.createElement('div');
    // Use pre-assigned side from data loading
    const side = rangeData.side || (index % 2 === 0 ? 'left' : 'right');
    
    // Determine if this should show a range bar
    const showRangeBar = shouldShowRangeBar(rangeData);
    const isAge = rangeData.isAge ? 'is-age' : '';
    range.className = `event ${showRangeBar ? 'range' : ''} ${isAge} ${side}`.trim();
    
    const startPx = yearToPixels(rangeData.year);
    const endPx = yearToPixels(rangeData.endYear);
    const heightPx = endPx - startPx;
    
    // Base z-index is 9 (set via CSS), DOM order handles stacking
    const zIndex = 9;
    
    // Position at START year (not midpoint) - same as point events
    range.style.top = startPx + 'px';
    range.dataset.zIndex = zIndex;
    // Store the start year for sorting/scrolling purposes
    range.dataset.year = rangeData.year;
    
    // Determine if this range will be visible (for spread/z-index decisions)
    // Ages are controlled ONLY by showAges toggle
    // Non-age ranges are controlled ONLY by showRanges toggle
    const showRangesToggle = document.getElementById('showRangesToggle');
    const showAgesToggle = document.getElementById('showAgesToggle');
    const rangesVisible = showRangesToggle?.checked || false;
    const agesVisible = showAgesToggle?.checked || false;
    const isVisibleRange = rangeData.isAge ? agesVisible : rangesVisible;
    
    // Assign channel for ranges to avoid overlap (only if spread is enabled AND range is visible)
    let channel = 0;
    let channelOffset = 0;
    if (STATE.spreadRanges && isVisibleRange) {
        const config = getMobileChannelConfig();
        channel = findAvailableChannel(side, rangeData.year, rangeData.endYear);
        channelOffset = Math.min(
            channel * config.channelWidth,
            config.maxOffset
        );
    }
    
    // Apply channel offset - push card further from center
    if (channelOffset > 0) {
        if (side === 'left') {
            range.style.marginRight = channelOffset + 'px';
        } else {
            range.style.marginLeft = channelOffset + 'px';
        }
    }
    
    // Set lower z-index for hidden ranges so visible ones take priority
    if (!isVisibleRange) {
        range.style.zIndex = '1';
    }
    
    const yearLabel = formatYearDisplay(rangeData);
    
    // Get color from first active category
    const color = getEventColor(rangeData);
    const barBgColor = color.bg.replace('0.3', '0.6'); // More opaque for bar
    const barBgColorHover = color.bg.replace('0.3', '1'); // Even more opaque on hover
    const borderColor = color.border; // For card top border
    
    // Set CSS custom properties for hover/lock glow
    range.style.setProperty('--event-border', borderColor);
    range.style.setProperty('--event-glow', color.bg.replace('0.3', '0.5'));
    
    // Build source link if available
    const sourceLink = rangeData.source 
        ? `<a href="${rangeData.source}" target="_blank" rel="noopener noreferrer" class="event-source" style="color: ${color.text}">Learn more →</a>`
        : '';
    
    // Get category icons
    const categoryIcons = getCategoryIcons(rangeData);
    
    // Build the range bar HTML only if it should be shown
    // The bar extends DOWN from the dot position to the end year
    const rangeBarHtml = showRangeBar ? `
            <div class="range-bar-indicator" 
                 style="--bar-height: ${heightPx}px; 
                        --bar-bg: ${barBgColor}; 
                        --bar-bg-hover: ${barBgColorHover}; 
                        --bar-border: ${color.border};
                        background-color: var(--bar-bg); 
                        border-color: var(--bar-border);"></div>` : '';
    
    // Connector width extends based on channel
    const connectorWidth = 60 + channelOffset;
    
    range.innerHTML = `
        <div class="content" style="border-top: 5px solid ${borderColor}">
            <div class="connector" style="background: ${color.border}; width: ${connectorWidth}px"></div>
            <div class="event-dot" style="background: ${borderColor}; box-shadow: 0 0 0 1px ${borderColor}"></div>
            ${rangeBarHtml}
            <div class="event-header">
                <span class="event-title">${rangeData.title}</span>
            </div>
            <span class="range-dates" style="color: ${color.text}">${yearLabel}</span>
            <p class="event-desc">${rangeData.desc || ''}</p>
            <div class="event-footer">
                ${categoryIcons}
                ${sourceLink}
            </div>
        </div>
    `;
    
    // Click-to-lock behavior
    range.addEventListener('click', (e) => {
        e.stopPropagation();

        // In hide-labels mode, only respond to clicks on dots or visible range bars
        const hideLabelsMode = document.body.classList.contains('hide-labels');
        if (hideLabelsMode) {
            const dot = range.querySelector('.event-dot');
            const rangeBar = range.querySelector('.range-bar-indicator');
            const clickedOnDot = dot && dot.contains(e.target);
            const clickedOnBar = rangeBar && rangeBar.contains(e.target) &&
                                 window.getComputedStyle(rangeBar).opacity > 0;

            if (!clickedOnDot && !clickedOnBar) {
                return; // Ignore click on hidden card area
            }
        }

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
    
    // Get color from first active category
    const color = getEventColor(eventData);
    const borderColor = color.border;
    const textColor = color.text;
    
    // Set CSS custom properties for hover/lock glow
    event.style.setProperty('--event-border', borderColor);
    event.style.setProperty('--event-glow', color.bg.replace('0.3', '0.5'));
    
    const yearLabel = formatYearDisplay(eventData);
    
    // Build source link if available
    const sourceLink = eventData.source 
        ? `<a href="${eventData.source}" target="_blank" rel="noopener noreferrer" class="event-source" style="color: ${textColor}">Learn more →</a>`
        : '';
    
    // Get category icons
    const categoryIcons = getCategoryIcons(eventData);
    
    event.innerHTML = `
        <div class="content" style="border-top: 5px solid ${borderColor}">
            <div class="connector" style="background: ${borderColor}"></div>
            <div class="event-dot" style="background: ${borderColor}; box-shadow: 0 0 0 1px ${borderColor}"></div>
            <div class="event-header">
                <span class="event-title">${eventData.title}</span>
            </div>
            <span class="event-year-text" style="color: ${textColor}">${yearLabel}</span>
            <p class="event-desc">${eventData.desc || ''}</p>
            <div class="event-footer">
                ${categoryIcons}
                ${sourceLink}
            </div>
        </div>
    `;
    
    // Store color for hover state
    event.dataset.color = borderColor;
    
    // Click-to-lock behavior
    event.addEventListener('click', (e) => {
        e.stopPropagation();

        // In hide-labels mode, only respond to clicks on dots
        const hideLabelsMode = document.body.classList.contains('hide-labels');
        if (hideLabelsMode) {
            const dot = event.querySelector('.event-dot');
            const clickedOnDot = dot && dot.contains(e.target);

            if (!clickedOnDot) {
                return; // Ignore click on hidden card area
            }
        }

        handleEventClick(event, zIndex);
    });
    
    // Hover is handled globally by setupSmartHover()
    
    return event;
}

/**
 * Nudge a card horizontally so it's fully visible within the viewport.
 * Keeps dot stationary on timeline, moves range bar to timeline center,
 * and adjusts connector width to bridge the gap.
 */
function nudgeCardIntoViewport(eventEl) {
    const content = eventEl.querySelector('.content');
    if (!content) return 0;

    const rect = content.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const padding = 10; // Minimum padding from viewport edge

    const dot = content.querySelector('.event-dot');
    const rangeBar = content.querySelector('.range-bar-indicator');
    const connector = content.querySelector('.connector');
    const isLeft = eventEl.classList.contains('left');
    const isRange = eventEl.classList.contains('range');

    // Check if card needs nudging into viewport
    let needsNudge = false;
    if (rect.left < padding) {
        needsNudge = true;
    } else if (rect.right > viewportWidth - padding) {
        needsNudge = true;
    }

    // For range events, ALWAYS center the bar (even if card doesn't need nudging)
    // For point events, only act if card needs nudging
    if (!needsNudge && !isRange) {
        return 0;
    }

    // Disable ALL transitions before any changes to prevent animation
    if (dot) dot.style.transition = 'none';
    if (rangeBar) rangeBar.style.transition = 'none';
    if (connector) connector.style.transition = 'none';

    // Store original values for reset
    eventEl.dataset.originalTransform = eventEl.style.transform || '';

    if (isRange && rangeBar) {
        // RANGE EVENTS: Nudge card into view, center bar on timeline

        let nudge = 0;
        if (rect.left < padding) {
            nudge = padding - rect.left;
        } else if (rect.right > viewportWidth - padding) {
            nudge = (viewportWidth - padding) - rect.right;
        }

        // Center the bar - CSS .centered class positions bar at viewport center
        // This happens ALWAYS for range events on mobile (even if card doesn't need nudging)
        rangeBar.classList.add('centered');
        rangeBar.style.transform = ''; // Clear inline transform so CSS .centered can take effect
        eventEl.dataset.rangeBarCentered = 'true';

        // If card needs nudging, apply transforms
        if (nudge !== 0) {
            // Nudge the card into view
            eventEl.dataset.nudgeAmount = nudge;
            eventEl.style.transform = `translateY(-50%) translateX(${nudge}px)`;

            // Counter-nudge dot so it stays stationary on timeline
            if (dot) {
                const dotTransform = isLeft ? 'translate(50%, -50%)' : 'translate(-50%, -50%)';
                dot.dataset.originalTransform = dotTransform;
                dot.style.transform = `${dotTransform} translateX(${-nudge}px)`;
            }

            // Adjust connector to bridge card edge to the centered bar
            if (connector) {
                const currentWidth = connector.offsetWidth;
                connector.dataset.originalWidth = currentWidth;

                if (isLeft) {
                    // Left card moving right: shrink connector, shift it right
                    const newWidth = currentWidth - nudge;
                    connector.style.width = `${Math.max(0, newWidth)}px`;
                    connector.style.transform = `translateY(-50%) translateX(${-nudge}px)`;
                } else {
                    // Right card moving left: grow connector, shift it left
                    const newWidth = currentWidth + nudge; // nudge is negative for right cards
                    connector.style.width = `${Math.max(0, newWidth)}px`;
                    connector.style.transform = `translateY(-50%) translateX(${-nudge}px)`;
                }
                connector.dataset.originalTransformConn = 'translateY(-50%)';
            }
        }

        return 1; // Range events always return 1 to indicate processing occurred

    } else if (needsNudge) {
        // POINT EVENTS: Simple nudge, keep dot in place

        let nudge = 0;
        if (rect.left < padding) {
            nudge = padding - rect.left;
        } else if (rect.right > viewportWidth - padding) {
            nudge = (viewportWidth - padding) - rect.right;
        }

        eventEl.dataset.nudgeAmount = nudge;

        // Apply horizontal nudge to card
        eventEl.style.transform = `translateY(-50%) translateX(${nudge}px)`;

        // Counter-nudge dot so it stays stationary on timeline
        if (dot) {
            const dotTransform = isLeft ? 'translate(50%, -50%)' : 'translate(-50%, -50%)';
            dot.dataset.originalTransform = dotTransform;
            dot.style.transform = `${dotTransform} translateX(${-nudge}px)`;
        }

        // Adjust connector to bridge card to dot
        if (connector) {
            const currentWidth = connector.offsetWidth;
            connector.dataset.originalWidth = currentWidth;

            if (isLeft) {
                // Left card moving right: shrink connector, shift it right
                const newWidth = currentWidth - nudge;
                connector.style.width = `${Math.max(0, newWidth)}px`;
                connector.style.transform = `translateY(-50%) translateX(${-nudge}px)`;
                connector.dataset.originalTransformConn = 'translateY(-50%)';
            } else {
                // Right card moving left: shrink connector, shift it left
                const newWidth = currentWidth + nudge; // nudge is negative for right cards
                connector.style.width = `${Math.max(0, newWidth)}px`;
                connector.style.transform = `translateY(-50%) translateX(${-nudge}px)`;
                connector.dataset.originalTransformConn = 'translateY(-50%)';
            }
        }
    }

    // Re-enable transitions after browser paints
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (dot) dot.style.transition = '';
            if (rangeBar) rangeBar.style.transition = '';
            if (connector) connector.style.transition = '';
        });
    });

    return needsNudge ? 1 : 0;
}

/**
 * Reset a card's horizontal nudge back to original position.
 */
function resetCardNudge(eventEl) {
    // Check if we need to reset anything
    if (eventEl.dataset.originalTransform === undefined &&
        eventEl.dataset.rangeBarCentered === undefined) {
        return;
    }

    const content = eventEl.querySelector('.content');
    const dot = content?.querySelector('.event-dot');
    const rangeBar = content?.querySelector('.range-bar-indicator');
    const connector = content?.querySelector('.connector');

    // Disable transitions to prevent animation on reset
    if (dot) dot.style.transition = 'none';
    if (rangeBar) rangeBar.style.transition = 'none';
    if (connector) connector.style.transition = 'none';

    // Reset card transform
    if (eventEl.dataset.originalTransform !== undefined) {
        eventEl.style.transform = eventEl.dataset.originalTransform || 'translateY(-50%)';
        delete eventEl.dataset.originalTransform;
    }
    delete eventEl.dataset.nudgeAmount;

    // Reset range bar centered class
    if (eventEl.dataset.rangeBarCentered !== undefined) {
        if (rangeBar) {
            rangeBar.classList.remove('centered');
        }
        delete eventEl.dataset.rangeBarCentered;
    }

    // Reset dot transform
    if (dot && dot.dataset.originalTransform !== undefined) {
        dot.style.transform = dot.dataset.originalTransform;
        delete dot.dataset.originalTransform;
    }

    // Reset connector width and transform
    if (connector && connector.dataset.originalWidth !== undefined) {
        connector.style.width = '';
        connector.style.transform = connector.dataset.originalTransformConn || 'translateY(-50%)';
        delete connector.dataset.originalWidth;
        delete connector.dataset.originalTransformConn;
    }

    // Re-enable transitions after browser paints
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (dot) dot.style.transition = '';
            if (rangeBar) rangeBar.style.transition = '';
            if (connector) connector.style.transition = '';
        });
    });
}

/**
 * Auto-nudge a collapsed card into viewport on mobile during initial render.
 * Unlike nudgeCardIntoViewport(), this handles collapsed cards and
 * counter-nudges dot/range-bar/connector to maintain timeline alignment.
 * Uses instant positioning (no animation).
 *
 * @param {HTMLElement} eventEl - The event element to nudge
 */
function autoNudgeCollapsedCard(eventEl) {
    // Only apply on mobile
    if (window.innerWidth >= 600) return;

    const content = eventEl.querySelector('.content');
    if (!content) return;

    // Force layout calculation
    const rect = content.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const padding = 8; // Minimum padding from edge

    // Calculate required nudge
    let nudge = 0;
    if (rect.left < padding) {
        nudge = padding - rect.left;
    } else if (rect.right > viewportWidth - padding) {
        nudge = (viewportWidth - padding) - rect.right;
    }

    // No nudge needed
    if (Math.abs(nudge) < 1) return;

    const dot = content.querySelector('.event-dot');
    const rangeBar = content.querySelector('.range-bar-indicator');
    const connector = content.querySelector('.connector');
    const isLeft = eventEl.classList.contains('left');

    // Disable transitions for instant positioning
    eventEl.style.transition = 'none';
    if (dot) dot.style.transition = 'none';
    if (rangeBar) rangeBar.style.transition = 'none';
    if (connector) connector.style.transition = 'none';

    // Store original state for reset on hover/lock
    eventEl.dataset.autoNudge = nudge;
    eventEl.dataset.originalAutoTransform = eventEl.style.transform || 'translateY(-50%)';

    // Apply nudge to card
    eventEl.style.transform = `translateY(-50%) translateX(${nudge}px)`;

    // Counter-nudge dot to keep it stationary on timeline
    if (dot) {
        const baseDotTransform = isLeft ? 'translate(50%, -50%)' : 'translate(-50%, -50%)';
        dot.dataset.autoOriginalTransform = baseDotTransform;
        dot.style.transform = `${baseDotTransform} translateX(${-nudge}px)`;
    }

    // Counter-nudge range bar to keep it on timeline
    if (rangeBar) {
        const baseBarTransform = isLeft ? 'translate(50%, 0)' : 'translate(-50%, 0)';
        rangeBar.dataset.autoOriginalTransform = baseBarTransform;
        rangeBar.style.transform = `${baseBarTransform} translateX(${-nudge}px)`;
    }

    // Adjust connector to bridge the gap
    if (connector) {
        const currentWidth = parseFloat(getComputedStyle(connector).width) || 35;
        connector.dataset.autoOriginalWidth = currentWidth;

        // For left cards, nudging right means connector shrinks
        // For right cards, nudging left means connector shrinks (nudge is negative)
        const newWidth = isLeft ? (currentWidth - nudge) : (currentWidth + nudge);
        connector.style.width = `${Math.max(15, newWidth)}px`;
        connector.style.transform = `translateY(-50%) translateX(${-nudge}px)`;
    }

    // Re-enable transitions after browser paint
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            eventEl.style.transition = '';
            if (dot) dot.style.transition = '';
            if (rangeBar) rangeBar.style.transition = '';
            if (connector) connector.style.transition = '';
        });
    });
}

/**
 * Reset auto-nudge when card is clicked/locked (will be re-nudged by nudgeCardIntoViewport)
 * @param {HTMLElement} eventEl - The event element
 */
function resetAutoNudge(eventEl) {
    if (!eventEl.dataset.autoNudge) return;

    const content = eventEl.querySelector('.content');
    const dot = content?.querySelector('.event-dot');
    const rangeBar = content?.querySelector('.range-bar-indicator');
    const connector = content?.querySelector('.connector');

    // Restore original transforms
    eventEl.style.transform = eventEl.dataset.originalAutoTransform || 'translateY(-50%)';

    if (dot && dot.dataset.autoOriginalTransform) {
        dot.style.transform = dot.dataset.autoOriginalTransform;
        delete dot.dataset.autoOriginalTransform;
    }

    if (rangeBar && rangeBar.dataset.autoOriginalTransform) {
        rangeBar.style.transform = rangeBar.dataset.autoOriginalTransform;
        delete rangeBar.dataset.autoOriginalTransform;
    }

    if (connector && connector.dataset.autoOriginalWidth) {
        connector.style.width = '';
        connector.style.transform = 'translateY(-50%)';
        delete connector.dataset.autoOriginalWidth;
    }

    delete eventEl.dataset.autoNudge;
    delete eventEl.dataset.originalAutoTransform;
}

/**
 * Handle click-to-lock behavior for events
 */
function handleEventClick(eventEl, originalZIndex) {
    // Get the year from the event's data attribute
    const eventYear = parseFloat(eventEl.dataset.year);

    // Helper to reset nudge for both architectures
    const resetNudge = (el) => {
        if (el._timelineEntry) {
            // New architecture
            el._timelineEntry.resetNudge();
        } else {
            // Legacy architecture
            resetCardNudge(el);
        }
    };

    // Helper to nudge card into viewport for both architectures
    const nudgeIntoView = (el) => {
        if (el._timelineEntry) {
            // New architecture
            el._timelineEntry.nudgeIntoViewport();
        } else {
            // Legacy architecture
            nudgeCardIntoViewport(el);
        }
    };

    // If clicking the already-locked event, unlock it and collapse
    if (STATE.lockedEvent === eventEl) {
        eventEl.classList.remove('locked');
        eventEl.classList.remove('hovered');
        eventEl.style.zIndex = '';
        resetNudge(eventEl);
        STATE.lockedEvent = null;
        // Clear any hovered event as well (prevents card behind from staying open)
        if (STATE.hoveredEvent) {
            STATE.hoveredEvent.classList.remove('hovered');
            STATE.hoveredEvent.style.zIndex = '';
            STATE.hoveredEvent = null;
        }
        return;
    }

    // Unlock any previously locked event
    if (STATE.lockedEvent) {
        STATE.lockedEvent.classList.remove('locked');
        STATE.lockedEvent.classList.remove('hovered');
        STATE.lockedEvent.style.zIndex = '';
        resetNudge(STATE.lockedEvent);
        STATE.lockedEvent = null;
    }

    // Clear any hovered event (prevents other cards from staying open)
    if (STATE.hoveredEvent && STATE.hoveredEvent !== eventEl) {
        STATE.hoveredEvent.classList.remove('hovered');
        STATE.hoveredEvent.style.zIndex = '';
        STATE.hoveredEvent = null;
    }

    // Reset any auto-nudge before applying lock nudge (legacy only)
    if (!eventEl._timelineEntry) {
        resetAutoNudge(eventEl);
    }

    // Lock this event
    eventEl.classList.add('locked');
    eventEl.style.zIndex = 500;
    STATE.lockedEvent = eventEl;

    // Nudge card into viewport if needed (after a brief delay for CSS transitions)
    requestAnimationFrame(() => {
        nudgeIntoView(eventEl);
    });

    // Scroll to the event's year
    if (!isNaN(eventYear)) {
        scrollToYear(eventYear);
    }
}

/**
 * Setup click-away-to-unlock on the document.
 * Uses capturing phase to intercept clicks before they reach card elements.
 * This handles:
 * - Clicking on empty space closes the locked card
 * - Clicking on a card behind the locked card (within locked bounds) just closes locked
 * - Clicking on a separate card lets the click through to switch cards
 */
function setupClickAwayUnlock() {
    document.addEventListener('click', (e) => {
        if (!STATE.lockedEvent) return;

        // If clicking on the locked event itself, let it through to handleEventClick
        if (STATE.lockedEvent.contains(e.target)) return;

        // Check if click hit a different card (support both old and new architecture)
        const clickedEvent = e.target.closest('.event, .timeline-entry');
        if (clickedEvent && clickedEvent !== STATE.lockedEvent) {
            // If clicking on the currently hovered card, always let it through
            // (hovered cards are previewed above locked, so user can click to lock them)
            if (clickedEvent === STATE.hoveredEvent) {
                return;
            }

            // Check if this card is visually behind the locked card
            // For new architecture, container has height: 0, so get the card's rect
            let lockedRect;
            const lockedCard = STATE.lockedEvent.querySelector('.entry-card, .content');
            if (lockedCard) {
                lockedRect = lockedCard.getBoundingClientRect();
            } else {
                lockedRect = STATE.lockedEvent.getBoundingClientRect();
            }
            const clickInLockedBounds = (
                e.clientX >= lockedRect.left && e.clientX <= lockedRect.right &&
                e.clientY >= lockedRect.top && e.clientY <= lockedRect.bottom
            );

            if (clickInLockedBounds) {
                // Click is within locked card's visual bounds but hit a card behind it
                // User intended to tap on locked card - just close it, don't open the one behind
                e.stopImmediatePropagation();
                e.preventDefault();

                STATE.lockedEvent.classList.remove('locked');
                STATE.lockedEvent.classList.remove('hovered');
                STATE.lockedEvent.style.zIndex = '';
                // Support both architectures
                if (STATE.lockedEvent._timelineEntry) {
                    STATE.lockedEvent._timelineEntry.resetNudge();
                } else {
                    resetCardNudge(STATE.lockedEvent);
                }
                STATE.lockedEvent = null;
                if (STATE.hoveredEvent) {
                    STATE.hoveredEvent.classList.remove('hovered');
                    STATE.hoveredEvent.style.zIndex = '';
                    STATE.hoveredEvent = null;
                }
                return;
            }

            // Click is on a card that's visually separate - let it through to switch cards
            return;
        }

        // Clicking on empty space - close the locked event
        STATE.lockedEvent.classList.remove('locked');
        STATE.lockedEvent.classList.remove('hovered');
        STATE.lockedEvent.style.zIndex = '';
        // Support both architectures
        if (STATE.lockedEvent._timelineEntry) {
            STATE.lockedEvent._timelineEntry.resetNudge();
        } else {
            resetCardNudge(STATE.lockedEvent);
        }
        STATE.lockedEvent = null;
        if (STATE.hoveredEvent) {
            STATE.hoveredEvent.classList.remove('hovered');
            STATE.hoveredEvent.style.zIndex = '';
            STATE.hoveredEvent = null;
        }
    }, true); // true = capturing phase
}

/**
 * Setup smart hover - when mouse moves over stacked events, creates a sweep-through
 * effect in both directions. Moving down reveals newer cards (later in DOM),
 * moving up reveals older cards (earlier in DOM).
 *
 * When an event is locked, hovering still works on OTHER events for comparison.
 * The locked event stays visible while you can preview others.
 */
function setupSmartHover() {
    const track = document.getElementById('timelineTrack');
    if (!track) return;

    let lastY = null;

    document.addEventListener('mousemove', (e) => {
        // Determine direction of mouse movement
        const movingDown = lastY !== null && e.clientY > lastY;
        const movingUp = lastY !== null && e.clientY < lastY;
        lastY = e.clientY;

        // Check if we're in hide-labels mode
        const hideLabelsMode = document.body.classList.contains('hide-labels');

        // Get all event elements in the track (support both architectures)
        const allEvents = track.querySelectorAll('.event, .timeline-entry');

        // Find which events contain the mouse point
        const eventsUnderCursor = [];

        for (let i = 0; i < allEvents.length; i++) {
            const eventEl = allEvents[i];
            // Use cached element references from TimelineEntry instance (avoids querySelector)
            const entry = eventEl._timelineEntry;
            const card = entry ? entry.card : eventEl;
            const cardRect = card.getBoundingClientRect();

            // Quick bounds check first - skip if mouse nowhere near this card vertically
            if (e.clientY < cardRect.top - 50 || e.clientY > cardRect.bottom + 50) {
                continue;
            }

            let isUnder = false;

            if (hideLabelsMode) {
                // In hide-labels mode, only check dot and visible range bar
                const dot = entry ? entry.dot : null;
                if (dot) {
                    const dotRect = dot.getBoundingClientRect();
                    if (e.clientX >= dotRect.left - 5 && e.clientX <= dotRect.right + 5 &&
                        e.clientY >= dotRect.top - 5 && e.clientY <= dotRect.bottom + 5) {
                        isUnder = true;
                    }
                }

                if (!isUnder) {
                    const rangeBar = entry ? entry.bar : null;
                    if (rangeBar) {
                        const barRect = rangeBar.getBoundingClientRect();
                        if (barRect.height > 0 &&
                            e.clientX >= barRect.left && e.clientX <= barRect.right &&
                            e.clientY >= barRect.top && e.clientY <= barRect.bottom) {
                            isUnder = true;
                        }
                    }
                }
            } else {
                // Normal mode: check card bounds
                isUnder = (e.clientX >= cardRect.left && e.clientX <= cardRect.right &&
                           e.clientY >= cardRect.top && e.clientY <= cardRect.bottom);

                // Also check range bar if it exists
                if (!isUnder && entry && entry.bar) {
                    const barRect = entry.bar.getBoundingClientRect();
                    if (barRect.height > 0 &&
                        e.clientX >= barRect.left && e.clientX <= barRect.right &&
                        e.clientY >= barRect.top && e.clientY <= barRect.bottom) {
                        isUnder = true;
                    }
                }

                // Also check the dot
                if (!isUnder && entry && entry.dot) {
                    const dotRect = entry.dot.getBoundingClientRect();
                    isUnder = (e.clientX >= dotRect.left - 5 && e.clientX <= dotRect.right + 5 &&
                               e.clientY >= dotRect.top - 5 && e.clientY <= dotRect.bottom + 5);
                }
            }

            if (isUnder) {
                eventsUnderCursor.push(eventEl);
            }
        }

        // Filter out the locked event from hover candidates
        // (locked event stays locked, we hover OTHER events)
        let hoverCandidates = eventsUnderCursor.filter(el => el !== STATE.lockedEvent);

        // If there's a locked event, only allow hovering cards where the mouse
        // is OUTSIDE the locked card's visual bounds (i.e., hovering the peeking edge)
        if (STATE.lockedEvent && hoverCandidates.length > 0) {
            // Use cached reference to avoid querySelector
            const lockedEntry = STATE.lockedEvent._timelineEntry;
            const lockedCard = lockedEntry ? lockedEntry.card : STATE.lockedEvent;
            const lockedRect = lockedCard.getBoundingClientRect();
            const mouseInLockedBounds = (
                e.clientX >= lockedRect.left && e.clientX <= lockedRect.right &&
                e.clientY >= lockedRect.top && e.clientY <= lockedRect.bottom
            );
            if (mouseInLockedBounds) {
                // Mouse is within locked card bounds - don't hover cards behind it
                hoverCandidates = [];
            }
        }

        // If no events under cursor (excluding locked), clear hover
        if (hoverCandidates.length === 0) {
            if (STATE.hoveredEvent && STATE.hoveredEvent !== STATE.lockedEvent) {
                STATE.hoveredEvent.classList.remove('hovered');
                STATE.hoveredEvent.style.zIndex = '';
                STATE.hoveredEvent = null;
            }
            return;
        }

        // Determine which event to show based on direction
        let topmostEvent = null;

        if (hoverCandidates.length === 1) {
            // Only one event, show it
            topmostEvent = hoverCandidates[0];
        } else {
            // Multiple events - pick based on movement direction
            const currentIdx = STATE.hoveredEvent ? hoverCandidates.indexOf(STATE.hoveredEvent) : -1;

            if (currentIdx === -1) {
                // Not currently hovering any in this stack - show topmost (last in DOM)
                topmostEvent = hoverCandidates[hoverCandidates.length - 1];
            } else if (movingDown) {
                // Moving down through timeline - go to next in DOM order (newer)
                const nextIdx = Math.min(currentIdx + 1, hoverCandidates.length - 1);
                topmostEvent = hoverCandidates[nextIdx];
            } else if (movingUp) {
                // Moving up through timeline - go to previous in DOM order (older)
                const prevIdx = Math.max(currentIdx - 1, 0);
                topmostEvent = hoverCandidates[prevIdx];
            } else {
                // No movement, keep current
                topmostEvent = STATE.hoveredEvent;
            }
        }

        // If same as current hover, do nothing
        if (topmostEvent === STATE.hoveredEvent) return;

        // Remove hover from previous (but not if it's the locked event)
        if (STATE.hoveredEvent && STATE.hoveredEvent !== STATE.lockedEvent) {
            STATE.hoveredEvent.classList.remove('hovered');
            STATE.hoveredEvent.style.zIndex = '';
        }

        // Add hover to new
        if (topmostEvent) {
            topmostEvent.classList.add('hovered');
            // Hovered events go ABOVE locked (z-index 500) so previews appear on top
            topmostEvent.style.zIndex = 600;
        }

        STATE.hoveredEvent = topmostEvent;
    });

    // Clear hover when mouse leaves the document
    document.addEventListener('mouseleave', () => {
        if (STATE.hoveredEvent && STATE.hoveredEvent !== STATE.lockedEvent) {
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
    resetChannels(); // Reset channel assignments for range events
    
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
    // At high zoom (>10px/yr), show labeled decade markers
    // At medium zoom (>=1px/yr), show ticks
    // At low zoom (<1px/yr), hide decade ticks entirely
    const useDecadeMarkers = CONFIG.pxPerYear > 10;
    const showDecadeTicks = CONFIG.pxPerYear >= 1;
    
    if (showDecadeTicks) {
        for (let year = CONFIG.decadeInterval; year <= currentYear; year += CONFIG.decadeInterval) {
            if (year % CONFIG.centuryInterval !== 0) {
                if (useDecadeMarkers) {
                    track.appendChild(createDecadeMarker(year));
                } else {
                    track.appendChild(createDecadeTick(year));
                }
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
    // Sort by start year since all events (including ranges) display at start position
    // Use filtered events
    const { pointEvents, rangeEvents } = getFilteredEvents();
    
    const allEventsForRender = [
        ...pointEvents.map(e => ({ ...e, isRange: false, sortYear: e.year })),
        ...rangeEvents.map(e => ({ ...e, isRange: true, sortYear: e.year }))
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

    // Feature flag: Use new TimelineEntry architecture
    // Set to true to use new sibling-based architecture (better mobile support)
    // Set to false to use legacy nested architecture
    const USE_NEW_ARCHITECTURE = true;

    allEventsForRender.forEach((eventData, index) => {
        let eventEl;

        if (USE_NEW_ARCHITECTURE) {
            // New architecture: TimelineEntry class with sibling elements
            const entry = new TimelineEntry(eventData, index);
            entry.assignChannel(); // Assign channel before render
            eventEl = entry.render();
        } else {
            // Legacy architecture: nested elements
            if (eventData.isRange) {
                eventEl = createRangeBar(eventData, index, maxDuration);
            } else {
                eventEl = createEvent(eventData, index);
            }
        }

        track.appendChild(eventEl);

        // Auto-nudge collapsed cards into viewport on mobile (legacy only)
        if (!USE_NEW_ARCHITECTURE) {
            requestAnimationFrame(() => {
                autoNudgeCollapsedCard(eventEl);
            });
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
    const yearCELabel = document.getElementById('yearCELabel');
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
    if (yearInputCE) yearInputCE.value = converted.year;
    if (yearCELabel) yearCELabel.textContent = converted.era === 'BCE' ? 'BCE' : 'CE\u00A0';
    
    if (scrollProgress) {
        const scrollPercent = (displayYear / currentYear) * 100;
        scrollProgress.style.width = scrollPercent + '%';
    }
}

/**
 * Scroll to a specific year on the timeline
 * @param {number} year - Year in HE to scroll to
 */
function scrollToYear(year, options = {}) {
    const { center = false, padding = 100 } = options;

    const currentYear = getCurrentHoloceneYear();
    const clampedYear = Math.max(0, Math.min(currentYear, year));

    const trackOffset = getTrackOffset();
    const yearPx = yearToPixels(clampedYear);
    const yearPositionOnPage = trackOffset + yearPx;

    // If center mode, scroll to put year at reference point (old behavior)
    if (center) {
        const referencePoint = getReferencePoint();
        const targetScroll = yearPositionOnPage - referencePoint;
        window.scrollTo({
            top: Math.max(0, targetScroll),
            behavior: 'smooth'
        });
        return;
    }

    // Otherwise, scroll only as needed to bring year into view
    const viewportTop = window.scrollY;
    const viewportBottom = viewportTop + window.innerHeight;

    // Check if year is already visible (with some padding)
    const yearViewportPos = yearPositionOnPage - viewportTop;
    const topBar = document.querySelector('.top-bar');
    const topBarHeight = topBar ? topBar.offsetHeight : 80;
    const footer = document.querySelector('footer');
    const footerHeight = footer ? footer.offsetHeight : 60;

    const visibleTop = topBarHeight + padding;
    const visibleBottom = window.innerHeight - footerHeight - padding;

    if (yearViewportPos >= visibleTop && yearViewportPos <= visibleBottom) {
        // Already visible, no scroll needed
        return;
    }

    // Calculate minimum scroll to bring into view
    let targetScroll;
    if (yearViewportPos < visibleTop) {
        // Need to scroll up - put year near top of visible area
        targetScroll = yearPositionOnPage - topBarHeight - padding;
    } else {
        // Need to scroll down - put year near bottom of visible area
        targetScroll = yearPositionOnPage - window.innerHeight + footerHeight + padding;
    }

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
    
    // Track the value when focus started, to detect changes
    let heValueOnFocus = '';
    let ceValueOnFocus = '';
    
    // ===== HE Year Input =====
    if (yearInput) {
        yearInput.addEventListener('focus', () => {
            isEditingYear = true;
            heValueOnFocus = yearInput.value;
            yearInput.select();
        });
        
        yearInput.addEventListener('blur', () => {
            // Only navigate if value changed
            const currentValue = yearInput.value;
            if (currentValue !== heValueOnFocus) {
                const inputValue = currentValue.replace(/,/g, '').trim();
                const targetYear = parseDateToHE(inputValue);

                if (!isNaN(targetYear)) {
                    isEditingYear = false;
                    scrollToYear(targetYear, { center: true });
                    return;
                }
            }
            isEditingYear = false;
            updateYearDisplay();
        });
        
        yearInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                yearInput.blur(); // Let blur handler do the navigation
            } else if (e.key === 'Escape') {
                yearInput.value = heValueOnFocus; // Restore original
                isEditingYear = false;
                yearInput.blur();
            }
        });
    }
    
    // ===== CE/BCE Year Input =====
    if (yearInputCE) {
        yearInputCE.addEventListener('focus', () => {
            isEditingYear = true;
            // Append the current era to the value so user knows context
            const currentEra = document.getElementById('yearCELabel')?.textContent?.trim() || 'CE';
            const currentValue = yearInputCE.value.replace(/,/g, '');
            ceValueOnFocus = `${currentValue} ${currentEra}`;
            yearInputCE.value = ceValueOnFocus;
            yearInputCE.select();
        });
        
        yearInputCE.addEventListener('blur', () => {
            // Only navigate if value changed
            const currentValue = yearInputCE.value;
            if (currentValue !== ceValueOnFocus) {
                const inputValue = currentValue.replace(/,/g, '').trim();
                const targetYear = parseCEDateToHE(inputValue);

                if (!isNaN(targetYear)) {
                    isEditingYear = false;
                    scrollToYear(targetYear, { center: true });
                    return;
                }
            }
            isEditingYear = false;
            updateYearDisplay();
        });
        
        yearInputCE.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                yearInputCE.blur(); // Let blur handler do the navigation
            } else if (e.key === 'Escape') {
                yearInputCE.value = ceValueOnFocus; // Restore original
                isEditingYear = false;
                yearInputCE.blur();
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
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    
    if (slider) {
        slider.min = CONFIG.minPxPerYear;
        slider.max = CONFIG.maxPxPerYear;
        slider.step = 0.5;
        slider.value = CONFIG.pxPerYear;
        
        // Add transparency during slider interaction
        slider.addEventListener('mousedown', () => {
            sidebar?.classList.add('adjusting-scale');
            sidebarOverlay?.classList.add('adjusting-scale');
        });
        slider.addEventListener('touchstart', () => {
            sidebar?.classList.add('adjusting-scale');
            sidebarOverlay?.classList.add('adjusting-scale');
        });
        
        const removeTransparency = () => {
            sidebar?.classList.remove('adjusting-scale');
            sidebarOverlay?.classList.remove('adjusting-scale');
        };
        slider.addEventListener('mouseup', removeTransparency);
        slider.addEventListener('touchend', removeTransparency);
        document.addEventListener('mouseup', removeTransparency);
        document.addEventListener('touchend', removeTransparency);
        
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
        
        // Scroll to the new event (center it since user just added it)
        setTimeout(() => {
            scrollToYear(newEvent.year, { center: true });
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

// ============ TOP BAR HEIGHT ============

/**
 * Measure the top bar height and set it as a CSS variable
 * This allows other elements (like sidebar) to position relative to it
 */
function updateTopBarHeight() {
    const topBar = document.getElementById('topBar');
    if (topBar) {
        document.documentElement.style.setProperty('--top-bar-height', topBar.offsetHeight + 'px');
    }
}

/**
 * Measure the footer height and set it as a CSS variable
 * This allows elements to add padding/margin to clear the fixed footer
 */
function updateFooterHeight() {
    const footer = document.querySelector('footer');
    if (footer) {
        document.documentElement.style.setProperty('--footer-height', footer.offsetHeight + 'px');
    }
}

// ============ INITIALIZE ============

async function init() {
    console.log('Initializing timeline...');
    console.log('Current Holocene Year:', getCurrentHoloceneYear());
    
    // Set top bar height CSS variable (used by sidebar positioning)
    updateTopBarHeight();
    window.addEventListener('resize', updateTopBarHeight);
    
    // Set footer height CSS variable (used for bottom padding)
    updateFooterHeight();
    window.addEventListener('resize', updateFooterHeight);
    
    // Ensure page starts at top (fixes mobile scroll issues)
    window.scrollTo(0, 0);
    
    // Update the current year display in the header
    const currentYearDisplay = document.getElementById('currentYearDisplay');
    if (currentYearDisplay) {
        currentYearDisplay.textContent = getCurrentHoloceneYear().toLocaleString();
    }
    
    // Load core dataset
    await loadAllDatasets(['events/core.json']);
    
    // Render timeline
    renderTimeline();
    
    // Setup controls
    setupScaleControl();
    setupYearInput();
    setupNavButtons();
    setupFilterControls();
    setupRangeToggle();
    setupSpreadRangesToggle();
    setupAgeToggle();
    setupShowLabelsToggle();
    // setupMobileControls();
    setupSidebarControls()
    setupClickAwayUnlock();
    setupSmartHover();
    
    // Setup scroll tracking (throttled for performance)
    updateYearDisplay();
    window.addEventListener('scroll', throttleRAF(updateYearDisplay));
    window.addEventListener('resize', throttleRAF(updateYearDisplay));

    // Re-render timeline when crossing mobile/desktop threshold
    let lastViewportCategory = window.innerWidth < 600 ? 'mobile' : 'desktop';
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            const currentCategory = window.innerWidth < 600 ? 'mobile' : 'desktop';
            if (currentCategory !== lastViewportCategory) {
                lastViewportCategory = currentCategory;
                // Clear locked/hovered state
                if (STATE.lockedEvent) {
                    STATE.lockedEvent.classList.remove('locked');
                    resetCardNudge(STATE.lockedEvent);
                    STATE.lockedEvent = null;
                }
                if (STATE.hoveredEvent) {
                    STATE.hoveredEvent.classList.remove('hovered');
                    STATE.hoveredEvent = null;
                }
                // Re-render with new channel config
                renderTimeline();
            }
        }, 250);
    });

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
