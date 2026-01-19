// ================================================================================
// FOOTBALL ROTATION SOLVER - Client-side MILP using GLPK.js
// ================================================================================
// This app creates fair player rotation schedules for 5-a-side football teams
// using Mixed Integer Linear Programming (MILP) to optimize fairness across
// positions, goalie time, and substitute time.
// ================================================================================

import GLPK from "https://esm.sh/glpk.js@4.0.2";

// ================================================================================
// CONFIGURATION & CONSTANTS
// ================================================================================

const DEFAULT_ROLES = [
    { name: "Defender" },
    { name: "Left" },
    { name: "Right" },
    { name: "Striker" },
];

// ================================================================================
// DOM REFERENCES
// ================================================================================

const POS_EL = document.getElementById("positions");
const ADD_ROLE_BTN = document.getElementById("addRole");
const SOLVE_BTN = document.getElementById("solveBtn");
const STATUS_EL = document.getElementById("status");
const ERROR_MSG_EL = document.getElementById("errorMsg");
const SCHEDULE_EL = document.getElementById("schedule");
const SCHEDULE_NOTE_EL = document.getElementById("scheduleNote");
const TOTALS_EL = document.getElementById("totals");
const HELP_HEADER = document.getElementById("helpHeader");
const HELP_TOGGLE = document.getElementById("helpToggle");
const HELP_CONTENT = document.getElementById("helpContent");
const TOTALS_HEADER = document.getElementById("totalsHeader");
const TOTALS_TOGGLE = document.getElementById("totalsToggle");
const TOTALS_CONTENT = document.getElementById("totalsContent");
const SQUAD_SIZE_EL = document.getElementById("squadSize");
const NAMES_TEXTAREA = document.getElementById("names");
const TIMER_BLOCK = document.getElementById("timerBlock");
const TIMER_BTN = document.getElementById("timerBtn");
const TIMER_DURATION = document.getElementById("timerDuration");
const TIMER_DISPLAY = document.getElementById("timerDisplay");
const NAMES_HEADER = document.getElementById("namesHeader");
const NAMES_TOGGLE = document.getElementById("namesToggle");
const NAMES_CONTENT = document.getElementById("namesContent");
const MATCHES_HEADER = document.getElementById("matchesHeader");
const MATCHES_TOGGLE = document.getElementById("matchesToggle");
const MATCHES_CONTENT = document.getElementById("matchesContent");
const POSITIONS_HEADER = document.getElementById("positionsHeader");
const POSITIONS_TOGGLE = document.getElementById("positionsToggle");
const POSITIONS_CONTENT = document.getElementById("positionsContent");
const SEED_INPUT = document.getElementById("seed");

// ================================================================================
// UI STATE MANAGEMENT
// ================================================================================

let roles = structuredClone(DEFAULT_ROLES);

// ================================================================================
// SEEDED RANDOM NUMBER GENERATOR
// ================================================================================

/**
 * Simple seeded random number generator (mulberry32)
 * Returns a function that generates random numbers in [0,1)
 */
function seededRandom(seed) {
    let state = seed;
    return function () {
        state |= 0;
        state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Hash a string to a number seed
 */
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
}

/**
 * Get current week number in format YYYY-WW
 */
function getCurrentWeek() {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 1);
    const diff = now - start;
    const oneWeek = 1000 * 60 * 60 * 24 * 7;
    const weekNum = Math.ceil(diff / oneWeek);
    return `${now.getFullYear()}-${String(weekNum).padStart(2, '0')}`;
}

// Seed will be initialized from cookie or set to current week below

// ================================================================================
// UTILITY FUNCTIONS
// ================================================================================

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(s) {
    return (s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * Sanitize string for use in variable names (remove special chars)
 */
function safe(s) {
    return String(s).replaceAll(/[^a-zA-Z0-9_]/g, "_");
}

/**
 * Show error message in UI
 */
function showError(message) {
    ERROR_MSG_EL.innerHTML = `<div class="alert alert-error">${escapeHtml(message)}</div>`;
    STATUS_EL.textContent = "Error.";
    SCHEDULE_EL.innerHTML = "";
    SCHEDULE_NOTE_EL.style.display = "none";
    TOTALS_EL.innerHTML = "";
}

/**
 * Clear error message
 */
function clearError() {
    ERROR_MSG_EL.innerHTML = "";
}

/**
 * Show progress with spinner
 */
function showProgress(message) {
    STATUS_EL.innerHTML = `<span class="spinner"></span><span class="progress-text">${escapeHtml(message)}</span>`;
}

// ================================================================================
// SQUAD SIZE COUNTER
// ================================================================================

/**
 * Update the squad size display based on the number of player names
 */
function updateSquadSize() {
    const playerCount = NAMES_TEXTAREA.value
        .split("\n")
        .map(s => s.trim())
        .filter(Boolean)
        .length;
    SQUAD_SIZE_EL.textContent = playerCount;
}

/**
 * Save player names to a cookie
 */
function saveNamesToCookie() {
    const names = NAMES_TEXTAREA.value;
    // Set cookie to expire in 365 days
    const expires = new Date();
    expires.setTime(expires.getTime() + (365 * 24 * 60 * 60 * 1000));
    document.cookie = `playerNames=${encodeURIComponent(names)}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;
}

/**
 * Load player names from cookie
 */
function loadNamesFromCookie() {
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'playerNames') {
            NAMES_TEXTAREA.value = decodeURIComponent(value);
            return;
        }
    }
}

/**
 * Save seed to a cookie
 */
function saveSeedToCookie() {
    const seed = SEED_INPUT.value;
    const expires = new Date();
    expires.setTime(expires.getTime() + (365 * 24 * 60 * 60 * 1000));
    document.cookie = `seed=${encodeURIComponent(seed)}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;
}

/**
 * Load seed from cookie
 */
function loadSeedFromCookie() {
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'seed') {
            SEED_INPUT.value = decodeURIComponent(value);
            return;
        }
    }
}

