/** Exit code: success (including dry-run). */
export const EXIT_SUCCESS = 0;

/** Exit code: business or guard error (e.g. spin detected, loop limit). */
export const EXIT_BUSINESS = 1;

/** Exit code: config or environment error (e.g. missing API key, invalid config file). */
export const EXIT_CONFIG = 2;
