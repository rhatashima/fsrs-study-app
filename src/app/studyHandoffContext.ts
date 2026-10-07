import { createContext, useContext } from 'react'
import { StudyBasicsHandoff } from '../services/studyBasicsHandoff'

/** ホーム画面 → 学習開始の基本データの受け渡し（利用者ごと。AuthGate が用意する） */
export const StudyHandoffContext = createContext<StudyBasicsHandoff | null>(null)

export function useStudyHandoff(): StudyBasicsHandoff {
  const handoff = useContext(StudyHandoffContext)
  if (!handoff) throw new Error('StudyHandoffContext.Provider が設定されていません')
  return handoff
}

export { StudyBasicsHandoff }
