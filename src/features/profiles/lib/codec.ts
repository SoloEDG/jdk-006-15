import type {
  CaseContent,
  CaseSnapshot,
  EvidenceNote,
  NoteSegment,
  SceneId,
} from "../../../shared/types";
type Obj = Record<string, unknown>;
function object(value: unknown, label: string): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label}格式无效`);
  return value as Obj;
}
function string(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label}必须是文字`);
  return value;
}
function number(value: unknown, label: string, min = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min)
    throw new Error(`${label}数值无效`);
  return value;
}
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是列表`);
  return value;
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label}必须是布尔值`);
  return value;
}
export function validateSnapshot(
  input: unknown,
  content: CaseContent,
): CaseSnapshot {
  const root = object(input, "存档");
  if (root.version !== 1) throw new Error("不支持的存档版本");
  if (root.caseId !== content.id) throw new Error("存档不属于当前案件");
  const scene = (value: unknown): SceneId => {
    const id = string(value, "场景");
    if (!content.scenes.some((item) => item.id === id))
      throw new Error("存档包含未知场景");
    return id as SceneId;
  };
  const clue = (value: unknown): string => {
    const id = string(value, "线索");
    if (!content.clues.some((item) => item.id === id))
      throw new Error("存档包含未知线索");
    return id;
  };
  const durationOfScene = (id: SceneId) =>
    Math.max(
      0,
      ...content.episodes
        .filter((episode) => episode.sceneId === id)
        .map((episode) => episode.duration),
    );
  /**
   * 旧格式（单 anchor 笔记）在这里迁移成单段组合手记。
   * 音源在案件中已失效（sourceId 找不到）时只跳过范围越界校验，
   * 段落原样保留，回听由界面按可用性禁用。
   */
  const segment = (value: unknown): NoteSegment => {
    const s = object(value, "笔记片段");
    const sceneId = scene(s.sceneId);
    const sourceId = string(s.sourceId, "音源");
    const start = number(s.start, "范围起点");
    const end = number(s.end, "范围终点");
    const episode = content.episodes.find((item) => item.id === sourceId);
    if (episode && episode.sceneId !== sceneId)
      throw new Error("片段音源与场景不一致");
    if (end < start) throw new Error("笔记范围无效");
    // 音源已失效时无法得知原始时长，跳过越界校验、原样保留，
    // 只在界面禁用该段回听，绝不牵连其余片段或整篇手记。
    if (episode && end > episode.duration)
      throw new Error("笔记范围超出音频");
    return {
      id: string(s.id, "片段编号"),
      sourceId,
      sceneId,
      version: string(s.version, "音源版本"),
      start,
      end,
      text: string(s.text, "片段观察"),
      clueId: s.clueId === null || s.clueId === undefined ? null : clue(s.clueId),
    };
  };
  const legacyAnchor = (value: unknown, noteId: string): NoteSegment => {
    const a = object(value, "笔记锚点");
    const sceneId = scene(a.sceneId);
    const start = number(a.start, "范围起点");
    const end = number(a.end, "范围终点");
    if (end < start || end > durationOfScene(sceneId))
      throw new Error("笔记范围超出音频");
    const episode = content.episodes.find(
      (item) => item.sceneId === sceneId,
    );
    return {
      id: `${noteId}-segment`,
      sourceId: episode?.id ?? `${sceneId}-unknown`,
      sceneId,
      version: episode?.version ?? "未知版本",
      start,
      end,
      text: "",
      clueId: null,
    };
  };
  const rawStory = object(root.story, "调查进度");
  const decisions = array(rawStory.decisions, "决策").map((value) => {
    const d = object(value, "决策");
    const sceneId = scene(d.sceneId),
      choiceId = string(d.choiceId, "选项");
    if (
      !content.scenes
        .find((item) => item.id === sceneId)
        ?.choices.some((item) => item.id === choiceId)
    )
      throw new Error("存档包含未知选项");
    return { sceneId, choiceId };
  });
  const story = {
    sceneId: scene(rawStory.sceneId),
    visited: array(rawStory.visited, "到访场景").map(scene),
    decisions,
    ending: rawStory.ending === null ? null : string(rawStory.ending, "结局"),
  };
  const rawEvidence = object(root.evidence, "手记");
  const notes: EvidenceNote[] = array(rawEvidence.notes, "笔记").map(
    (value) => {
      const n = object(value, "笔记");
      const id = string(n.id, "笔记编号");
      if (!id) throw new Error("笔记编号为空");
      const clueId =
        n.clueId === null || n.clueId === undefined ? null : clue(n.clueId);
      const text = string(n.text, "笔记内容");
      let segments: NoteSegment[];
      if (n.segments !== undefined) {
        // 空数组合法：最后一段被删除后保留的无音源文字手记。
        segments = array(n.segments, "笔记片段").map(segment);
        const ids = new Set<string>();
        for (const item of segments) {
          if (ids.has(item.id)) throw new Error("片段编号重复");
          ids.add(item.id);
        }
      } else if (n.anchor && typeof n.anchor === "object") {
        // 旧版单段笔记：迁移为组合手记，原正文放入该段观察，结论留空。
        const migrated = legacyAnchor(n.anchor, id);
        migrated.text = text;
        migrated.clueId = clueId;
        segments = [migrated];
      } else {
        throw new Error("笔记缺少音源片段");
      }
      return {
        id,
        clueId,
        title: string(n.title, "笔记标题"),
        // 新格式下 text 是整篇结论；旧格式的正文已迁入片段。
        text: n.segments !== undefined ? text : "",
        segments,
        createdAt: number(n.createdAt, "笔记日期"),
        pinned: boolean(n.pinned, "置顶"),
      };
    },
  );
  if (new Set(notes.map((note) => note.id)).size !== notes.length)
    throw new Error("笔记编号重复");
  const clues = array(rawEvidence.clues, "线索").map(clue);
  if (new Set(clues).size !== clues.length) throw new Error("线索重复");
  const selectedId =
    rawEvidence.selectedId === null
      ? null
      : string(rawEvidence.selectedId, "选中笔记");
  if (selectedId && !notes.some((note) => note.id === selectedId))
    throw new Error("选中的笔记不存在");
  const heard: Record<string, number> = {};
  for (const [id, value] of Object.entries(object(root.heard, "收听记录"))) {
    const episode = content.episodes.find((item) => item.id === id);
    if (!episode) throw new Error("收听记录包含未知音源");
    const position = number(value, "收听位置");
    if (position > episode.duration) throw new Error("收听位置超出音频");
    heard[id] = position;
  }
  const rawResume = object(root.resume, "播放进度");
  const sceneId = scene(rawResume.sceneId),
    position = number(rawResume.position, "播放位置"),
    rate = number(rawResume.rate, "播放速度");
  if (position > durationOfScene(sceneId) || rate < 0.25 || rate > 4)
    throw new Error("播放进度无效");
  return {
    version: 1,
    caseId: content.id,
    story,
    evidence: { notes, clues, selectedId },
    heard,
    resume: { sceneId, position, rate },
  };
}
