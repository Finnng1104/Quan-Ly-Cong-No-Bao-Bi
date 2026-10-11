import { useCallback, useMemo } from 'react'
import { api } from '../api/httpApi'
import { useStore } from '../store/useStore'
import { useAsync } from './useAsync'

const NO_ITEMS = []

/**
 * Price list of one customer, loaded when a customer is chosen so that picking a product can fill
 * the price instantly. Returns `getPrice(productId, unitId)` -> price | null.
 */
export function useCustomerPrices(customerId) {
  const dataVersion = useStore((s) => s.dataVersion)
  const { data } = useAsync(
    async () => (customerId ? { customerId, items: await api.customers.prices(customerId) } : null),
    [customerId, dataVersion],
  )

  // Ignore a list that belongs to the previously chosen customer.
  const items = useMemo(
    () => (data && data.customerId === customerId ? data.items : NO_ITEMS),
    [data, customerId],
  )

  const getPrice = useCallback(
    (productId, unitId) => {
      const found = items.find((entry) => entry.productId === productId && entry.unitId === unitId)
      return found ? found.price : null
    },
    [items],
  )
  return { prices: items, getPrice }
}

/**
 * What a customer has bought and returned per product + unit: used to warn (not block) when a
 * return is larger than what was bought. Keyed by `${productId}|${unitId}`.
 */
export function usePurchasedReturned(customerId) {
  const dataVersion = useStore((s) => s.dataVersion)
  const { data } = useAsync(
    async () => (customerId ? { customerId, items: await api.customers.purchasedReturned(customerId) } : null),
    [customerId, dataVersion],
  )

  return useMemo(() => {
    const map = new Map()
    if (data && data.customerId === customerId) {
      for (const item of data.items) {
        map.set(`${item.productId}|${item.unitId}`, { bought: item.bought, returned: item.returned })
      }
    }
    return map
  }, [data, customerId])
}
