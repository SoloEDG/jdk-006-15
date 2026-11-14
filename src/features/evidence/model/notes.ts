import type {
  CaseContent,
  Episode,
  EvidenceState,
  NoteSegment,
} from "../../../shared/types";
import { newId } from "../../../shared/time";

const SCENE_IDS = ["arrival", "harbor", "interview", "tower", "finale"];

export interface SegmentInput {
  sourceId: string;
  sceneId: Episode["sceneId"];
  version: string;
  start: number;
  end: number;
  text: string;
  clueId?: string | null;
}

export function normalizeRange(
  start: number,
  end: number,
): { start: number; end: number } {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start
  )
    throw new Error("笔记的播放范围无效");
  return { start, end };
}

function normalizeSegment(input: SegmentInput): NoteSegment {
  if (!SCENE_IDS.includes(input.sceneId))
    throw new Error("笔记的音源场景无效");
  if (typeof input.sourceId !== "string" || !input.sourceId)
    throw new Error("笔记缺少音源来源");
  const { start, end } = normalizeRange(input.start, input.end);
  return {
    id: newId(),
    sourceId: input.sourceId,
    sceneId: input.sceneId,
    version: String(input.version ?? ""),
    start,
    end,
    text: input.text.trim(),
    clueId: input.clueId ?? null,
  };
}

function deriveClueId(segments: NoteSegment[]): string | null {
  return segments.find((segment) => segment.clueId)?.clueId ?? null;
}

export function createEvidence(): EvidenceState {
  return { notes: [], clues: [], selectedId: null };
}

export function addNote(
  state: EvidenceState,
  segment: SegmentInput,
  title = "收听笔记",
): EvidenceState {
  const first = normalizeSegment(segment);
  if (!first.text) throw new Error("请填写笔记内容");
  const note = {
    id: newId(),
    clueId: first.clueId,
    title: title.trim() || "收听笔记",
    text: "",
    segments: [first],
    createdAt: Date.now(),
    pinned: false,
  };
  return { ...state, notes: [note, ...state.notes], selectedId: note.id };
}

/** 向既有手记追加一段来源，段内观察不能为空。 */
export function addSegment(
  state: EvidenceState,
  noteId: string,
  segment: SegmentInput,
): EvidenceState {
  const next = normalizeSegment(segment);
  if (!next.text) throw new Error("请填写这段来源的观察");
  return {
    ...state,
    notes: state.notes.map((note) => {
      if (note.id !== noteId) return note;
      const segments = [...note.segments, next];
      return { ...note, segments, clueId: deriveClueId(segments) };
    }),
  };
}

/** 编辑整篇末尾的结论；留空表示尚未写下结论，允许保存。 */
export function editNote(
  state: EvidenceState,
  id: string,
  conclusion: string,
): EvidenceState {
  return {
    ...state,
    notes: state.notes.map((note) =>
      note.id === id ? { ...note, text: conclusion.trim() } : note,
    ),
  };
}

/** 编辑单段观察，不允许清空。 */
export function editSegment(
  state: EvidenceState,
  noteId: string,
  segmentId: string,
  text: string,
): EvidenceState {
  const body = text.trim();
  if (!body) throw new Error("这段观察不能为空");
  return {
    ...state,
    notes: state.notes.map((note) =>
      note.id !== noteId
        ? note
        : {
            ...note,
            segments: note.segments.map((segment) =>
              segment.id === segmentId ? { ...segment, text: body } : segment,
            ),
          },
    ),
  };
}

/** 调整某一段的顺序，direction 为 -1 上移、1 下移。 */
export function moveSegment(
  state: EvidenceState,
  noteId: string,
  segmentId: string,
  direction: -1 | 1,
): EvidenceState {
  return {
    ...state,
    notes: state.notes.map((note) => {
      if (note.id !== noteId) return note;
      const index = note.segments.findIndex((item) => item.id === segmentId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= note.segments.length)
        return note;
      const segments = [...note.segments];
      [segments[index], segments[target]] = [segments[target], segments[index]];
      return { ...note, segments };
    }),
  };
}

