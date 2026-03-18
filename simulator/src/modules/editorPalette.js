// Editor palette controller (DOM-based)
//
// Responsibilities:
// - Tabs: "Units" / "Items"
// - Palette tiles are draggable and set a typed payload into the browser drag
//   dataTransfer, so the Pixi grid can accept drops.
// - No Pixi dependency in this file.
//
// Usage (in `main.js`):
//   import { createEditorPalette } from "./modules/editorPalette.js";
//   const editor = createEditorPalette();
//   editor.init();
//
// Then, in your canvas drop handler, parse the payload with `readPalettePayloadFromDataTransfer`.

const MIME = "application/x-final-fate-palette-v1";
const FALLBACK_MIME = "text/plain";

/**
 * @typedef {"unit"|"item"} PaletteKind
 *
 * @typedef {object} PalettePayload
 * @property {PaletteKind} kind
 * @property {string} id
 * @property {string} label
 */

/**
 * @param {unknown} v
 * @returns {v is PalettePayload}
 */
function isPalettePayload(v) {
  if (!v || typeof v !== "object") return false;
  const o = /** @type {any} */ (v);
  return (
    (o.kind === "unit" || o.kind === "item") &&
    typeof o.id === "string" &&
    typeof o.label === "string"
  );
}

/**
 * Tries to read a palette payload from a DataTransfer.
 * Useful inside canvas/stage drop handlers.
 *
 * @param {DataTransfer|null|undefined} dt
 * @returns {PalettePayload|null}
 */
export function readPalettePayloadFromDataTransfer(dt) {
  if (!dt) return null;

  // Prefer our structured mime type.
  const raw = dt.getData(MIME) || dt.getData(FALLBACK_MIME);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return isPalettePayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @param {HTMLElement} root
 */
function assertEl(root) {
  if (!(root instanceof HTMLElement)) {
    throw new Error("editorPalette: missing `#editor` root element");
  }
}

/**
 * @param {HTMLElement|null} el
 * @param {string} id
 * @returns {HTMLElement}
 */
function requireEl(el, id) {
  if (!(el instanceof HTMLElement)) {
    throw new Error(`editorPalette: missing element: \`#${id}\``);
  }
  return el;
}

/**
 * @param {Element} el
 * @returns {el is HTMLElement}
 */
function isHtmlEl(el) {
  return el instanceof HTMLElement;
}

/**
 * @param {HTMLElement} tab
 * @param {boolean} selected
 */
function setTabSelected(tab, selected) {
  tab.setAttribute("aria-selected", selected ? "true" : "false");
}

/**
 * @param {HTMLElement} panel
 * @param {boolean} visible
 */
function setPanelVisible(panel, visible) {
  if (visible) panel.removeAttribute("hidden");
  else panel.setAttribute("hidden", "");
}

/**
 * Creates a controller bound to the editor palette HTML in `index.html`.
 *
 * Expects these IDs:
 * - `editor`
 * - `editorTabUnits`, `editorTabItems`
 * - `editorPanelUnits`, `editorPanelItems`
 */
export function createEditorPalette() {
  /** @type {HTMLElement|null} */
  let root = null;

  /** @type {HTMLElement|null} */
  let tabUnits = null;
  /** @type {HTMLElement|null} */
  let tabItems = null;

  /** @type {HTMLElement|null} */
  let panelUnits = null;
  /** @type {HTMLElement|null} */
  let panelItems = null;

  /** @type {"Units"|"Items"} */
  let active = "Units";

  function applyTabState() {
    if (!tabUnits || !tabItems || !panelUnits || !panelItems) return;

    const unitsOn = active === "Units";
    setTabSelected(tabUnits, unitsOn);
    setTabSelected(tabItems, !unitsOn);

    setPanelVisible(panelUnits, unitsOn);
    setPanelVisible(panelItems, !unitsOn);
  }

  /**
   * @param {"Units"|"Items"} next
   */
  function setActive(next) {
    active = next;
    applyTabState();
  }

  /**
   * @param {DragEvent} e
   * @param {HTMLElement} tileEl
   */
  function onTileDragStart(e, tileEl) {
    const dt = e.dataTransfer;
    if (!dt) return;

    /** @type {PaletteKind|null} */
    const kind =
      tileEl.dataset.paletteKind === "unit"
        ? "unit"
        : tileEl.dataset.paletteKind === "item"
          ? "item"
          : null;

    const id = tileEl.dataset.paletteId || "";
    const label = tileEl.dataset.paletteLabel || "";

    if (!kind || !id || !label) return;

    /** @type {PalettePayload} */
    const payload = { kind, id, label };
    const json = JSON.stringify(payload);

    // Tell the browser we're dragging "copy" semantics.
    dt.effectAllowed = "copy";
    dt.dropEffect = "copy";

    // Set both a structured mime and a text fallback.
    dt.setData(MIME, json);
    dt.setData(FALLBACK_MIME, json);
  }

  function wireTabs() {
    if (!tabUnits || !tabItems) return;

    tabUnits.addEventListener("click", () => setActive("Units"));
    tabItems.addEventListener("click", () => setActive("Items"));

    // Keyboard affordance (left/right) while focusing tabs.
    const onKeyDown = (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;

      const dir = e.key === "ArrowLeft" ? -1 : 1;
      const order = [tabUnits, tabItems];
      const idx = Math.max(0, order.indexOf(/** @type {any} */ (document.activeElement)));
      const next = order[(idx + dir + order.length) % order.length];
      next?.focus?.();
      if (next === tabUnits) setActive("Units");
      if (next === tabItems) setActive("Items");
      e.preventDefault();
      e.stopPropagation();
    };

    tabUnits.addEventListener("keydown", onKeyDown);
    tabItems.addEventListener("keydown", onKeyDown);
  }

  function wireDraggables() {
    if (!root) return;

    // Any `.palette__tile` with `draggable="true"` becomes a source.
    // Use event delegation so future tiles also work.
    root.addEventListener("dragstart", (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;

      const tileEl = target.closest(".palette__tile");
      if (!tileEl || !isHtmlEl(tileEl)) return;

      onTileDragStart(/** @type {DragEvent} */ (e), tileEl);
    });
  }

  function init() {
    root = document.getElementById("editor");
    assertEl(root);

    tabUnits = requireEl(document.getElementById("editorTabUnits"), "editorTabUnits");
    tabItems = requireEl(document.getElementById("editorTabItems"), "editorTabItems");
    panelUnits = requireEl(document.getElementById("editorPanelUnits"), "editorPanelUnits");
    panelItems = requireEl(document.getElementById("editorPanelItems"), "editorPanelItems");

    wireTabs();
    wireDraggables();

    applyTabState();
  }

  function destroy() {
    // Lightweight controller; if you need full teardown later, refactor to keep listener refs.
    root = null;
    tabUnits = null;
    tabItems = null;
    panelUnits = null;
    panelItems = null;
  }

  return {
    init,
    destroy,
    setActive,
    getActiveTab: () => active,
  };
}
