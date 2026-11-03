/** Camera baked into a 2D sprite. Side stays the default so a plain platformer still faces right. */
export type SpriteView = "side" | "front" | "rear" | "top" | "isometric";

const CELL_TAIL =
  "The same character size in every cell, feet on the same invisible baseline near the bottom of each cell, generous empty margin so no pose touches or crosses into a neighbouring cell.";

const DETECTORS: { view: SpriteView; test: RegExp }[] = [
  { view: "isometric", test: /isom[eé]tric/i },
  { view: "rear", test: /vista trasera|desde atr[aá]s|por detr[aá]s|de espalda|back to the camera|seen from behind|from behind|rear view|back view|camera behind/i },
  { view: "isometric", test: /three[- ]quarters?|tres cuartos|\b3\/4\b/i },
  { view: "front", test: /vista frontal|de frente|front view|facing (the )?(camera|viewer)|hacia (la |el )?(c[aá]mara|jugador)|cara a la c[aá]mara/i },
  { view: "top", test: /top[- ]?down|cenital|overhead|bird'?s[- ]?eye|vista superior|vista a[eé]rea|vista en planta|desde arriba/i },
  { view: "side", test: /side view|side[- ]scroller|vista lateral|de perfil|de lado|facing right/i },
];

/** Drop "not three-quarter" so a rear instruction is not read as isometric. */
function withoutNegations(text: string) {
  return text.replace(/\b(?:not|no|never|sin|without|don'?t|do not|jamais|pas de)\b[^.!?\n]{0,48}/gi, " ");
}

export function detectSpriteView(text: string): SpriteView | null {
  const clean = withoutNegations(text);
  for (const { view, test } of DETECTORS) if (test.test(clean)) return view;
  return null;
}

/** The asset prompt wins, then the camera, then the rest of the design. Unknown 2D cameras stay side view. */
export function characterView(parts: {
  camera?: string;
  levelOutline?: string;
  setting?: string;
  heroDescription?: string;
  prompt?: string;
}): SpriteView {
  return (
    detectSpriteView(parts.prompt || "") ||
    detectSpriteView(parts.camera || "") ||
    detectSpriteView([parts.levelOutline, parts.setting, parts.heroDescription].filter(Boolean).join("\n")) ||
    "side"
  );
}

export function stillViewLine(view: SpriteView) {
  switch (view) {
    case "rear":
      return " STRICT straight-on rear view, orthographic, camera directly behind the character. Back of the head centered, both shoulders equal, both arms and both legs seen from behind, the character faces away. FORBIDDEN: side profile, front view, isometric, any part of the face, one eye, the torso turned left or right.";
    case "front":
      return " STRICT front view, facing the camera, full body. Both eyes visible, shoulders equal. FORBIDDEN: side profile, rear view, top-down, isometric, a single eye.";
    case "top":
      return " STRICT top-down view, camera straight above. The top of the head, the shoulders and the feet are seen from overhead, and the character faces toward the bottom of the frame. FORBIDDEN: side profile, front portrait, isometric tilt, rear view.";
    case "isometric":
      return " STRICT isometric view, the same elevated three-quarter camera: top of the head visible and the front of the body visible, consistent angle, facing the lower-right. FORBIDDEN: flat side profile, straight-on front, pure top-down, rear view.";
    default:
      return " Side view, facing right.";
  }
}

export function sheetViewLine(view: SpriteView) {
  switch (view) {
    case "rear":
      return `Exactly one full-body pose per cell, STRICT straight-on rear view in every cell: camera directly behind, both shoulders equal, back of the head centered, face never visible, not a side profile, not a front view, not isometric. Read each pose from behind, so forward means away from the camera. ${CELL_TAIL}`;
    case "front":
      return `Exactly one full-body pose per cell, STRICT front view facing the camera in every cell: both eyes visible, shoulders equal, not a side profile, not from behind, not top-down, not isometric. ${CELL_TAIL}`;
    case "top":
      return `Exactly one full-body pose per cell, STRICT top-down view in every cell: camera straight above, top of the head and shoulders seen from overhead, the facing direction points toward the bottom of the cell. Not a side profile, not a front portrait, not isometric. ${CELL_TAIL}`;
    case "isometric":
      return `Exactly one full-body pose per cell, STRICT isometric view from the same elevated three-quarter camera in every cell: top of the head visible and the front of the body visible, consistent angle, facing the lower-right of the cell. Not a flat side profile, not a straight-on front, not a pure top-down, not from behind. ${CELL_TAIL}`;
    default:
      return `Exactly one full-body pose per cell, side view, facing RIGHT in every cell. ${CELL_TAIL}`;
  }
}

/**
 * View for a back clip (idle_back, walk_back, run_back): the same camera, the character turned away.
 * In isometric it faces the upper-right, so the runtime's horizontal flip gives the upper-left.
 */
export function sheetBackViewLine(view: SpriteView) {
  if (view === "isometric") {
    return `Exactly one full-body pose per cell, STRICT isometric REAR three-quarter view in every cell: the same elevated camera as the reference, but the character is turned away from the camera, facing and moving toward the UPPER-RIGHT of the cell. The back of the head, the back and anything worn on the back (backpack, cape, quiver) are visible; the face is hidden, at most the edge of one cheek. Not facing the camera, not a flat side profile, not a straight-on back view, not top-down. ${CELL_TAIL}`;
  }
  if (view === "top") {
    return `Exactly one full-body pose per cell, STRICT top-down view in every cell: camera straight above, the character faces and moves toward the TOP of the cell, so the back of the head and the shoulders are seen from overhead and the face is not visible. Not a side profile, not a front portrait, not isometric. ${CELL_TAIL}`;
  }
  return sheetViewLine("rear");
}

export function sheetIdentityLine(view: SpriteView) {
  if (view === "side") return "The reference defines ONLY the character's identity, NOT the pose: do not copy its pose; draw every cell in the pose described for it.";
  return "The reference defines ONLY the character's identity, NOT the pose and NOT the camera angle. Do not copy a different angle. Draw every cell in the view named below.";
}

const VIEW_NAME: Record<SpriteView, string> = {
  side: "side view facing right",
  front: "strict front view facing the camera",
  rear: "strict straight-on back view",
  top: "strict top-down view from straight above",
  isometric: "strict isometric three-quarter view",
};

export function cameraOverride(view: SpriteView) {
  return ` CAMERA OVERRIDE: keep the reference character's species, outfit and colors, but discard its camera angle. Redraw them only as a ${VIEW_NAME[view]}.`;
}