// Update squad size and save to cookie on input
NAMES_TEXTAREA.addEventListener("input", () => {
    updateSquadSize();
    saveNamesToCookie();
});

// Save seed to cookie on input
SEED_INPUT.addEventListener("input", saveSeedToCookie);

// Load names and seed from cookies and initialize squad size on load
loadNamesFromCookie();
loadSeedFromCookie();
// If no seed was loaded from cookie, set to current week
if (!SEED_INPUT.value) {
    SEED_INPUT.value = getCurrentWeek();
}
updateSquadSize();

// ================================================================================
// COLLAPSIBLE SECTION TOGGLES
// ================================================================================

HELP_HEADER.onclick = () => {
    const isHidden = HELP_CONTENT.classList.contains("hidden");
    if (isHidden) {
        HELP_CONTENT.classList.remove("hidden");
        HELP_TOGGLE.textContent = "−";
    } else {
        HELP_CONTENT.classList.add("hidden");
        HELP_TOGGLE.textContent = "+";
    }
};

TOTALS_HEADER.onclick = () => {
    const isHidden = TOTALS_CONTENT.classList.contains("hidden");
    if (isHidden) {
        TOTALS_CONTENT.classList.remove("hidden");
        TOTALS_TOGGLE.textContent = "−";
    } else {
        TOTALS_CONTENT.classList.add("hidden");
        TOTALS_TOGGLE.textContent = "+";
    }
};

NAMES_HEADER.onclick = () => {
    const isHidden = NAMES_CONTENT.classList.contains("hidden");
    if (isHidden) {
        NAMES_CONTENT.classList.remove("hidden");
        NAMES_TOGGLE.textContent = "−";
    } else {
        NAMES_CONTENT.classList.add("hidden");
        NAMES_TOGGLE.textContent = "+";
    }
};

MATCHES_HEADER.onclick = () => {
    const isHidden = MATCHES_CONTENT.classList.contains("hidden");
    if (isHidden) {
        MATCHES_CONTENT.classList.remove("hidden");
        MATCHES_TOGGLE.textContent = "−";
    } else {
        MATCHES_CONTENT.classList.add("hidden");
        MATCHES_TOGGLE.textContent = "+";
    }
};

POSITIONS_HEADER.onclick = () => {
    const isHidden = POSITIONS_CONTENT.classList.contains("hidden");
    if (isHidden) {
        POSITIONS_CONTENT.classList.remove("hidden");
        POSITIONS_TOGGLE.textContent = "−";
    } else {
        POSITIONS_CONTENT.classList.add("hidden");
        POSITIONS_TOGGLE.textContent = "+";
    }
};

// ================================================================================
// ROLE/POSITION MANAGEMENT
// ================================================================================

/**
 * Render the dynamic roles editor
 */
function renderRoles() {
    POS_EL.innerHTML = "";
    roles.forEach((r, idx) => {
        const row = document.createElement("div");
        row.style.marginBottom = "8px";
        row.style.display = "flex";
        row.style.gap = "12px";
        row.style.alignItems = "flex-end";

        const inputWrapper = document.createElement("div");
        inputWrapper.style.flex = "1";
        inputWrapper.innerHTML = `
            <label>Position ${idx + 1}</label>
            <input type="text" data-idx="${idx}" value="${escapeHtml(r.name)}" placeholder="Position name" />
        `;
        row.appendChild(inputWrapper);

        const del = document.createElement("button");
        del.type = "button";
        del.className = "secondary";
        del.innerHTML = '<span class="material-icons" style="font-size: 18px; vertical-align: middle; margin-right: 4px;">remove_circle_outline</span>Remove';
        del.onclick = () => {
            roles.splice(idx, 1);
            renderRoles();
        };
        row.appendChild(del);

        POS_EL.appendChild(row);
    });

    // Attach input listeners
    POS_EL.querySelectorAll("input").forEach(inp => {
        inp.addEventListener("input", (e) => {
            const idx = Number(e.target.dataset.idx);
            roles[idx].name = e.target.value.trim() || `Position${idx + 1}`;
        });
    });
}

ADD_ROLE_BTN.onclick = () => {
    roles.push({ name: `Position${roles.length + 1}` });
    renderRoles();
};

renderRoles();

// ================================================================================
// INPUT VALIDATION & PARAMETER COLLECTION
// ================================================================================

/**
 * Shuffle array randomly (Fisher-Yates algorithm)
 * @param {Array} array - Array to shuffle
 * @param {Function} rng - Random number generator function (returns [0,1))
 */
function shuffleArray(array, rng = Math.random) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * Collect and validate all parameters from the UI
 * @throws {Error} if validation fails
 */
