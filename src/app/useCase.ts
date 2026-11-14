import { useCallback, useState } from "react";
import type {
  HeardHistory,
  SaveSlot,
  SceneId,
  NoteSegment,
  Cue,
} from "../shared/types";
import {
  CASE_CONTENT,
  createInvestigation,
  enterScene,
  applyChoice,
  resolveEpisode,
} from "../features/story";
import { useTransport, recordPosition } from "../features/listening";
import {
  createEvidence,
  addNote,
  addSegment,
  collectClue,
  editNote,
  editSegment,
  moveSegment,
  removeSegment,
  mergeSegments,
  deleteNote,
  togglePinned,
  isSegmentAvailable,
} from "../features/evidence";
import type { MergePreview } from "../features/evidence";
import {
  readSlots,
  createSnapshot,
  createSlot,
  writeSlot,
  deleteSlot,
  parseImported,
  exportSlot,
  validateSnapshot,
} from "../features/profiles";
const DEFAULT_OBSERVATION = "在这里写下你的观察…";
export function useCase() {
  const [boot] = useState(() => readSlots(CASE_CONTENT));
  const [story, setStory] = useState(createInvestigation),
    [evidence, setEvidence] = useState(createEvidence),
    [heard, setHeard] = useState<HeardHistory>({}),
    [slots, setSlots] = useState<SaveSlot[]>(boot.slots),
    [activeId, setActiveId] = useState<string | null>(null),
    [notice, setNotice] = useState(
      boot.warning || "戴上耳机，从第一通来电开始调查。",
    ),
    [dirty, setDirty] = useState(false);
  const episode = resolveEpisode(CASE_CONTENT, story.sceneId, evidence.clues);
  const onHeard = useCallback((id: string, position: number) => {
    setHeard((h) => recordPosition(h, id, position));
  }, []);
  const audio = useTransport(episode, onHeard);
  const run = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "操作未完成，请重试");
    }
  };
  const go = (id: SceneId, position = 0) => {
    audio.pause();
    if (id === story.sceneId) {
      audio.seek(position);
    } else {
      audio.queueSeek(position);
    }
    if (id !== story.sceneId) setStory((s) => enterScene(CASE_CONTENT, s, id));
    setDirty(true);
  };
  const choose = (id: string) =>
    run(() => {
      const next = applyChoice(CASE_CONTENT, story, id, evidence.clues);
      audio.pause();
      audio.queueSeek(0);
      setStory(next);
      setDirty(true);
      setNotice(
        next.ending
          ? "你已还原案件。仍可回听录音、整理证据。"
          : "调查方向已更新，点击播放继续收听。",
      );
    });
  /** 捕捉当前播放位置，连同当前音源版本一起带回。 */
  const captureCurrent = () => {
    const bookmark = audio.captureRange(story.sceneId, 5);
    if (!bookmark) return null;
    return {
      sourceId: episode.id,
      sceneId: bookmark.sceneId,
      version: episode.version,
      start: bookmark.start,
      end: bookmark.end,
    };
  };
  const note = () => {
    const range = captureCurrent();
    if (!range) {
      setNotice("请等待录音载入后再标记");
      return;
    }
    setEvidence((s) =>
      addNote(s, { ...range, text: DEFAULT_OBSERVATION }, "声音标记"),
    );
    setDirty(true);
    setNotice("已记录最近五秒，可在笔记中编辑或回听。");
  };
  /** 把当前正在听的片段追加进指定手记，作为新的一段来源。 */
  const appendSegment = (noteId: string) =>
    run(() => {
      const range = captureCurrent();
      if (!range) throw new Error("请等待录音载入后再标记");
      setEvidence((s) =>
        addSegment(s, noteId, { ...range, text: DEFAULT_OBSERVATION }),
      );
      setDirty(true);
      setNotice("已把当前声音作为新的一段加入这篇手记。");
    });
  const collect = (cue: Cue) => {
    const sound = cue.sound;
    if (!sound) return;
    const result = collectClue(evidence, episode, cue, heard);
    if (!result) {
      setNotice("请先听完这段声音，或检查是否已收集。");
      return;
    }
    audio.pause();
    setEvidence(result);
    setDirty(true);
    setNotice("声音线索已归档，对话可能因此发生变化。");
  };
  const jump = (segment: NoteSegment) => {
    if (!isSegmentAvailable(CASE_CONTENT, segment)) {
      setNotice("这段音源已失效，无法回听；其余片段与手记内容仍保留。");
      return;
    }
    go(segment.sceneId, segment.start);
    setNotice("已定位到对应声音，点击播放回听。");
  };
  const save = (name: string) =>
    run(() => {
      const snapshot = createSnapshot(CASE_CONTENT, story, evidence, heard, {
        sceneId: story.sceneId,
        position: audio.view.position,
        rate: audio.view.rate,
      });
      const old = slots.find((s) => s.id === activeId);
      const slot =
        old && name === old.name
          ? { ...old, updatedAt: Date.now(), snapshot }
          : createSlot(name, snapshot);
      const next = writeSlot(slots, slot);
      setSlots(next);
      setActiveId(slot.id);
      setDirty(false);
      setNotice(`调查进度「${slot.name}」已保存。`);
    });
  const load = (id: string) =>
    run(() => {
      const slot = slots.find((s) => s.id === id);
      if (!slot) throw new Error("存档不存在");
      const snap = validateSnapshot(slot.snapshot, CASE_CONTENT);
      audio.pause();
      const nextEpisode = resolveEpisode(
        CASE_CONTENT,
        snap.story.sceneId,
        snap.evidence.clues,
      );
      if (nextEpisode.id !== episode.id) {
        audio.queueSeek(snap.resume.position);
        audio.queueRate(snap.resume.rate);
      }
      setStory(snap.story);
      setEvidence(snap.evidence);
      setHeard(snap.heard);
      setActiveId(id);
      setDirty(false);
      setNotice(`已载入「${slot.name}」，点击播放继续调查。`);
      if (nextEpisode.id === episode.id) {
        audio.seek(snap.resume.position);
      }
      if (nextEpisode.id === episode.id) audio.setRate(snap.resume.rate);
    });
  const importText = (text: string) =>
    run(() => {
      const slot = parseImported(text, CASE_CONTENT);
      setSlots(writeSlot(slots, slot));
      setNotice("导入成功，已另存为独立调查进度。");
    });
  const download = (id: string) =>
    run(() => {
      const s = slots.find((s) => s.id === id);
      if (!s) throw new Error("存档不存在");
      const blob = new Blob([exportSlot(s)], { type: "application/json" }),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = `雾港来电-${s.name}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  return {
    story,
    evidence,
    heard,
    slots,
    activeId,
    notice,
    dirty,
    episode,
    audio,
    go,
    choose,
    note,
    appendSegment,
    collect,
    jump,
    save,
    load,
    importText,
    download,
    editConclusion: (id: string, text: string) => {
      run(() => {
        setEvidence((s) => editNote(s, id, text));
        setDirty(true);
      });
    },
    editSegmentText: (noteId: string, segmentId: string, text: string) => {
      run(() => {
        setEvidence((s) => editSegment(s, noteId, segmentId, text));
        setDirty(true);
      });
    },
    orderSegment: (noteId: string, segmentId: string, direction: -1 | 1) => {
      setEvidence((s) => moveSegment(s, noteId, segmentId, direction));
      setDirty(true);
    },
    removeSegment: (noteId: string, segmentId: string) => {
      run(() => {
        setEvidence((s) => removeSegment(s, noteId, segmentId));
        setDirty(true);
        setNotice("已移除该片段，已收集的正式证据不会被撤销。");
      });
    },
    merge: (noteId: string, preview: MergePreview) => {
      run(() => {
        setEvidence((s) => mergeSegments(s, noteId, preview));
        setDirty(true);
        setNotice("同源重叠范围已合并为一段。");
      });
    },
    remove: (id: string) => {
      setEvidence((s) => deleteNote(s, id));
      setDirty(true);
    },
    pin: (id: string) => {
      setEvidence((s) => togglePinned(s, id));
      setDirty(true);
    },
    removeSlot: (id: string) =>
      run(() => {
        setSlots(deleteSlot(slots, id));
        if (activeId === id) setActiveId(null);
      }),
    reset: () => {
      audio.pause();
      if (story.sceneId !== "arrival") audio.queueSeek(0);
      setStory(createInvestigation());
      setEvidence(createEvidence());
      setHeard({});
      setActiveId(null);
      setDirty(false);
      if (story.sceneId === "arrival") audio.seek(0);
      setNotice("已开始一条独立调查路线，已有存档保持不变。");
    },
  };
}
