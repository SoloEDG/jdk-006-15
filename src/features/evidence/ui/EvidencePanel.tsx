import { useState } from "react";
import {
  Bookmark,
  Check,
  Headphones,
  Pin,
  Plus,
  Trash2,
  X,
  Pencil,
  ArrowUp,
  ArrowDown,
  Combine,
  Ban,
  FileText,
} from "lucide-react";
import type {
  CaseContent,
  EvidenceNote,
  EvidenceState,
  NoteSegment,
} from "../../../shared/types";
import {
  canMergeSegments,
  isSegmentAvailable,
  previewMerge,
} from "../model/notes";
import type { MergePreview } from "../model/notes";

interface Props {
  state: EvidenceState;
  content: CaseContent;
  onJump: (segment: NoteSegment) => void;
  onEditConclusion: (id: string, text: string) => void;
  onEditSegment: (noteId: string, segmentId: string, text: string) => void;
  onDelete: (id: string) => void;
  onPin: (id: string) => void;
  onNew: () => void;
  onAppend: (noteId: string) => void;
  onOrder: (noteId: string, segmentId: string, direction: -1 | 1) => void;
  onRemoveSegment: (noteId: string, segmentId: string) => void;
  onMerge: (noteId: string, preview: MergePreview) => void;
}

const time = (n: number) =>
  `${Math.floor(n / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(n % 60)
    .toString()
    .padStart(2, "0")}`;

type MergeState = { noteId: string; firstId: string } | null;

