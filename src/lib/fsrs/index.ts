/*
 * FSRS の公開 API。src/lib/fsrs/ の外からはここだけを import する。
 * ここから出す型・関数の入出力はドメイン型だけ（ts-fsrs の型は出さない）。
 */
export {
  createFsrsScheduler,
  FSRS_LIBRARY,
  FSRS_LIBRARY_VERSION,
  type FsrsScheduler,
  type RatingPreview,
} from './scheduler'
