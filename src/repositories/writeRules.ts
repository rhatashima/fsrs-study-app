import {
  AppError,
  isValidCardId,
  matchesPreviousState,
  sameReviewLog,
  snapshotsEqual,
  type Card,
  type ReviewLog,
  type ReviewState,
} from '../domain'
import type { ReviewRecord } from './types'

/*
 * 保存時の整合性ルール（カードの検査、レビュー保存・状態復元の判定）。メモリ実装と Firestore 実装で共通に使う
 * （Firestore ではトランザクションの中で、読み取った値に対してこの判定を行う）。
 */

/** 保存できるカードか（id の文字・並び順） */
export function assertValidCard(card: Card): void {
  if (!isValidCardId(card.id)) {
    throw new AppError(
      'invalid-data',
      `カード id「${card.id}」は使えません。半角英数字・ハイフン・アンダースコア（100 文字以内）で指定してください。`,
    )
  }
  if (!Number.isInteger(card.order) || card.order < 1) {
    throw new AppError('invalid-data', `カード「${card.id}」の並び順（order）が不正です。`)
  }
}

/** 保存するレビュー結果そのものが整合しているか（保存済みデータを見ない検査） */
export function assertConsistentRecord({ state, log }: ReviewRecord): void {
  if (state.cardId !== log.cardId || state.materialId !== log.materialId) {
    throw new AppError('invalid-data', 'レビュー結果のカードが一致しません。')
  }
  if (state.lastLogId !== log.id) {
    throw new AppError('invalid-data', 'レビュー結果の履歴 id が一致しません。')
  }
  if (!snapshotsEqual(state, log.nextState)) {
    throw new AppError('invalid-data', 'レビュー結果の状態が履歴と一致しません。')
  }
}

/**
 * 保存済みのデータと照らして、このレビューを書き込むか決める。
 * - 'duplicate'：同じレビューがすでに保存されている（再試行・二重送信）→ 何もしない
 * - 'write'：書き込む
 */
export function decideReviewWrite(
  record: ReviewRecord,
  existingLog: ReviewLog | null,
  storedState: ReviewState | null,
): 'write' | 'duplicate' {
  if (existingLog) {
    if (sameReviewLog(existingLog, record.log)) return 'duplicate'
    throw new AppError('conflict', 'このレビューの記録が別の内容ですでに保存されています。画面を再読み込みしてください。')
  }
  if (!matchesPreviousState(storedState, record.log)) {
    throw new AppError(
      'conflict',
      'このカードは別の端末などで先に学習されています。画面を再読み込みしてから続けてください。',
    )
  }
  return 'write'
}

/** 復元する ReviewState が、参照している ReviewLog の nextState と一致するか */
export function assertRestorableState(state: ReviewState, log: ReviewLog | null): void {
  if (!log || log.cardId !== state.cardId || log.materialId !== state.materialId) {
    throw new AppError('invalid-data', '復元の元になる学習履歴が見つかりません。')
  }
  if (!snapshotsEqual(state, log.nextState)) {
    throw new AppError('invalid-data', '復元する学習状態が学習履歴と一致しません。')
  }
}
