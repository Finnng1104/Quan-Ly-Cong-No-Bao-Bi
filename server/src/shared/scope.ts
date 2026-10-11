// Until real multi-branch support exists, everything lives in one default branch. Every table
// already carries `branch_id` and every query filters on it, so adding branches later is a data
// and permission change, not a schema change.
export const DEFAULT_BRANCH_ID = 'main'
