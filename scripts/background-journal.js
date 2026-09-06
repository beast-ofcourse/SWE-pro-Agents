'use strict';

const fs = require('fs');
const path = require('path');

function createJournal({ storeDir }) {
  function journalFile(id) {
    return path.join(storeDir, id + '.journal.jsonl');
  }

  function append(id, type, payload) {
    fs.appendFileSync(journalFile(id), JSON.stringify({ t: Date.now(), type, payload }) + '\n');
  }

  function replay(id) {
    let raw;
    try {
      raw = fs.readFileSync(journalFile(id), 'utf-8');
    } catch (err) {
      if (err && err.code === 'ENOENT') return [];
      throw err;
    }
    if (!raw) return [];
    const events = [];
    const lines = raw.split('\n');
    for (const line of lines) {
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        // Skip torn tail line after a crash — a partial write must not break recovery.
        continue;
      }
      events.push(event);
    }
    return events;
  }

  function prune(id, maxAgeMs, isTerminal) {
    if (!isTerminal) return;
    const events = replay(id);
    if (events.length === 0) return;
    const newest = events[events.length - 1];
    if (typeof newest.t !== 'number') return;
    if (Date.now() - newest.t <= maxAgeMs) return;
    try {
      fs.unlinkSync(journalFile(id));
    } catch (err) {
      if (err && err.code === 'ENOENT') return;
      throw err;
    }
  }

  return { append, replay, prune };
}

module.exports = { createJournal };