function getParams() {
    const playerNames = document.getElementById("names").value
        .split("\n")
        .map(s => s.trim())
        .filter(Boolean);

    const numMatches = Number(document.getElementById("matches").value);
    const periodsPerMatch = Number(document.getElementById("periodsPerMatch").value);
    const goalieStays = document.getElementById("goalieStays").checked;
    const noConsecSubs = document.getElementById("noConsecSubs").checked;
    const keepPositions = document.getElementById("keepPositions").checked;

    // Validation
    if (playerNames.length < 1) {
        throw new Error("Please enter at least one player name.");
    }

    // Check for duplicate names
    const nameSet = new Set(playerNames);
    if (nameSet.size !== playerNames.length) {
        throw new Error("Duplicate player names detected. Each player must have a unique name.");
    }

    if (!Number.isFinite(numMatches) || numMatches < 1) {
        throw new Error("Number of matches must be at least 1.");
    }

    if (!Number.isFinite(periodsPerMatch) || periodsPerMatch !== 2) {
        throw new Error("Periods per match must be 2 (to model halftime swap).");
    }

    // Fixed constraint: always 1 goalie per period
    const goaliePerPeriod = 1;

    // Process outfield roles - always 1 of each position
    const outfield = roles
        .map(r => ({ name: r.name.trim(), count: 1 }))
        .filter(r => r.name);

    if (outfield.length === 0) {
        throw new Error("Please add at least one outfield position.");
    }

    // Check for duplicate role names
    const roleNames = outfield.map(r => r.name);
    const roleSet = new Set(roleNames);
    if (roleSet.size !== roleNames.length) {
        throw new Error("Duplicate position names detected. Each position must have a unique name.");
    }

    const teamSize = goaliePerPeriod + outfield.reduce((a, r) => a + r.count, 0);
    const subsCount = playerNames.length - teamSize;

    if (subsCount < 0) {
        throw new Error(
            `Not enough players for the team configuration. You have ${playerNames.length} players ` +
            `but need ${teamSize} on the pitch (1 goalie + ${teamSize - 1} outfield). ` +
            `Either add more players or reduce role counts.`
        );
    }

    return {
        playerNames,
        numMatches,
        periodsPerMatch,
        goaliePerPeriod,
        outfield,
        goalieStays,
        noConsecSubs,
        keepPositions
    };
}

// ================================================================================
// MILP MODEL BUILDING
// ================================================================================

/**
 * Build the MILP problem using GLPK
 * @param {Object} glpk - GLPK instance
 * @param {Object} params - Problem parameters
 * @param {Function} rng - Random number generator function
 * @returns {Object} LP problem and metadata
 */
