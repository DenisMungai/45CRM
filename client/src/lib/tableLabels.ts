/** On phones the list tables collapse into stacked cards (see `.data-table` in index.css), so each cell
 *  needs its column name beside it. Copy every header's text onto its cells as `data-label` rather than
 *  hand-labelling all thirteen tables; full-width rows (empty states) get no label. */
function labelTable(table: HTMLTableElement) {
  const heads = Array.from(table.tHead?.rows[0]?.cells ?? [], (th) => th.textContent?.trim() ?? "");
  for (const body of Array.from(table.tBodies)) for (const row of Array.from(body.rows)) Array.from(row.cells).forEach((cell, i) => { const label = cell.colSpan > 1 ? "" : heads[i] ?? ""; if (cell.dataset.label !== label) cell.dataset.label = label; });
}

/** Label tables now and whenever React adds rows. Batched to one pass per frame; attribute writes aren't observed, so it can't loop. */
export function watchTableLabels() {
  let queued = false;
  const run = () => { queued = false; document.querySelectorAll<HTMLTableElement>("table.data-table").forEach(labelTable); };
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } }).observe(document.body, { childList: true, subtree: true });
  run();
}
