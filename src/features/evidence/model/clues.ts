import type {
  Cue,
  Episode,
  EvidenceState,
  HeardHistory,
} from "../../../shared/types";
import { canCollectSound } from "./eligibility";
import { addNote } from "./notes";
export function collectClue(
  state: EvidenceState,
  episode: Episode,
  cue: Cue,
  heard: HeardHistory,
): EvidenceState | null {
  const sound = cue.sound;
  if (
    !sound ||
    state.clues.includes(sound.clueId) ||
    !canCollectSound(heard, episode, cue)
  )
    return null;
  const next = addNote(
    state,
    {
      sourceId: episode.id,
      sceneId: episode.sceneId,
      version: episode.version,
      start: sound.start,
      end: sound.end,
      text: sound.description,
      clueId: sound.clueId,
    },
    "声音线索",
  );
  return { ...next, clues: [...state.clues, sound.clueId] };
}