function buildProblem(glpk, params, rng = Math.random) {
    const {
        playerNames, numMatches, periodsPerMatch,
        goaliePerPeriod, outfield, goalieStays, noConsecSubs, keepPositions
    } = params;

    const N = playerNames.length;
    const outfieldRoles = outfield.map(r => r.name);
    const outfieldCounts = Object.fromEntries(outfield.map(r => [r.name, r.count]));

    const teamSize = goaliePerPeriod + outfield.reduce((a, r) => a + r.count, 0);
    const subsCount = N - teamSize;

    // Number of players who stay on pitch for BOTH periods of a match
    // (includes goalie + some outfielders who don't get subbed)
    // Only relevant when we have subs
    const stayersPerMatch = teamSize - subsCount;

    if (subsCount > 0 && stayersPerMatch < goaliePerPeriod) {
        throw new Error(
            `Impossible halftime swap configuration: stayersPerMatch=${stayersPerMatch}, ` +
            `but need at least ${goaliePerPeriod} for goalie.`
        );
    }

    const matches = [...Array(numMatches).keys()];
    const periods = [...Array(periodsPerMatch).keys()];
    const periodList = matches.flatMap(m => periods.map(p => ({ m, p })));

    // Only include "Sub" role if we have subs
    const ROLES = subsCount > 0 ? ["Sub", "G", ...outfieldRoles] : ["G", ...outfieldRoles];

    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/3019f3c6-66c4-4b96-99cc-c258125898e3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'subs.js:BUILD_ROLES', message: 'Building ROLES array', data: { subsCount, ROLES, N, teamSize }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'zero-subs-debug', hypothesisId: 'H5' }) }).catch(() => { });
    // #endregion

    // ============================================================================
    // Variable name generators
    // ============================================================================
    const x = (i, m, p, r) => `x_${i}_m${m}_p${p}_${safe(r)}`; // player i, match m, period p, role r
    const o = (i, m, p) => `o_${i}_m${m}_p${p}`; // on_pitch indicator
    const y = (i, m) => `y_${i}_m${m}`; // stayer (both periods in match)

    // ============================================================================
    // Constraint builders
    // ============================================================================
    const subjectTo = [];
    const bounds = [];
    const binaries = [];

    function addEq(name, vars, rhs) {
        subjectTo.push({
            name,
            vars,
            bnds: { type: glpk.GLP_FX, lb: rhs, ub: rhs }
        });
    }

    function addLe(name, vars, rhs) {
        subjectTo.push({
            name,
            vars,
            bnds: { type: glpk.GLP_UP, lb: 0, ub: rhs }
        });
    }

    // ============================================================================
    // Declare binary variables
    // ============================================================================
    for (let i = 0; i < N; i++) {
        for (const { m, p } of periodList) {
            for (const r of ROLES) {
                binaries.push(x(i, m, p, r));
            }
        }
    }

    // Only declare o and y variables if we have subs (needed for halftime swap constraint)
    if (subsCount > 0) {
        for (let i = 0; i < N; i++) {
            for (const m of matches) {
                for (const p of periods) {
                    binaries.push(o(i, m, p));
                }
                binaries.push(y(i, m));
            }
        }
    }

    // No additional continuous variables needed (we removed fairness deviation vars)

    // ============================================================================
    // CONSTRAINT 1: Each player has exactly one role per period
    // ============================================================================
    for (let i = 0; i < N; i++) {
        for (const { m, p } of periodList) {
            addEq(
                `oneRole_i${i}_m${m}_p${p}`,
                ROLES.map(r => ({ name: x(i, m, p, r), coef: 1 })),
                1
            );
        }
    }

    // ============================================================================
    // CONSTRAINT 2: Role counts per period (goalie, outfield roles, subs)
    // ============================================================================
    for (const { m, p } of periodList) {
        // Exactly 1 goalie per period
        addEq(
            `goalieCount_m${m}_p${p}`,
            [...Array(N).keys()].map(i => ({ name: x(i, m, p, "G"), coef: 1 })),
            goaliePerPeriod
        );

        // Exact count for each outfield role
        for (const r of outfieldRoles) {
            addEq(
                `roleCount_${safe(r)}_m${m}_p${p}`,
                [...Array(N).keys()].map(i => ({ name: x(i, m, p, r), coef: 1 })),
                outfieldCounts[r]
            );
        }

        // Remaining players are subs (only if we have subs)
        if (subsCount > 0) {
            addEq(
                `subCount_m${m}_p${p}`,
                [...Array(N).keys()].map(i => ({ name: x(i, m, p, "Sub"), coef: 1 })),
                subsCount
            );
        }
    }

    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/3019f3c6-66c4-4b96-99cc-c258125898e3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'subs.js:ROLE_COUNTS', message: 'Added role count constraints', data: { subsCount, addedSubConstraint: subsCount > 0 }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'zero-subs-debug', hypothesisId: 'H2' }) }).catch(() => { });
    // #endregion

    // ============================================================================
    // CONSTRAINT 3: Goalie stays for both periods of a match (optional)
    // ============================================================================
    if (goalieStays) {
        for (let i = 0; i < N; i++) {
            for (const m of matches) {
                addEq(
                    `goalieFixed_i${i}_m${m}`,
                    [
                        { name: x(i, m, 0, "G"), coef: 1 },
                        { name: x(i, m, 1, "G"), coef: -1 },
                    ],
                    0
                );
            }
        }
    }

    // ============================================================================
    // CONSTRAINT 4: No consecutive subs across all periods
    // ============================================================================
    if (noConsecSubs) {
        for (let i = 0; i < N; i++) {
            for (let t = 0; t < periodList.length - 1; t++) {
                const a = periodList[t];
                const b = periodList[t + 1];
                addLe(
                    `noConsecSub_i${i}_t${t}`,
                    [
                        { name: x(i, a.m, a.p, "Sub"), coef: 1 },
                        { name: x(i, b.m, b.p, "Sub"), coef: 1 },
                    ],
                    1
                );
            }
        }
    }

    // ============================================================================
    // CONSTRAINT 5: Halftime swap model (stayers per match)
    // ============================================================================
    // Only apply this constraint if we have subs. With zero subs, everyone is
    // on pitch all the time and can freely rotate positions at halftime.

    if (subsCount > 0) {
        // o(i,m,p) = 1 - x_sub(i,m,p)  =>  o(i,m,p) + x_sub(i,m,p) = 1
        // y(i,m) = AND(o(i,m,0), o(i,m,1)) implemented with:
        //   y <= o0, y <= o1, y >= o0 + o1 - 1
        // sum_i y(i,m) = stayersPerMatch

        for (let i = 0; i < N; i++) {
            for (const m of matches) {
                for (const p of periods) {
                    addEq(
                        `onPitchDef_i${i}_m${m}_p${p}`,
                        [
                            { name: o(i, m, p), coef: 1 },
                            { name: x(i, m, p, "Sub"), coef: 1 },
                        ],
                        1
                    );
                }

                // y <= o0
                addLe(`and1_i${i}_m${m}`, [{ name: y(i, m), coef: 1 }, { name: o(i, m, 0), coef: -1 }], 0);
                // y <= o1
                addLe(`and2_i${i}_m${m}`, [{ name: y(i, m), coef: 1 }, { name: o(i, m, 1), coef: -1 }], 0);
                // y >= o0 + o1 - 1  =>  -y + o0 + o1 <= 1
                addLe(`and3_i${i}_m${m}`, [{ name: y(i, m), coef: -1 }, { name: o(i, m, 0), coef: 1 }, { name: o(i, m, 1), coef: 1 }], 1);
            }
        }

        for (const m of matches) {
            addEq(
                `stayers_m${m}`,
                [...Array(N).keys()].map(i => ({ name: y(i, m), coef: 1 })),
                stayersPerMatch
            );
        }
    }

    // ============================================================================
    // CONSTRAINT 6: Keep positions within match (optional)
    // ============================================================================
    // Players who stay on pitch keep their exact position.
    // Only subs coming on/off can change positions.

    if (keepPositions) {
        if (subsCount > 0) {
            // With subs: use y(i,m) stayer variable
            // If player i had role r in period 0 AND stayed on (y=1), must have role r in period 1
            // Formulation: x(i,m,0,r) + y(i,m) - 1 <= x(i,m,1,r)
            // Rearranged: x(i,m,0,r) + y(i,m) - x(i,m,1,r) <= 1
            for (const r of outfieldRoles) {
                for (let i = 0; i < N; i++) {
                    for (const m of matches) {
                        addLe(
                            `keepPos_i${i}_m${m}_${safe(r)}`,
                            [
                                { name: x(i, m, 0, r), coef: 1 },
                                { name: y(i, m), coef: 1 },
                                { name: x(i, m, 1, r), coef: -1 }
                            ],
                            1
                        );
                    }
                }
            }
        } else {
            // Without subs: everyone stays on, so lock all positions for both periods
            for (const r of outfieldRoles) {
                for (let i = 0; i < N; i++) {
                    for (const m of matches) {
                        addEq(
                            `keepPos_i${i}_m${m}_${safe(r)}`,
                            [
                                { name: x(i, m, 0, r), coef: 1 },
                                { name: x(i, m, 1, r), coef: -1 }
                            ],
                            0
                        );
                    }
                }
            }
        }
    }

    // ============================================================================
    // FAIRNESS CONSTRAINTS: Min/Max bounds for each role
    // ============================================================================
    // Instead of optimizing, enforce simple min/max bounds so no one gets too many
    // or too few assignments in any role

    const totalPeriods = numMatches * periodsPerMatch;

    const roleSlots = {
        G: totalPeriods * goaliePerPeriod,
    };

    // Only add Sub to roleSlots if we have subs
    if (subsCount > 0) {
        roleSlots.Sub = totalPeriods * subsCount;
    }

    for (const r of outfieldRoles) {
        roleSlots[r] = totalPeriods * outfieldCounts[r];
    }

    // For each role, calculate fair min/max per player
    // Allow some flexibility: use floor(avg-0.5) to ceil(avg+0.5) for better feasibility
    const fairnessBounds = {};
    const fairnessRoles = subsCount > 0 ? ["Sub", "G", ...outfieldRoles] : ["G", ...outfieldRoles];

    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/3019f3c6-66c4-4b96-99cc-c258125898e3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'subs.js:FAIRNESS_ROLES', message: 'Setting up fairness constraints', data: { fairnessRoles, roleSlots }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'zero-subs-debug', hypothesisId: 'H1' }) }).catch(() => { });
    // #endregion

    for (const r of fairnessRoles) {
        const avgSlots = roleSlots[r] / N;

        // Be more lenient: allow +/- 1 from average (or more if needed)
        // For small problems, we need extra flexibility
        let minSlots = Math.max(0, Math.floor(avgSlots - 0.5));
        let maxSlots = Math.ceil(avgSlots + 0.5);

        // Special case for Goalie when goalieStays is true:
        // Goalie assignments must come in pairs (both periods of a match)
        // So we need to round to even numbers
        if (r === "G" && goalieStays) {
            minSlots = Math.floor(minSlots / 2) * 2; // Round down to nearest even
            maxSlots = Math.ceil(maxSlots / 2) * 2;  // Round up to nearest even
        }

        fairnessBounds[r] = { min: minSlots, max: maxSlots, avg: avgSlots.toFixed(2) };

        // Each player should have between minSlots and maxSlots assignments for this role
        for (let i = 0; i < N; i++) {
            const playerRoleVars = periodList.map(({ m, p }) => ({ name: x(i, m, p, r), coef: 1 }));

            // Lower bound: sum >= minSlots (only if minSlots > 0)
            if (minSlots > 0) {
                subjectTo.push({
                    name: `fairMin_i${i}_${safe(r)}`,
                    vars: playerRoleVars,
                    bnds: { type: glpk.GLP_LO, lb: minSlots, ub: 0 }
                });
            }

            // Upper bound: sum <= maxSlots
            subjectTo.push({
                name: `fairMax_i${i}_${safe(r)}`,
                vars: playerRoleVars,
                bnds: { type: glpk.GLP_UP, lb: 0, ub: maxSlots }
            });
        }
    }

    // Log fairness bounds for debugging
    console.log('Fairness bounds per player:', fairnessBounds);

    // ============================================================================
    // OBJECTIVE: Add small random weights to break ties and get variety
    // ============================================================================
    const objVars = [];

    // Add tiny random weights to each assignment to get different solutions
    // These weights are so small (0.0001) they won't affect fairness, just break ties
    // Use the same ROLES array we defined earlier (which excludes Sub if subsCount = 0)
    for (let i = 0; i < N; i++) {
        for (const { m, p } of periodList) {
            for (const r of ROLES) {
                const randomWeight = rng() * 0.0001;
                objVars.push({ name: x(i, m, p, r), coef: randomWeight });
            }
        }
    }

    // Fallback if something goes wrong
    if (objVars.length === 0) {
        objVars.push({ name: x(0, 0, 0, ROLES[0]), coef: 0 });
    }

    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/3019f3c6-66c4-4b96-99cc-c258125898e3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'subs.js:OBJECTIVE', message: 'Built objective', data: { numObjVars: objVars.length }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'zero-subs-debug', hypothesisId: 'H1' }) }).catch(() => { });
    // #endregion

    const lp = {
        name: "FootballRotation",
        objective: {
            direction: glpk.GLP_MIN,
            name: "feasibility",
            vars: objVars,
        },
        subjectTo,
        bounds,
        binaries,
    };

    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/3019f3c6-66c4-4b96-99cc-c258125898e3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'subs.js:LP_BUILT', message: 'LP problem built', data: { numConstraints: subjectTo.length, numBinaries: binaries.length, numBounds: bounds.length, ROLES, subsCount }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'zero-subs-debug', hypothesisId: 'H1' }) }).catch(() => { });
    // #endregion

    return { lp, meta: { N, teamSize, subsCount, stayersPerMatch, outfieldRoles, fairnessBounds } };
}

