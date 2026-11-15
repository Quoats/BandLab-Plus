// Bandlab+ themes. Runs at document_start so there's no flash of the stock theme.
//
// BandLab's UI is built on design-system CSS variables (--ds-color-*, --mix-editor-*),
// so a theme only re-points those variables. It never blanks element backgrounds,
// which keeps track colors, menus and swatches intact.
(() => {
  'use strict';
  const style = document.createElement('style');
  style.id = 'bp-theme';

  const mix = (a, b, pct) => `color-mix(in srgb, ${b} ${pct}%, ${a})`;
  const alpha = (c, pct) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

  function css(t) {
    const c = t.colors;
    let bg = c.primary, panel = c.secondary, accent = c.accent;
    const text = c.text;
    let anim = '';
    if (t.isAnimated) {
      anim = `
        @property --bp-hue { syntax: '<number>'; inherits: true; initial-value: 0; }
        @keyframes bp-hue { to { --bp-hue: 360; } }
        html { animation: bp-hue 30s linear infinite; }`;
      bg = 'hsl(var(--bp-hue) 40% 9%)';
      panel = 'hsl(var(--bp-hue) 40% 14%)';
      accent = 'hsl(var(--bp-hue) 85% 70%)';
    }
    const ds = {
      'surface-inactive-screen': bg,
      'surface-inactive-screen-2': bg,
      'surface-inactive-neutral': panel,
      'surface-inactive-neutral-2': panel,
      'surface-inactive-permanent-dark-neutral': panel,
      'surface-inactive-contrast': mix(panel, text, 8),
      'overlay-surface-modal': panel,
      'surface-inactive-translucent': alpha(text, 8),
      'surface-elevated-neutral': alpha(text, 8),
      'surface-elevated-contrast': alpha(text, 12),
      'surface-interactive-secondary-rested': alpha(text, 20),
      'surface-interactive-secondary-feedback': alpha(text, 28),
      'surface-interactive-tertiary-rested': alpha(text, 12),
      'surface-interactive-tertiary-feedback': alpha(text, 16),
      'glyphs-primary': text,
      'glyphs-secondary': alpha(text, 64),
      'glyphs-tertiary': alpha(text, 48),
      'glyphs-disabled': alpha(text, 24),
      'glyphs-link': accent,
      'border-neutral': alpha(text, 16),
      'border-intense': alpha(text, 32),
      'border-neutral-solid': mix(panel, text, 10),
      'border-intense-solid': mix(panel, text, 22),
    };
    const root = Object.entries(ds).map(([k, v]) => `--ds-color-${k}: ${v} !important;`).join('\n');
    // Editor variables are declared on BandLab's per-screen containers, so they're overridden
    // right there. (Not on every element: that makes the browser carry and recalculate a
    // copy of each one per element, on every style change, which slows the whole editor.)
    const editor = {
      'mix-editor-background-color': bg,
      'mix-editor-body-background-color': bg,
      'mix-editor-track-background-color': bg,
      'mix-editor-track-headers-container-border-color': bg,
      'mix-editor-footer-background-color': panel,
      'mix-editor-sidetab-bg-color': panel,
      'mix-editor-border-color': alpha(text, 20),
      'mix-editor-area-selection-background-color': alpha(accent, 15),
      'mix-editor-area-selection-box-shadow': alpha(accent, 45),
    };
    const all = Object.entries(editor).map(([k, v]) => `--${k}: ${v} !important;`).join('\n');
    return `${anim}
      :root, [data-theme] { ${root} --ds-dropdown-list-background-color: ${panel} !important; }
      html .state-fx, html .state-mixeditor, html .state-playground-mixeditor, html .state-playground-pedals { ${all} }
      ::selection { background: ${alpha(accent, 40)}; }`;
  }

  // Layout: side panel width and focus mode. Track/clip height is deliberately left alone:
  // overriding --region-height makes BandLab draw split clips' waveforms offset.
  function layoutCss(l) {
    // Side panel (Lyrics/Notes, Sounds...): BandLab hardcodes 400px; content.js's drag handle
    // sets --bp-side-w live, the saved width is the fallback.
    const w = `var(--bp-side-w, ${(l && l.sideW) || 400}px)`;
    let out = `
      html .mix-editor-sidetabs { width: ${w}; right: calc(-1 * ${w}); }
      html .mix-editor-sidetabs.active { right: 0; }
      html .studio-ruler-buttons.is-pushed-left { right: ${w}; }
      html .mix-editor-audio-input.is-pushed-left { width: calc(100% - ${w}); }`;
    if (!l) return out;
    // Focus: hide the project row and the bottom bar, and give their space back
    // (the header height is computed from the content-row height and gap).
    if (l.focus) {
      out += `
        html .mix-editor {
          --mix-editor-header-content-height: 0px !important;
          --mix-editor-header-gap: 0px !important;
          --mix-editor-header-height: calc(var(--mix-editor-toolbar-height) + 24px) !important;
        }
        html .mix-editor-header { flex-basis: auto !important; }
        html .mix-editor-header-content, html .mix-editor-footer { display: none !important; }
        html .mix-editor-sidetabs { bottom: 0 !important; }
        /* Track header column: squeezed to nothing rather than display:none, so the rows
           keep their positions (track colors are matched by row). */
        html .mix-editor-headers {
          min-width: 0 !important; width: 0 !important; overflow: hidden !important; border-right: 0 !important;
        }`;
    }
    return out;
  }

  let theme = null, layout = null;
  function apply() {
    style.textContent = (theme && theme.colors ? css(theme) : '') + layoutCss(layout);
    if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
  }

  chrome.storage.local.get(['bp:theme', 'bp:layout'], (r) => { theme = r['bp:theme']; layout = r['bp:layout']; apply(); });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch['bp:theme']) theme = ch['bp:theme'].newValue;
    if (ch['bp:layout']) layout = ch['bp:layout'].newValue;
    if (ch['bp:theme'] || ch['bp:layout']) apply();
  });
  // Keep our <style> last in <head> so it wins ties with BandLab's late-loaded sheets.
  document.addEventListener('DOMContentLoaded', () => {
    if (style.textContent) document.head.appendChild(style);
  });
})();
