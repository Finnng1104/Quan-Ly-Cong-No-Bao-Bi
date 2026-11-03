import { useCallback, useEffect, useRef, useState } from 'react'
import { appendUniqueById, sameDeps } from '../lib/pagedList'

const INITIAL_STATE = { items: [], total: 0, summary: null, loading: true, loadingMore: false, error: null }

/**
 * A list that grows page by page (infinite scroll). `fetchPage({ offset, limit })` must resolve to
 * `{ items, total, summary }`.
 *
 * - `resetDeps` (search text, sort, date...) start the list over from the first page.
 * - `refreshDeps` (data changed elsewhere) reload what is already shown, so the list keeps its length
 *   and the person does not lose their scroll position.
 * - `loadMore` fetches only the next page and appends it.
 */
export function usePagedList(fetchPage, { pageSize, resetDeps, refreshDeps = [] }) {
  const [state, setState] = useState(INITIAL_STATE)
  const [reloadTick, setReloadTick] = useState(0)
  const fetchPageRef = useRef(fetchPage)
  fetchPageRef.current = fetchPage
  const stateRef = useRef(state)
  stateRef.current = state
  const lastResetDepsRef = useRef(null)
  // Bumped by every reload so a slow response for an outdated request is ignored.
  const requestIdRef = useRef(0)
  const loadingMoreRef = useRef(false)

  useEffect(() => {
    const isNewSearch = !sameDeps(lastResetDepsRef.current, resetDeps)
    lastResetDepsRef.current = resetDeps
    const rowsToLoad = isNewSearch ? pageSize : Math.max(stateRef.current.items.length, pageSize)

    const requestId = ++requestIdRef.current
    loadingMoreRef.current = false
    setState((s) => ({ ...s, loading: true, loadingMore: false, error: null }))
    fetchPageRef.current({ offset: 0, limit: rowsToLoad }).then(
      (page) => {
        if (requestId !== requestIdRef.current) return
        setState({ ...INITIAL_STATE, items: page.items, total: page.total, summary: page.summary, loading: false })
      },
      (error) => {
        if (requestId !== requestIdRef.current) return
        setState((s) => ({ ...s, loading: false, error }))
      },
    )
    // The caller decides what should trigger a reload through the deps arrays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...resetDeps, ...refreshDeps, reloadTick])

  const loadMore = useCallback(() => {
    const { items, total, loading } = stateRef.current
    if (loading || loadingMoreRef.current || items.length >= total) return

    const requestId = requestIdRef.current
    loadingMoreRef.current = true
    setState((s) => ({ ...s, loadingMore: true, error: null }))
    fetchPageRef.current({ offset: items.length, limit: pageSize }).then(
      (page) => {
        if (requestId !== requestIdRef.current) return
        loadingMoreRef.current = false
        setState((s) => ({
          ...s,
          items: appendUniqueById(s.items, page.items),
          total: page.total,
          summary: page.summary,
          loadingMore: false,
        }))
      },
      (error) => {
        if (requestId !== requestIdRef.current) return
        loadingMoreRef.current = false
        setState((s) => ({ ...s, loadingMore: false, error }))
      },
    )
  }, [pageSize])

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), [])
  const hasMore = state.items.length < state.total
  return { ...state, hasMore, loadMore, reload }
}