// ================================================================================
// SOLUTION DECODING
// ================================================================================

/**
 * Decode the GLPK solution into a human-readable schedule
 * @param {Object} params - Problem parameters
 * @param {Object} sol - GLPK solution
 * @param {Object} meta - Metadata from buildProblem
 * @returns {Object} schedule and totals
 */
function decodeSolution(params, sol, meta) {
    const { playerNames, numMatches, periodsPerMatch } = params;
    const { outfieldRoles } = meta;
    const roles = ["G", ...outfieldRoles, "Sub"];

    const values = sol.result?.vars || sol.vars;
    const get = (v) => (values?.[v] ?? 0);

    const x = (i, m, p, r) => `x_${i}_m${m}_p${p}_${safe(r)}`;

    const schedule = [];
    for (let m = 0; m < numMatches; m++) {
        for (let p = 0; p < periodsPerMatch; p++) {
            const row = { match: m + 1, period: p + 1 };
            for (const r of roles) row[r] = [];
            for (let i = 0; i < playerNames.length; i++) {
                for (const r of roles) {
                    if (get(x(i, m, p, r)) > 0.5) {
                        row[r].push(playerNames[i]);
                    }
                }
            }
            schedule.push(row);
        }
    }

    const totals = {};
    for (const name of playerNames) {
        totals[name] = { G: 0, Sub: 0 };
        for (const r of outfieldRoles) totals[name][r] = 0;
    }

    for (const row of schedule) {
        for (const r of roles) {
            for (const name of row[r]) {
                totals[name][r] += 1;
            }
        }
    }

    return { schedule, totals };
}