export function EvidencePanel({
  state,
  content,
  onJump,
  onEditConclusion,
  onEditSegment,
  onDelete,
  onPin,
  onNew,
  onAppend,
  onOrder,
  onRemoveSegment,
  onMerge,
}: Props) {
  const [editingSegment, setEditingSegment] = useState<string | null>(null),
    [segmentDraft, setSegmentDraft] = useState(""),
    [editingConclusion, setEditingConclusion] = useState<string | null>(null),
    [conclusionDraft, setConclusionDraft] = useState(""),
    [mergeState, setMergeState] = useState<MergeState>(null);
  const notes = [...state.notes].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned),
  );
  const episodeOf = (segment: NoteSegment) =>
    content.episodes.find((episode) => episode.id === segment.sourceId);
  const sceneTitle = (sceneId: NoteSegment["sceneId"]) =>
    content.scenes.find((scene) => scene.id === sceneId)?.title ?? sceneId;

  const beginMerge = (noteId: string, segmentId: string) => {
    if (mergeState?.noteId === noteId && mergeState.firstId === segmentId) {
      setMergeState(null);
      return;
    }
    setMergeState({ noteId, firstId: segmentId });
  };

  const renderMergeConfirm = (note: EvidenceNote) => {
    if (!mergeState || mergeState.noteId !== note.id) return null;
    const first = note.segments.find(
      (item) => item.id === mergeState.firstId,
    );
    if (!first) return null;
    const candidates = note.segments.filter(
      (item) => item.id !== first.id && canMergeSegments(first, item),
    );
    return (
      <div className="merge-confirm" role="dialog" aria-label="合并确认">
        <div className="merge-confirm-head">
          <Combine size={13} />
          <strong>合并范围确认</strong>
          <button
            aria-label="取消合并"
            onClick={() => setMergeState(null)}
            className="icon-button"
          >
            <X size={13} />
          </button>
        </div>
        <p className="merge-hint">
          只有与首段来自同一音源、范围互相重叠的片段可合并；不同版本即使时间相同也会被排除。
        </p>
        <p className="merge-before">
          首段范围：{time(first.start)} — {time(first.end)}
          <br />
          版本：{first.version}
        </p>
        {candidates.length === 0 ? (
          <p className="merge-empty">没有可与之合并的同源重叠片段。</p>
        ) : (
          candidates.map((candidate) => {
            const preview = previewMerge(
              note.segments,
              first.id,
              candidate.id,
            )!;
            return (
              <div className="merge-option" key={candidate.id}>
                <div className="merge-range-change">
                  <span>
                    合并前：{time(candidate.start)} — {time(candidate.end)}
                  </span>
                  <ArrowDown size={11} />
                  <span className="merge-after">
                    合并后：{time(preview.start)} — {time(preview.end)}
                  </span>
                </div>
                <p className="merge-text-change">
                  合并后观察将拼接为：
                  <br />
                  {preview.text}
                </p>
                <div className="note-actions">
                  <button
                    onClick={() => {
                      onMerge(note.id, preview);
                      setMergeState(null);
                    }}
                  >
                    <Check size={13} /> 确认合并
                  </button>
                  <button onClick={() => setMergeState(null)}>
                    <X size={13} /> 取消
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    );
  };

  return (
    <aside className="evidence-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">CASE NOTES</span>
          <h2>
            <Bookmark size={18} /> 证据手记
          </h2>
        </div>
        <span className="count-badge">{state.clues.length} 条线索</span>
      </div>
      <p className="panel-description">
        一篇手记可收纳多段来源，每段单独记录观察、排序与回听。
      </p>
      <button className="new-note" onClick={onNew}>
        <Plus size={16} /> 添加收听笔记
      </button>
      <div className="evidence-list">
        {notes.length === 0 ? (
          <div className="empty-notes">
            <Headphones size={26} />
            <p>还没有收听笔记</p>
            <small>播放录音，捕捉值得留意的片刻。</small>
          </div>
        ) : (
          notes.map((note) => (
            <article
              className={`evidence-card ${note.pinned ? "is-pinned" : ""}`}
              key={note.id}
            >
              <div className="note-heading">
                <span className="note-kind">
                  {note.clueId ? "声音线索" : "组合手记"} ·{" "}
                  {note.segments.length} 段来源
                </span>
                <button
                  className={`icon-button ${note.pinned ? "active" : ""}`}
                  aria-label={note.pinned ? "取消置顶" : "置顶笔记"}
                  onClick={() => onPin(note.id)}
                >
                  <Pin size={14} />
                </button>
              </div>
              <h3>{note.title}</h3>

              {note.segments.length === 0 ? (
                <p className="text-only-note">
                  <FileText size={13} />
                  无音源文字手记：所有片段均已移除，结论与正文仍保留。
                </p>
              ) : (
                <ol className="segment-list">
                  {note.segments.map((segment, index) => {
                    const available = isSegmentAvailable(content, segment);
                    const episode = episodeOf(segment);
                    const mergeAnchor =
                      mergeState?.noteId === note.id
                        ? note.segments.find(
                            (item) => item.id === mergeState.firstId,
                          )
                        : undefined;
                    const selecting = mergeAnchor?.id === segment.id;
                    const mergeable =
                      !!mergeAnchor &&
                      mergeAnchor.id !== segment.id &&
                      canMergeSegments(mergeAnchor, segment);
                    return (
                      <li
                        className={`segment-card ${available ? "" : "is-unavailable"} ${selecting ? "is-selected" : ""} ${mergeable ? "is-mergeable" : ""}`}
                        key={segment.id}
                      >
                        <div className="segment-meta">
                          <span className="segment-index">
                            第 {index + 1} 段
                          </span>
                          <span className="segment-version">
                            {episode
                              ? `${sceneTitle(segment.sceneId)} · ${segment.version}`
                              : `${sceneTitle(segment.sceneId)} · 音源已失效`}
                          </span>
                        </div>
                        {editingSegment === segment.id ? (
                          <>
                            <textarea
                              aria-label="编辑片段观察"
                              value={segmentDraft}
                              onChange={(event) =>
                                setSegmentDraft(event.target.value)
                              }
                            />
                            <div className="note-actions">
                              <button
                                disabled={!segmentDraft.trim()}
                                onClick={() => {
                                  onEditSegment(
                                    note.id,
                                    segment.id,
                                    segmentDraft,
                                  );
                                  setEditingSegment(null);
                                }}
                              >
                                <Check size={13} /> 保存观察
                              </button>
                              <button onClick={() => setEditingSegment(null)}>
                                <X size={13} /> 取消
                              </button>
                            </div>
                          </>
                        ) : (
                          <p className="note-text segment-text">
                            {segment.text}
                          </p>
                        )}
                        <button
                          className="note-play"
                          disabled={!available}
                          title={
                            available
                              ? "回听这段声音"
                              : "该音源已失效，仅禁用本片段回听"
                          }
                          onClick={() => available && onJump(segment)}
                        >
                          {available ? (
                            <Headphones size={13} />
                          ) : (
                            <Ban size={13} />
                          )}
                          {available
                            ? `${time(segment.start)} — ${time(segment.end)} · 回听`
                            : `${time(segment.start)} — ${time(segment.end)} · 回听已禁用`}
                        </button>
                        <div className="segment-actions">
                          <button
                            aria-label="上移片段"
                            disabled={index === 0}
                            onClick={() => onOrder(note.id, segment.id, -1)}
                          >
                            <ArrowUp size={13} /> 上移
                          </button>
                          <button
                            aria-label="下移片段"
                            disabled={index === note.segments.length - 1}
                            onClick={() => onOrder(note.id, segment.id, 1)}
                          >
                            <ArrowDown size={13} /> 下移
                          </button>
                          <button
                            aria-label="编辑片段观察"
                            onClick={() => {
                              setEditingSegment(segment.id);
                              setSegmentDraft(segment.text);
                            }}
                          >
                            <Pencil size={13} /> 编辑
                          </button>
                          <button
                            aria-label="合并片段"
                            className={selecting ? "active" : ""}
                            disabled={note.segments.length < 2}
                            onClick={() => beginMerge(note.id, segment.id)}
                          >
                            <Combine size={13} />{" "}
                            {selecting ? "选择合并对象" : "合并"}
                          </button>
                          <button
                            aria-label="移除片段"
                            onClick={() => {
                              onRemoveSegment(note.id, segment.id);
                              if (mergeState?.firstId === segment.id)
                                setMergeState(null);
                            }}
                          >
                            <Trash2 size={13} /> 移除片段
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}

              {renderMergeConfirm(note)}

              <div className="conclusion-block">
                <div className="conclusion-head">
                  <span className="note-kind">整篇结论</span>
                  {editingConclusion !== note.id && (
                    <button
                      aria-label="编辑结论"
                      onClick={() => {
                        setEditingConclusion(note.id);
                        setConclusionDraft(note.text);
                      }}
                    >
                      <Pencil size={12} /> 编辑结论
                    </button>
                  )}
                </div>
                {editingConclusion === note.id ? (
                  <>
                    <textarea
                      aria-label="编辑整篇结论"
                      placeholder="在整篇末尾写下综合各段来源的结论…"
                      value={conclusionDraft}
                      onChange={(event) =>
                        setConclusionDraft(event.target.value)
                      }
                    />
                    <div className="note-actions">
                      <button
                        onClick={() => {
                          onEditConclusion(note.id, conclusionDraft);
                          setEditingConclusion(null);
                        }}
                      >
                        <Check size={13} /> 保存结论
                      </button>
                      <button onClick={() => setEditingConclusion(null)}>
                        <X size={13} /> 取消
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="note-text conclusion-text">
                    {note.text || "尚未写下结论。"}
                  </p>
                )}
              </div>

              <div className="note-actions">
                <button onClick={() => onAppend(note.id)}>
                  <Plus size={13} /> 追加当前声音
                </button>
                <button aria-label="删除整篇手记" onClick={() => onDelete(note.id)}>
                  <Trash2 size={13} /> 删除手记
                </button>
              </div>
            </article>
          ))
        )}
      </div>
      <footer className="evidence-footer">
        所有手记仅保存在此设备 · 顺序与来源随存档完整保留
      </footer>
    </aside>
  );
}
