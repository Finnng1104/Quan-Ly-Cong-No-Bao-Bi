import { AppError } from './errors.js'

/** Every operation the API exposes, grouped by area. Routes ask `can()` instead of testing roles. */
export type Action =
  | 'settings:read'
  | 'settings:write'
  | 'customers:read'
  | 'customers:write'
  | 'catalog:read'
  | 'catalog:write'
  | 'prices:read'
  | 'prices:write'
  | 'orders:read'
  | 'orders:write'
  | 'returns:read'
  | 'returns:write'
  | 'payments:read'
  | 'payments:write'
  | 'adjustments:read'
  | 'adjustments:write'
  | 'reports:read'
  | 'statements:write'
  | 'backup:read'
  | 'backup:write'
  | 'backup:restore'

export interface AuthenticatedUser {
  id: string
  username: string
  role: string
  /** Branch this user is limited to; null means "the default branch" for now. */
  branchId: string | null
}

// The single place that knows what a role may do. Today only the shop owner exists; adding
// staff later means adding a role here, not touching any route.
const ROLE_PERMISSIONS: Record<string, readonly Action[] | 'all'> = {
  owner: 'all',
}

export function can(user: AuthenticatedUser, action: Action): boolean {
  const permissions = ROLE_PERMISSIONS[user.role]
  if (!permissions) return false
  return permissions === 'all' || permissions.includes(action)
}

export function assertCan(user: AuthenticatedUser, action: Action): void {
  if (!can(user, action)) throw new AppError('FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này')
}
