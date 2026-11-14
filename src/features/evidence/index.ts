export {
  createEvidence,
  addNote,
  addSegment,
  editNote,
  editSegment,
  moveSegment,
  removeSegment,
  mergeSegments,
  previewMerge,
  canMergeSegments,
  isSegmentAvailable,
  deleteNote,
  togglePinned,
  selectNote,
} from "./model/notes";
export type { SegmentInput, MergePreview } from "./model/notes";
export { canCollectSound } from "./model/eligibility";
export { collectClue } from "./model/clues";
export { EvidencePanel } from "./ui/EvidencePanel";
