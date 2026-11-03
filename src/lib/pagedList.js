/**
 * Appends the next page to the rows already loaded, skipping rows whose id is already present.
 * Rows can shift between two page requests (someone adds a customer, a debt changes the sort order),
 * so offset paging may return the same row twice; keeping both would break React keys and look doubled.
 */
export function appendUniqueById(currentItems, nextItems) {
  const knownIds = new Set(currentItems.map((item) => item.id))
  const freshItems = nextItems.filter((item) => !knownIds.has(item.id))
  return freshItems.length === 0 ? currentItems : [...currentItems, ...freshItems]
}

/** True when two dependency arrays hold the same values (shallow, like React's own deps check). */
export function sameDeps(previousDeps, nextDeps) {
  return (
    previousDeps !== null &&
    previousDeps.length === nextDeps.length &&
    previousDeps.every((value, index) => Object.is(value, nextDeps[index]))
  )
}
