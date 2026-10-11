import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Runs an async loader whenever `deps` change and exposes { data, loading, error, reload }.
 * While a newer load is running the previous data stays available, so lists do not flash empty.
 * Results of an outdated load are ignored.
 */
export function useAsync(load, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: null })
  const [reloadTick, setReloadTick] = useState(0)
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    Promise.resolve()
      .then(() => loadRef.current())
      .then(
        (data) => {
          if (!cancelled) setState({ data, loading: false, error: null })
        },
        (error) => {
          if (!cancelled) setState((s) => ({ data: s.data, loading: false, error }))
        },
      )
    return () => {
      cancelled = true
    }
    // The caller decides what should trigger a reload through `deps`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadTick])

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), [])
  return { ...state, reload }
}