/**
 * 删除组合里的片段。已收集的正式线索（evidence.clues）不受影响。
 * 最后一段删除后，手记保留为无音源的文字手记（segments 为空）。
 */
export function removeSegment(
  state: EvidenceState,
  noteId: string,
  segmentId: string,
): EvidenceState {
  return {
    ...state,
    notes: state.notes.map((note) => {
      if (note.id !== noteId) return note;
      const segments = note.segments.filter(
        (segment) => segment.id !== segmentId,
      );
      return { ...note, segments, clueId: deriveClueId(segments) };
    }),
  };
}

export function deleteNote(state: EvidenceState, id: string): EvidenceState {
  return {
    ...state,
    notes: state.notes.filter((note) => note.id !== id),
    selectedId: state.selectedId === id ? null : state.selectedId,
  };
}

export function togglePinned(state: EvidenceState, id: string): EvidenceState {
  return {
    ...state,
    notes: state.notes.map((note) =>
      note.id === id ? { ...note, pinned: !note.pinned } : note,
    ),
  };
}

export function selectNote(
  state: EvidenceState,
  id: string | null,
): EvidenceState {
  return {
    ...state,
    selectedId: id && state.notes.some((note) => note.id === id) ? id : null,
  };
}

/** 仅同一音源（同版本）且时间范围互相重叠或相接的片段才能合并。 */
export function canMergeSegments(a: NoteSegment, b: NoteSegment): boolean {
  return (
    a.sourceId === b.sourceId &&
    a.sceneId === b.sceneId &&
    Math.min(a.end, b.end) >= Math.max(a.start, b.start) - 1e-6
  );
}

export interface MergePreview {
  sourceId: string;
  sceneId: NoteSegment["sceneId"];
  version: string;
  start: number;
  end: number;
  text: string;
  clueId: string | null;
  mergedIds: string[];
  /** 合并前各段的范围，供确认界面展示变化。 */
  before: { id: string; start: number; end: number; text: string }[];
}

/** 生成合并预览（不修改状态），不可合并时返回 null。 */
export function previewMerge(
  segments: NoteSegment[],
  firstId: string,
  secondId: string,
): MergePreview | null {
  const first = segments.find((item) => item.id === firstId);
  const second = segments.find((item) => item.id === secondId);
  if (!first || !second || !canMergeSegments(first, second)) return null;
  const ordered = [...segments]
    .filter((item) => item.id === firstId || item.id === secondId)
    .sort((a, b) => a.start - b.start);
  return {
    sourceId: first.sourceId,
    sceneId: first.sceneId,
    version: first.version,
    start: Math.min(first.start, second.start),
    end: Math.max(first.end, second.end),
    text: ordered.map((item) => item.text).join("\n"),
    clueId: first.clueId ?? second.clueId,
    mergedIds: ordered.map((item) => item.id),
    before: ordered.map((item) => ({
      id: item.id,
      start: item.start,
      end: item.end,
      text: item.text,
    })),
  };
}

/** 按预览把两段合并为一段，其余段的相对顺序保持不变。 */
export function mergeSegments(
  state: EvidenceState,
  noteId: string,
  preview: MergePreview,
): EvidenceState {
  return {
    ...state,
    notes: state.notes.map((note) => {
      if (note.id !== noteId) return note;
      const index = note.segments.findIndex((item) =>
        preview.mergedIds.includes(item.id),
      );
      if (index < 0) return note;
      const merged: NoteSegment = {
        id: newId(),
        sourceId: preview.sourceId,
        sceneId: preview.sceneId,
        version: preview.version,
        start: preview.start,
        end: preview.end,
        text: preview.text,
        clueId: preview.clueId,
      };
      const segments = note.segments.filter(
        (item) => !preview.mergedIds.includes(item.id),
      );
      segments.splice(index, 0, merged);
      return { ...note, segments, clueId: deriveClueId(segments) };
    }),
  };
}

/** 音源在当前案件中是否仍可回听；失效只禁用回听，不删除任何内容。 */
export function isSegmentAvailable(
  content: CaseContent,
  segment: Pick<NoteSegment, "sourceId">,
): boolean {
  return content.episodes.some((episode) => episode.id === segment.sourceId);
}
