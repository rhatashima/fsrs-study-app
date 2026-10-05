import { createContext, useContext } from 'react'

/** 現在時刻を返す関数。テストでは固定・操作できる時計に差し替える。 */
export type Clock = () => Date

export const ClockContext = createContext<Clock>(() => new Date())

export function useClock(): Clock {
  return useContext(ClockContext)
}