// ================================================================================
// RENDERING & DISPLAY
// ================================================================================

/**
 * Render the schedule and totals tables in the UI
 * @param {Array} schedule - Schedule data
 * @param {Object} totals - Totals by player
 * @param {Object} params - Problem parameters
 */
function render(schedule, totals, params) {
    // Schedule table
    const roles = Object.keys(schedule[0]).filter(k => !["match", "period"].includes(k));

    let html = `<table>
        <thead>
            <tr>
                <th>✓</th>
                <th>Match</th>
                <th>Period</th>
                ${roles.map(r => `<th>${escapeHtml(r)}</th>`).join("")}
            </tr>
        </thead>
        <tbody>`;

    for (let idx = 0; idx < schedule.length; idx++) {
        const row = schedule[idx];
        const prevRow = idx > 0 ? schedule[idx - 1] : null;

        html += `<tr data-row-idx="${idx}">
            <td><input type="checkbox" class="period-checkbox" data-row-idx="${idx}"></td>
            <td>${row.match}</td>
            <td>${row.period}</td>
            ${roles.map(r => {
            // For each player in this role, check if they were Sub in previous period
            const playerNames = row[r].map(name => {
                // Check if player was Sub in previous period (just subbed in)
                const wasSubLastPeriod = prevRow && prevRow.Sub && prevRow.Sub.includes(name);
                if (wasSubLastPeriod) {
                    return `<strong>${escapeHtml(name)}</strong>`;
                }
                return escapeHtml(name);
            });
            return `<td>${playerNames.join(", ")}</td>`;
        }).join("")}
        </tr>`;
    }
    html += `</tbody>
    </table>`;
    SCHEDULE_EL.innerHTML = html;

    // Add event listeners to checkboxes
    document.querySelectorAll('.period-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const rowIdx = e.target.dataset.rowIdx;
            const row = document.querySelector(`tr[data-row-idx="${rowIdx}"]`);
            if (e.target.checked) {
                row.classList.add('period-played');
            } else {
                row.classList.remove('period-played');
            }
        });
    });

    // Show the note about bold names
    SCHEDULE_NOTE_EL.style.display = "block";

    // Show the timer block
    TIMER_BLOCK.style.display = "block";

    // Totals table
    const totRoles = Object.keys(Object.values(totals)[0]);
    let th = `<th>Player</th>${totRoles.map(r => `<th>${escapeHtml(r)}</th>`).join("")}<th>On pitch</th>`;
    let tb = "";
    for (const [name, t] of Object.entries(totals)) {
        const onPitch = totRoles.filter(r => r !== "Sub").reduce((a, r) => a + t[r], 0);
        tb += `<tr>
            <td>${escapeHtml(name)}</td>
            ${totRoles.map(r => `<td>${t[r]}</td>`).join("")}
            <td>${onPitch}</td>
        </tr>`;
    }
    TOTALS_EL.innerHTML = `<table>
        <thead>
            <tr>${th}</tr>
        </thead>
        <tbody>${tb}</tbody>
    </table>`;

    // Auto-expand totals section when solution is ready
    TOTALS_CONTENT.classList.remove("hidden");
    TOTALS_TOGGLE.textContent = "−";
}

// ================================================================================
// MAIN SOLVE HANDLER
// ================================================================================

