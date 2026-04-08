/**
 * md-preview.js — Simple Markdown preview renderer
 *
 * Renders basic Markdown (headers, bold, italic, lists,
 * code blocks, inline code) without any external library.
 * Uses textContent for safety (no XSS).
 *
 * Blueprint reference: §3.4 — Release notes preview
 */
(function () {
  'use strict';

  window.App = window.App || {};

  /**
   * Toggle the Markdown preview visibility and render content.
   * @param {HTMLTextAreaElement} textarea
   * @param {HTMLElement} previewDiv
   */
  function toggle(textarea, previewDiv) {
    if (previewDiv.style.display !== 'none') {
      previewDiv.style.display = 'none';
      return;
    }
    previewDiv.style.display = 'block';
    render(textarea.value, previewDiv);
  }

  /**
   * Render basic Markdown into a container.
   * @param {string} md
   * @param {HTMLElement} container
   */
  function render(md, container) {
    while (container.firstChild) container.removeChild(container.firstChild);

    if (!md || md.trim() === '') {
      const p = document.createElement('p');
      p.className = 'text-muted text-sm';
      p.textContent = 'Nothing to preview.';
      container.appendChild(p);
      return;
    }

    const lines = md.split('\n');
    let inCode = false;
    let codeLines = [];

    lines.forEach(line => {
      if (line.trim().startsWith('```')) {
        if (inCode) {
          _appendCodeBlock(container, codeLines);
          codeLines = [];
          inCode = false;
        } else {
          inCode = true;
        }
        return;
      }

      if (inCode) { codeLines.push(line); return; }

      // Headers
      const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (hMatch) {
        const el = document.createElement(`h${hMatch[1].length}`);
        el.className = 'md-preview__heading';
        _renderInline(hMatch[2], el);
        container.appendChild(el);
        return;
      }

      // Unordered list item
      if (/^[-*]\s+/.test(line.trim())) {
        const text = line.trim().replace(/^[-*]\s+/, '');
        const li = document.createElement('div');
        li.className = 'md-preview__list-item';
        const bullet = document.createElement('span');
        bullet.textContent = '\u2022 ';
        bullet.className = 'md-preview__bullet';
        li.appendChild(bullet);
        _renderInline(text, li);
        container.appendChild(li);
        return;
      }

      // Empty line
      if (line.trim() === '') {
        container.appendChild(document.createElement('br'));
        return;
      }

      // Paragraph
      const p = document.createElement('p');
      p.className = 'md-preview__para';
      _renderInline(line, p);
      container.appendChild(p);
    });

    // Close unclosed code block
    if (inCode && codeLines.length > 0) {
      _appendCodeBlock(container, codeLines);
    }
  }

  /** Append a <pre><code> block */
  function _appendCodeBlock(container, lines) {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = lines.join('\n');
    pre.appendChild(code);
    container.appendChild(pre);
  }

  /**
   * Render inline Markdown (bold, italic, inline code) safely.
   * @param {string} text
   * @param {HTMLElement} parent
   */
  function _renderInline(text, parent) {
    const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/);
    parts.forEach(part => {
      if (part.startsWith('`') && part.endsWith('`')) {
        const code = document.createElement('code');
        code.className = 'md-preview__code';
        code.textContent = part.slice(1, -1);
        parent.appendChild(code);
      } else if (part.startsWith('**') && part.endsWith('**')) {
        const strong = document.createElement('strong');
        strong.textContent = part.slice(2, -2);
        parent.appendChild(strong);
      } else if (part.startsWith('*') && part.endsWith('*')) {
        const em = document.createElement('em');
        em.textContent = part.slice(1, -1);
        parent.appendChild(em);
      } else {
        parent.appendChild(document.createTextNode(part));
      }
    });
  }

  window.App.MdPreview = { toggle, render };

})();
