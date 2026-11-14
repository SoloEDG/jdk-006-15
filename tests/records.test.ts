import test from "node:test";
import assert from "node:assert/strict";
import {
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
  collectClue,
  canCollectSound,
} from "../src/features/evidence/index";
import {
  createSnapshot,
  validateSnapshot,
  createSlot,
  writeSlot,
  readSlots,
  deleteSlot,
  exportSlot,
  parseImported,
} from "../src/features/profiles/index";
import type { CaseContent, Investigation } from "../src/shared/types";
const content: CaseContent = {
  id: "test",
  title: "test",
  scenes: [
    {
      id: "arrival",
      title: "A",
      location: "x",
      chapter: "1",
      description: "",
      choices: [],
    },
  ],
  episodes: [
    {
      id: "arrival-main",
      sceneId: "arrival",
      title: "A",
      version: "main",
      description: "",
      audio: "a",
      duration: 20,
      wave: [],
      cues: [
        {
          id: "cue",
          start: 0,
          end: 12,
          speaker: "S",
          text: "hello",
          sound: { clueId: "bell", start: 5, end: 7, description: "bell" },
        },
      ],
    },
    {
      id: "arrival-take2",
      sceneId: "arrival",
      title: "A",
      version: "take2",
      description: "",
      audio: "b",
      duration: 20,
      wave: [],
      cues: [],
    },
  ],
  clues: [{ id: "bell", title: "Bell", kind: "sound", description: "" }],
};
const story: Investigation = {
  sceneId: "arrival",
  visited: ["arrival"],
  decisions: [],
  ending: null,
};
const seg = (
  sourceId: string,
  version: string,
  start: number,
  end: number,
  text = "memo",
) => ({
  sourceId,
  sceneId: "arrival" as const,
  version,
  start,
  end,
  text,
});
function snapshot() {
  return createSnapshot(
    content,
    story,
    addNote(createEvidence(), seg("arrival-main", "main", 5, 7), "note"),
    { "arrival-main": 7 },
    { sceneId: "arrival", position: 6, rate: 1 },
  );
}
test("notes normalize ranges, edit conclusion/segment, pin and delete without mutation", () => {
  const initial = createEvidence();
  const state = addNote(
    initial,
    { ...seg("arrival-main", "main", 5, 7), extra: "drop" } as any,
    " note ",
  );
  assert.equal(initial.notes.length, 0);
  const note = state.notes[0];
  assert.equal(note.title, "note");
  assert.deepEqual(
    { start: note.segments[0].start, end: note.segments[0].end },
    { start: 5, end: 7 },
  );
  const id = note.id,
    sid = note.segments[0].id;
  // 整篇结论可留空，段内观察不能为空
  assert.equal(editNote(state, id, " 结论 ").notes[0].text, "结论");
  assert.equal(
    editSegment(state, id, sid, "updated").notes[0].segments[0].text,
    "updated",
  );
  assert.throws(() => editSegment(state, id, sid, "  "));
  assert.equal(togglePinned(state, id).notes[0].pinned, true);
  assert.equal(deleteNote(state, id).selectedId, null);
  assert.throws(() =>
    addNote(initial, seg("arrival-main", "main", 9, NaN), "bad"),
  );
  assert.throws(() =>
    addNote(initial, seg("arrival-main", "main", 5, 7, " "), "bad"),
  );
});
test("a composite note holds multiple ordered segments and a conclusion", () => {
  const first = addNote(
    createEvidence(),
    seg("arrival-main", "main", 1, 3, "钟声"),
  );
  const id = first.notes[0].id;
  const withTwo = addSegment(
    first,
    id,
    seg("arrival-main", "main", 10, 12, "周姨的否认"),
  );
  assert.equal(withTwo.notes[0].segments.length, 2);
  const secondId = withTwo.notes[0].segments[1].id;
  const reordered = moveSegment(withTwo, id, secondId, -1);
  assert.equal(reordered.notes[0].segments[0].text, "周姨的否认");
  // 越界排序被忽略：段顺序保持不变
  const outOfRange = moveSegment(
    reordered,
    id,
    reordered.notes[0].segments[0].id,
    -1,
  );
  assert.deepEqual(
    outOfRange.notes[0].segments.map((item) => item.text),
    reordered.notes[0].segments.map((item) => item.text),
  );
  const concluded = editNote(withTwo, id, "三条证据互相印证");
  assert.equal(concluded.notes[0].text, "三条证据互相印证");
});
test("overlapping ranges of the same source merge with a confirmed preview; different versions never merge", () => {
  let s = addNote(
    createEvidence(),
    seg("arrival-main", "main", 2, 6, "钟声三次"),
  );
  const id = s.notes[0].id;
  s = addSegment(s, id, seg("arrival-main", "main", 5, 9, "尾音延长"));
  s = addSegment(s, id, seg("arrival-take2", "take2", 5, 9, "另一版本同时间"));
  const [a, b, otherVersion] = s.notes[0].segments;
  // 同版本重叠可合并，且先展示预览
  const preview = previewMerge(s.notes[0].segments, a.id, b.id);
  assert.ok(preview);
  assert.deepEqual(
    { start: preview!.start, end: preview!.end },
    { start: 2, end: 9 },
  );
  assert.match(preview!.text, /钟声三次/);
  assert.match(preview!.text, /尾音延长/);
  assert.equal(preview!.before.length, 2);
  const merged = mergeSegments(s, id, preview!);
  assert.equal(merged.notes[0].segments.length, 2);
  assert.deepEqual(
    {
      start: merged.notes[0].segments[0].start,
      end: merged.notes[0].segments[0].end,
    },
    { start: 2, end: 9 },
  );
  // 不同版本即使时间相同也不能合并
  assert.equal(canMergeSegments(a, otherVersion), false);
  assert.equal(
    previewMerge(s.notes[0].segments, b.id, otherVersion.id),
    null,
  );
  // 同版本但范围不重叠也不能合并
  const far = {
    id: "x",
    sourceId: "arrival-main",
    sceneId: "arrival" as const,
    version: "main",
    start: 15,
    end: 18,
    text: "无关片段",
    clueId: null,
  };
  assert.equal(canMergeSegments(a, far), false);
});
test("removing segments keeps collected clues; last removal leaves a text-only note", () => {
  let s = addNote(
    createEvidence(),
    { ...seg("arrival-main", "main", 5, 7, "bell"), clueId: "bell" },
    "声音线索",
  );
  s = { ...s, clues: ["bell"] };
  const id = s.notes[0].id,
    sid = s.notes[0].segments[0].id;
  const emptied = removeSegment(s, id, sid);
  assert.deepEqual(emptied.clues, ["bell"]);
  assert.deepEqual(emptied.notes[0].segments, []);
  assert.equal(emptied.notes[0].clueId, null);
  // 文字手记仍然可以保存并通过存档校验
  const snap = createSnapshot(
    content,
    story,
    editNote(emptied, id, "只剩结论的文字手记"),
    {},
    { sceneId: "arrival", position: 0, rate: 1 },
  );
  assert.equal(
    validateSnapshot(JSON.parse(JSON.stringify(snap)), content).evidence
      .notes[0].segments.length,
    0,
  );
});
test("clues unlock at actual sound end and archive with the episode source/version", () => {
  const episode = content.episodes[0],
    cue = episode.cues[0];
  assert.equal(canCollectSound({ "arrival-main": 6 }, episode, cue), false);
  assert.equal(canCollectSound({ "arrival-main": 7 }, episode, cue), true);
  assert.equal(
    collectClue(createEvidence(), episode, cue, { "arrival-main": 6 }),
    null,
  );
  const found = collectClue(createEvidence(), episode, cue, {
    "arrival-main": 7,
  })!;
  assert.deepEqual(found.clues, ["bell"]);
  const stored = found.notes[0].segments[0];
  assert.equal(stored.sourceId, "arrival-main");
  assert.equal(stored.version, "main");
  assert.equal(stored.clueId, "bell");
  assert.equal(
    collectClue(found, episode, cue, { "arrival-main": 10 }),
    null,
  );
});
test("unavailable audio disables replay only and keeps every segment and the note", () => {
  const s = addNote(
    createEvidence(),
    seg("arrival-removed", "旧磁带", 2, 24, "旧磁带底噪"),
  );
  const segment = s.notes[0].segments[0];
  assert.equal(isSegmentAvailable(content, segment), false);
  assert.equal(isSegmentAvailable(content, { sourceId: "arrival-main" }), true);
  // 失效音源的存档仍可往返保存，不丢失顺序与来源；
  // 即使其范围超出当前案件音频时长，也只禁用回听而不丢弃内容。
  const snap = createSnapshot(
    content,
    story,
    s,
    {},
    { sceneId: "arrival", position: 0, rate: 1 },
  );
  const restored = validateSnapshot(JSON.parse(JSON.stringify(snap)), content);
  const saved = restored.evidence.notes[0].segments[0];
  assert.equal(saved.sourceId, "arrival-removed");
  assert.equal(saved.version, "旧磁带");
  assert.equal(saved.end, 24);
});
test("legacy single-anchor notes migrate into editable one-segment composite notes", () => {
  const legacy = {
    version: 1,
    caseId: "test",
    story,
    evidence: {
      notes: [
        {
          id: "old-note",
          clueId: null,
          title: "旧笔记",
          text: "原来的正文",
          anchor: { sceneId: "arrival", start: 4, end: 8 },
          createdAt: 1,
          pinned: false,
        },
      ],
      clues: [],
      selectedId: null,
    },
    heard: {},
    resume: { sceneId: "arrival", position: 0, rate: 1 },
  };
  const migrated = validateSnapshot(legacy, content);
  const note = migrated.evidence.notes[0];
  assert.equal(note.segments.length, 1);
  assert.equal(note.segments[0].text, "原来的正文");
  assert.equal(note.segments[0].sourceId, "arrival-main");
  assert.equal(note.segments[0].version, "main");
  assert.equal(note.text, "");
  // 迁移后仍是可编辑的普通组合手记，可以继续追加段落
  const withMore = addSegment(
    { ...createEvidence(), notes: [note] },
    note.id,
    seg("arrival-main", "main", 9, 11, "新观察"),
  );
  assert.equal(withMore.notes[0].segments.length, 2);
});
test("snapshot rebuild strips unknown fields and rejects invalid ranges and heard sources", () => {
  const s = snapshot();
  const raw = JSON.parse(JSON.stringify(s));
  raw.extra = "drop";
  raw.evidence.notes[0].segments[0].unexpected = "drop";
  const checked = validateSnapshot(raw, content);
  assert.equal("extra" in checked, false);
  assert.equal(
    "unexpected" in checked.evidence.notes[0].segments[0],
    false,
  );
  raw.heard.unknown = 1;
  assert.throws(() => validateSnapshot(raw, content), /听|source|音源/i);
  delete raw.heard.unknown;
  raw.evidence.notes[0].segments[0].end = Infinity;
  assert.throws(() => validateSnapshot(raw, content));
});
test("slots keep deep independent copies and imported files get new identity", () => {
  const s = snapshot();
  const a = createSlot("  Case A  ", s),
    b = createSlot("B", s);
  s.evidence.notes[0].segments[0].text = "changed";
  assert.equal(a.name, "Case A");
  assert.equal(
    a.snapshot.evidence.notes[0].segments[0].text,
    "memo",
  );
  a.snapshot.evidence.notes[0].segments[0].text = "a";
  assert.equal(
    b.snapshot.evidence.notes[0].segments[0].text,
    "memo",
  );
  const imported = parseImported(exportSlot(a), content);
  assert.notEqual(imported.id, a.id);
  assert.match(imported.name, /副本/);
  // 导入后顺序与来源完整
  assert.deepEqual(
    imported.snapshot.evidence.notes[0].segments.map((x) => x.sourceId),
    ["arrival-main"],
  );
});
test("storage recovers corruption with warning, enforces limit and surfaces quota errors", () => {
  const memory = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, val: string) => memory.set(key, val),
    },
  });
  const first = createSlot("first", snapshot());
  let slots = writeSlot([], first);
  assert.equal(readSlots(content).slots.length, 1);
  assert.equal(deleteSlot(slots, first.id).length, 0);
  for (let i = 0; i < 8; i++)
    slots = writeSlot(
      i === 0 ? [] : slots,
      createSlot("slot " + i, snapshot()),
    );
  assert.throws(() => writeSlot(slots, createSlot("ninth", snapshot())), /8/);
  for (const key of memory.keys()) memory.set(key, "corrupt");
  assert.ok(readSlots(content).warning);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      setItem: () => {
        throw new Error("quota");
      },
      getItem: () => null,
    },
  });
  assert.throws(() => writeSlot([], first), /quota/);
});