SOLVE_BTN.onclick = async () => {
    try {
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/3019f3c6-66c4-4b96-99cc-c258125898e3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'subs.js:SOLVE_START', message: 'Solve button clicked', data: { timestamp: new Date().toISOString() }, timestamp: Date.now(), sessionId: 'debug-session', hypothesisId: 'H1' }) }).catch(() => { });
        // #endregion

        clearError();
        showProgress("Preparing…");
        SCHEDULE_EL.innerHTML = "";
        SCHEDULE_NOTE_EL.style.display = "none";
        TOTALS_EL.innerHTML = "";

        // Collapse totals section while solving
        TOTALS_CONTENT.classList.add("hidden");
        TOTALS_TOGGLE.textContent = "+";

        // Collect and validate parameters
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/3019f3c6-66c4-4b96-99cc-c258125898e3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'subs.js:BEFORE_GETPARAMS', message: 'About to get params', data: {}, timestamp: Date.now(), sessionId: 'debug-session', hypothesisId: 'H1' }) }).catch(() => { });
        // #endregion
        const params = getParams();

        // Create seeded random number generator from the seed input
        const seedStr = SEED_INPUT.value.trim() || getCurrentWeek();
        const seedNum = hashString(seedStr);
        const rng = seededRandom(seedNum);

        // Sort player names alphabetically first to ensure same seed always produces same schedule
        // regardless of the order players were entered in the textarea
        params.playerNames.sort();

        // Randomize player order using seeded RNG to get reproducible variety
        // The solver is deterministic, so shuffling gives us variety
        params.playerNames = shuffleArray(params.playerNames, rng);

        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/3019f3c6-66c4-4b96-99cc-c258125898e3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'subs.js:AFTER_GETPARAMS', message: 'Params collected and shuffled', data: { numPlayers: params.playerNames.length, numMatches: params.numMatches, periodsPerMatch: params.periodsPerMatch, shuffledNames: params.playerNames, seed: seedStr, seedNum }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'randomized', hypothesisId: 'H11' }) }).catch(() => { });
        // #endregion

        // Initialize GLPK
        showProgress("Loading solver library…");
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/3019f3c6-66c4-4b96-99cc-c258125898e3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'subs.js:BEFORE_GLPK_INIT', message: 'Initializing GLPK', data: {}, timestamp: Date.now(), sessionId: 'debug-session', hypothesisId: 'H5' }) }).catch(() => { });
        // #endregion
        const glpk = await GLPK();
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/3019f3c6-66c4-4b96-99cc-c258125898e3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'subs.js:AFTER_GLPK_INIT', message: 'GLPK initialized', data: { glpkExists: !!glpk }, timestamp: Date.now(), sessionId: 'debug-session', hypothesisId: 'H5' }) }).catch(() => { });
        // #endregion

        // Build MILP model
        showProgress("Building optimization model…");
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/3019f3c6-66c4-4b96-99cc-c258125898e3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'subs.js:BEFORE_BUILD', message: 'Building problem', data: {}, timestamp: Date.now(), sessionId: 'debug-session', hypothesisId: 'H1' }) }).catch(() => { });
        // #endregion
        const { lp, meta } = buildProblem(glpk, params, rng);
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/3019f3c6-66c4-4b96-99cc-c258125898e3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'subs.js:AFTER_BUILD', message: 'Problem built', data: { numConstraints: lp.subjectTo.length, numBinaries: lp.binaries.length, fairnessBounds: meta.fairnessBounds }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'relaxed-bounds', hypothesisId: 'H10' }) }).catch(() => { });
        // #endregion

        // Solve with standard options (simple and reliable)
        const options = {
            msglev: glpk.GLP_MSG_OFF, // Suppress solver messages
            presol: true, // Enable presolver to simplify problem
        };

        showProgress("Finding valid schedule… (typically 5-30 seconds)");
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/3019f3c6-66c4-4b96-99cc-c258125898e3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'subs.js:BEFORE_SOLVE', message: 'Starting solver', data: { options, numConstraints: lp.subjectTo.length, numBinaries: lp.binaries.length }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'relaxed-bounds', hypothesisId: 'H10' }) }).catch(() => { });
        // #endregion

        const sol = await glpk.solve(lp, options);
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/3019f3c6-66c4-4b96-99cc-c258125898e3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'subs.js:AFTER_SOLVE', message: 'Solver completed', data: { hasSolution: !!sol, status: sol?.result?.status || sol?.status }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'relaxed-bounds', hypothesisId: 'H10' }) }).catch(() => { });
        // #endregion

        // Check solution status
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/3019f3c6-66c4-4b96-99cc-c258125898e3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'subs.js:CHECK_STATUS', message: 'Checking solution status', data: { hasSol: !!sol, resultStatus: sol?.result?.status, solStatus: sol?.status, GLP_NOFEAS: glpk.GLP_NOFEAS, GLP_OPT: glpk.GLP_OPT, GLP_FEAS: glpk.GLP_FEAS }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'relaxed-bounds', hypothesisId: 'H10' }) }).catch(() => { });
        // #endregion

        const status = sol?.result?.status || sol?.status;

        // Accept optimal (GLP_OPT=5) or feasible (GLP_FEAS=2) solutions
        if (!sol || status === glpk.GLP_NOFEAS || status === glpk.GLP_UNDEF) {
            // #region agent log
            fetch('http://127.0.0.1:7244/ingest/3019f3c6-66c4-4b96-99cc-c258125898e3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'subs.js:NO_FEASIBLE', message: 'No feasible solution', data: { status }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'relaxed-bounds', hypothesisId: 'H10' }) }).catch(() => { });
            // #endregion
            throw new Error(
                "No feasible schedule found. Try:\n" +
                "• Adding more matches\n" +
                "• Disabling 'no consecutive subs' constraint\n" +
                "• Adjusting team composition (add more players or remove positions)"
            );
        }

        // Log if we got a non-optimal but feasible solution
        if (status !== glpk.GLP_OPT) {
            // #region agent log
            fetch('http://127.0.0.1:7244/ingest/3019f3c6-66c4-4b96-99cc-c258125898e3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'subs.js:NON_OPTIMAL', message: 'Non-optimal solution', data: { status }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'relaxed-bounds', hypothesisId: 'H10' }) }).catch(() => { });
            // #endregion
            console.log('Note: Solution is feasible but may not be perfectly optimal (status:', status, ')');
        }

        // Decode and render solution
        showProgress("Decoding solution…");
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/3019f3c6-66c4-4b96-99cc-c258125898e3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'subs.js:BEFORE_DECODE', message: 'Decoding solution', data: {}, timestamp: Date.now(), sessionId: 'debug-session', runId: 'relaxed-bounds', hypothesisId: 'H10' }) }).catch(() => { });
        // #endregion
        const { schedule, totals } = decodeSolution(params, sol, meta);
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/3019f3c6-66c4-4b96-99cc-c258125898e3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'subs.js:AFTER_DECODE', message: 'Solution decoded', data: { scheduleRows: schedule.length, numPlayers: Object.keys(totals).length }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'relaxed-bounds', hypothesisId: 'H10' }) }).catch(() => { });
        // #endregion

        showProgress("Rendering results…");
        render(schedule, totals, params);
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/3019f3c6-66c4-4b96-99cc-c258125898e3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'subs.js:AFTER_RENDER', message: 'Results rendered', data: {}, timestamp: Date.now(), sessionId: 'debug-session', runId: 'relaxed-bounds', hypothesisId: 'H10' }) }).catch(() => { });
        // #endregion

        STATUS_EL.innerHTML = '<div class="alert alert-success">✅ Valid schedule found! (Click Solve again for a different fair solution)</div>';

        // Log debug info to console
        console.log('Solution Info:', {
            squad: meta.N,
            teamSize: meta.teamSize,
            subs: meta.subsCount,
            stayersPerMatch: meta.stayersPerMatch,
            fairnessBounds: meta.fairnessBounds,
            status: sol.result?.status ?? sol.status,
            note: "Each player gets min-max assignments per role as shown above"
        });
    } catch (e) {
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/3019f3c6-66c4-4b96-99cc-c258125898e3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'subs.js:CATCH_ERROR', message: 'Error caught', data: { errorMessage: e?.message || String(e), errorStack: e?.stack || 'no stack' }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'relaxed-bounds', hypothesisId: 'H10' }) }).catch(() => { });
        // #endregion
        showError(e?.message || String(e));
        console.error('Solver error:', e?.stack || e?.message || e);
    }
};

