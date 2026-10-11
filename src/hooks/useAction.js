import { useCallback } from 'react'
import { messageOf } from '../api/client'
import { useToast } from '../components/Toast'

/**
 * Wraps a user action that talks to the server: any failure becomes an error toast instead of an
 * unhandled rejection. Resolves to the action's result, or undefined when it failed.
 *
 *   const run = useAction()
 *   run(async () => { await data.addPayment(...); toast.success('Đã lưu') })
 */
export function useAction() {
  const toast = useToast()
  return useCallback(
    async (action) => {
      try {
        return await action()
      } catch (error) {
        toast.error(messageOf(error))
        return undefined
      }
    },
    [toast],
  )
}
