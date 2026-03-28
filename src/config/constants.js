// Application constants
const AUTH_STATE_PATH = 'state.json';
const TARGET_URL = 'https://www.screener.in/announcements/user-filters/174962/';
const OUTPUT_PATH = 'results.json';
const DAYS_TO_FETCH = 7;

const EVENT_KEYWORDS = [
    'earnings call', 'quarterly call', 'results call', 'financial results call',
    'investor call', 'earnings conference call', 'quarterly earnings call',
    'results conference call', 'financial call'
];

module.exports = {
    AUTH_STATE_PATH,
    TARGET_URL,
    OUTPUT_PATH,
    DAYS_TO_FETCH,
    EVENT_KEYWORDS
};