// ================================================================================
// TIMER FUNCTIONALITY
// ================================================================================

let timerInterval = null;
let remainingSeconds = 0;
let isTimerRunning = false;

/**
 * Format seconds as MM:SS
 */
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Update the timer display
 */
function updateTimerDisplay() {
    TIMER_DISPLAY.textContent = formatTime(remainingSeconds);

    // Change color when time is running out
    if (remainingSeconds <= 10 && remainingSeconds > 0) {
        TIMER_DISPLAY.style.color = '#f44336';
    } else if (remainingSeconds === 0) {
        TIMER_DISPLAY.style.color = '#ff5722';
    } else {
        TIMER_DISPLAY.style.color = '#1976d2';
    }
}

/**
 * Start the timer
 */
function startTimer() {
    const duration = parseInt(TIMER_DURATION.value);
    remainingSeconds = duration * 60;
    isTimerRunning = true;

    TIMER_BTN.innerHTML = '<span class="material-icons" style="font-size: 18px; vertical-align: middle; margin-right: 4px;">pause</span>Pause';
    TIMER_DURATION.disabled = true;

    updateTimerDisplay();

    timerInterval = setInterval(() => {
        remainingSeconds--;
        updateTimerDisplay();

        if (remainingSeconds <= 0) {
            stopTimer();
            // Play a beep sound
            const context = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = context.createOscillator();
            const gainNode = context.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(context.destination);

            oscillator.frequency.value = 800;
            oscillator.type = 'sine';

            gainNode.gain.setValueAtTime(0.3, context.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.5);

            oscillator.start(context.currentTime);
            oscillator.stop(context.currentTime + 0.5);

            alert('Period time is up!');
        }
    }, 1000);
}

/**
 * Pause the timer
 */
function pauseTimer() {
    isTimerRunning = false;
    clearInterval(timerInterval);
    TIMER_BTN.innerHTML = '<span class="material-icons" style="font-size: 18px; vertical-align: middle; margin-right: 4px;">play_arrow</span>Resume';
}

/**
 * Stop and reset the timer
 */
function stopTimer() {
    isTimerRunning = false;
    clearInterval(timerInterval);
    const duration = parseInt(TIMER_DURATION.value);
    remainingSeconds = duration * 60;
    updateTimerDisplay();
    TIMER_BTN.innerHTML = '<span class="material-icons" style="font-size: 18px; vertical-align: middle; margin-right: 4px;">play_arrow</span>Start Timer';
    TIMER_DURATION.disabled = false;
}

// Timer button click handler
TIMER_BTN.addEventListener('click', () => {
    if (!isTimerRunning && remainingSeconds === parseInt(TIMER_DURATION.value) * 60) {
        // Start new timer
        startTimer();
    } else if (isTimerRunning) {
        // Pause timer
        pauseTimer();
    } else {
        // Resume timer
        isTimerRunning = true;
        TIMER_BTN.innerHTML = '<span class="material-icons" style="font-size: 18px; vertical-align: middle; margin-right: 4px;">pause</span>Pause';
        timerInterval = setInterval(() => {
            remainingSeconds--;
            updateTimerDisplay();

            if (remainingSeconds <= 0) {
                stopTimer();
                // Play a beep sound
                const context = new (window.AudioContext || window.webkitAudioContext)();
                const oscillator = context.createOscillator();
                const gainNode = context.createGain();

                oscillator.connect(gainNode);
                gainNode.connect(context.destination);

                oscillator.frequency.value = 800;
                oscillator.type = 'sine';

                gainNode.gain.setValueAtTime(0.3, context.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.5);

                oscillator.start(context.currentTime);
                oscillator.stop(context.currentTime + 0.5);

                alert('Period time is up!');
            }
        }, 1000);
    }
});

// Timer duration change handler
TIMER_DURATION.addEventListener('input', () => {
    if (!isTimerRunning) {
        const duration = parseInt(TIMER_DURATION.value) || 5;
        remainingSeconds = duration * 60;
        updateTimerDisplay();
    }
});
